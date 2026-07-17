// services/ingestion/pdfExtractor.js
// Extracts the text layer from a text-based PDF, with no dependencies.
//
// WHY HAND-ROLLED: the project ships as an unpacked MV3 extension with a zero
// dependency, zero build-step policy. Pulling in pdf.js would mean adding a
// bundler. The subset of PDF needed to read a restaurant menu is small: find
// content streams, inflate the FlateDecode'd ones, and walk the text-showing
// operators. `DecompressionStream` covers inflate in both Chrome and Node 18+.
//
// WHAT THIS DOES NOT DO, on purpose:
//   - No OCR. A scanned menu has no text layer at all.
//   - No full PDF layout reconstruction. Multi-column and heavily designed
//     menus may still read in drawing order rather than visual order.
//
// Both cases are caught by assessTextQuality() and reported as
// `pdf_ocr_needed`. That is the whole point of the quality gate: this extractor
// is allowed to fail, but it is never allowed to fail SILENTLY and hand the
// parser garbage that looks like a menu.

/** Below this many characters, there is no menu here. */
export const MIN_PDF_CHARS = 200;

/**
 * Share of non-space characters that must be plain ASCII letters.
 *
 * This is the test that separates a real menu from a PDF whose fonts are
 * subsetted with a custom encoding and no ToUnicode map — the bytes decode to
 * an arbitrary permutation of the alphabet, so the output looks like
 * "( - . ( 0 5 * &" where "Chicken" should be.
 *
 * Calibrated against real restaurant PDFs: legible menus measure 0.63–0.91,
 * subsetted-font gibberish measures 0.01–0.04. The gap is wide enough that the
 * exact threshold barely matters, which is what a good heuristic looks like.
 *
 * An earlier version tested "printable characters" instead and rejected a
 * perfectly readable menu, because its logo and QR ornaments came from a symbol
 * font whose glyphs land on control codes. Those characters are now stripped
 * before this ratio is taken.
 */
const MIN_LETTER_RATIO = 0.5;

/** Above this share of whitespace, the "text" is layout noise. */
const MAX_WHITESPACE_RATIO = 0.6;

/**
 * Glyphs from symbol/icon fonts decode to control codes. They are decoration,
 * never menu text, and they poison every ratio they are counted in.
 */
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * @typedef {object} PdfExtraction
 * @property {string} text
 * @property {"pdf_text"|"pdf_ocr_needed"} sourceType
 * @property {number} pageCount
 * @property {string[]} warnings
 */

/**
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {Promise<PdfExtraction>}
 */
export async function extractPdfText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const warnings = [];

  const latin1 = bytesToLatin1(bytes);
  const pageCount = countPages(latin1);
  const fontDecoders = await buildFontDecoders(bytes, latin1, warnings);

  // Preferred: only the streams the live page tree actually references.
  // Fallback: every content stream in the file, which may include superseded
  // revisions and therefore duplicate items.
  const contentRefs = resolvePageContents(latin1);
  const streams = contentRefs
    ? contentRefs.map((num) => streamOfObject(bytes, latin1, num)).filter(Boolean)
    : [...findStreams(bytes, latin1)];

  if (!contentRefs) {
    warnings.push(
      "Could not follow this PDF's page tree; text may include superseded revisions."
    );
  }

  let undecodable = 0;
  const pages = [];
  for (const stream of streams) {
    let content;
    try {
      content = stream.flate ? await inflate(stream.bytes) : stream.bytes;
    } catch {
      // A stream we can't inflate is a stream we skip. One bad object should
      // not lose the other twelve pages.
      undecodable += 1;
      continue;
    }
    const text = extractTextOperators(bytesToLatin1(content), fontDecoders);
    if (text.trim() !== "") pages.push(text);
  }

  if (undecodable > 0) {
    warnings.push(
      `${undecodable} compressed PDF stream(s) could not be decoded and were skipped.`
    );
  }

  // Page breaks are real line breaks. Preserving them keeps a section heading
  // at the top of page 2 from being glued onto the last dish of page 1.
  const text = tidyLines(pages.join("\n\n"));
  const quality = assessTextQuality(text);

  if (!quality.ok) warnings.push(`PDF text layer looks unusable: ${quality.reason}.`);

  return {
    text,
    sourceType: quality.ok ? "pdf_text" : "pdf_ocr_needed",
    pageCount,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Quality gate
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {{ok: boolean, reason?: string}}
 */
export function assessTextQuality(text) {
  if (!text || text.length < MIN_PDF_CHARS) {
    return { ok: false, reason: `only ${text?.length ?? 0} characters extracted` };
  }

  const replacements = (text.match(/�/g) ?? []).length;
  if (replacements > text.length * 0.01) {
    return { ok: false, reason: "many characters decoded as replacement characters" };
  }

  const whitespace = (text.match(/\s/g) ?? []).length;
  if (whitespace / text.length > MAX_WHITESPACE_RATIO) {
    return { ok: false, reason: "text is mostly whitespace" };
  }

  const nonSpace = text.replace(/\s/g, "").length;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (nonSpace > 0 && letters / nonSpace < MIN_LETTER_RATIO) {
    return { ok: false, reason: "text is mostly unreadable characters" };
  }

  // A menu has prices, or at least a lot of short name-shaped lines. Neither is
  // conclusive alone, so we only fail when both are missing.
  const hasPrices = /\$?\d{1,3}\.\d{2}\b/.test(text);
  const dishShapedLines = text
    .split("\n")
    .filter((line) => {
      const words = line.trim().split(/\s+/).filter(Boolean).length;
      return words >= 2 && words <= 10;
    }).length;

  if (!hasPrices && dishShapedLines < 3) {
    return { ok: false, reason: "no price or dish-like patterns found" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Object / stream discovery
// ---------------------------------------------------------------------------

/** `/Type /Page` but not `/Type /Pages`. */
function countPages(latin1) {
  return (latin1.match(/\/Type\s*\/Page(?![sA-Za-z])/g) ?? []).length;
}

/** Streams that hold page content rather than fonts, images or metadata. */
const NON_CONTENT_DICT =
  /\/Subtype\s*\/(Image|XML)|\/FontFile\d?|\/Type\s*\/(Font|Metadata|XRef|ObjStm|XObject)/;

/**
 * Filters we can undo. A stream compressed with anything else is skipped rather
 * than read raw — feeding a JPEG's bytes to the operator scanner produces
 * convincing-looking garbage, which is far worse than producing nothing.
 */
const SUPPORTED_FILTERS = new Set(["FlateDecode"]);

/** `<</Filter/FlateDecode>>` and `<</Filter[/FlateDecode]>>` both occur. */
function parseFilters(dict) {
  const match = dict.match(/\/Filter\s*(\/\w+|\[[^\]]*\])/);
  if (!match) return [];
  return [...match[1].matchAll(/\/(\w+)/g)].map((m) => m[1]);
}

/**
 * The object dictionary for a stream runs from its `N M obj` header up to the
 * `stream` keyword.
 *
 * Do NOT reach for the nearest preceding `<<`: a dict like
 * `<</Filter/FlateDecode/DecodeParms<</Predictor 12>>>>` would hand back only
 * the DecodeParms sub-dictionary, and the /Filter would go unnoticed.
 */
function dictFor(latin1, streamKeywordIndex) {
  const windowStart = Math.max(0, streamKeywordIndex - 8000);
  const window = latin1.slice(windowStart, streamKeywordIndex);
  const headers = [...window.matchAll(/\d+\s+\d+\s+obj/g)];
  return headers.length > 0 ? window.slice(headers[headers.length - 1].index) : window;
}

const ENDSTREAM = "endstream";

// ---------------------------------------------------------------------------
// The page tree
// ---------------------------------------------------------------------------
// Reading every stream in the file is wrong, and real menus prove it: a PDF
// that has been saved twice keeps BOTH revisions of its content. Fratellino's
// dinner menu holds an orphaned `6 0 obj` pointing at content streams 15..23
// and a live `6 0 obj` pointing at stream 234. Scanning the file blind extracts
// the whole menu twice.
//
// So walk the page tree instead: /Root -> /Pages -> /Kids -> each page's
// /Contents. Object numbers resolve to their LAST occurrence in the file, which
// is precisely what an incremental update means — later bytes supersede earlier
// ones. This also yields the content in page order rather than byte order.
//
// We deliberately do not parse the xref table. Its two forms (classic tables
// and compressed xref streams with predictors) are a great deal of machinery to
// arrive at offsets we can find by scanning. When the walk fails — most often
// because the page objects live inside a compressed /ObjStm — we fall back to
// scanning every content stream and say so in a warning.

/** Byte range of an object's body, taking the last (newest) definition. */
function findObjectBody(latin1, objNum) {
  const re = new RegExp(`(?<![0-9])${objNum}\\s+\\d+\\s+obj`, "g");
  let last = null;
  let match;
  while ((match = re.exec(latin1)) !== null) last = match;
  if (!last) return null;

  const start = last.index + last[0].length;
  const end = latin1.indexOf("endobj", start);
  return { start, end: end === -1 ? latin1.length : end };
}

function objectSource(latin1, objNum) {
  const body = findObjectBody(latin1, objNum);
  return body ? latin1.slice(body.start, body.end) : null;
}

/** `/Contents 234 0 R` and `/Contents[226 0 R 227 0 R]` both occur. */
function referencedObjects(source, key) {
  const match = source.match(new RegExp(`/${key}\\s*(\\d+\\s+\\d+\\s+R|\\[[^\\]]*\\])`));
  if (!match) return [];
  return [...match[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
}

const MAX_PAGE_TREE_DEPTH = 32;

/** Depth-first walk of /Kids, collecting leaf /Type /Page object numbers. */
function collectPages(latin1, nodeNum, visited, depth = 0) {
  if (depth > MAX_PAGE_TREE_DEPTH || visited.has(nodeNum)) return [];
  visited.add(nodeNum);

  const source = objectSource(latin1, nodeNum);
  if (!source) return [];

  const kids = referencedObjects(source, "Kids");
  if (kids.length === 0) {
    return /\/Type\s*\/Page(?![sA-Za-z])/.test(source) ? [nodeNum] : [];
  }
  return kids.flatMap((kid) => collectPages(latin1, kid, visited, depth + 1));
}

/**
 * Content-stream object numbers for every page, in page order.
 * @returns {number[]|null} null when the page tree could not be followed.
 */
function resolvePageContents(latin1) {
  const rootRefs = [...latin1.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
  if (rootRefs.length === 0) return null;

  // The last trailer wins: it belongs to the newest revision.
  const rootNum = Number(rootRefs[rootRefs.length - 1][1]);
  const catalog = objectSource(latin1, rootNum);
  if (!catalog) return null;

  const [pagesNum] = referencedObjects(catalog, "Pages");
  if (pagesNum === undefined) return null;

  const pages = collectPages(latin1, pagesNum, new Set());
  if (pages.length === 0) return null;

  const contents = [];
  for (const page of pages) {
    const source = objectSource(latin1, page);
    if (source) contents.push(...referencedObjects(source, "Contents"));
  }
  return contents.length > 0 ? contents : null;
}

/** The stream inside one object, if it has one and we can decode it. */
function streamOfObject(bytes, latin1, objNum) {
  const body = findObjectBody(latin1, objNum);
  if (!body) return null;

  const source = latin1.slice(body.start, body.end);
  const keyword = source.match(/(?<![A-Za-z])stream\r?\n/);
  if (!keyword) return null;

  const dict = source.slice(0, keyword.index);
  if (NON_CONTENT_DICT.test(dict)) return null;

  const filters = parseFilters(dict);
  if (filters.some((f) => !SUPPORTED_FILTERS.has(f))) return null;

  const start = body.start + keyword.index + keyword[0].length;
  const end = latin1.indexOf(ENDSTREAM, start);
  if (end === -1) return null;

  return {
    bytes: bytes.subarray(start, trimTrailingEol(bytes, end)),
    flate: filters.includes("FlateDecode")
  };
}

// ---------------------------------------------------------------------------
// Font Unicode maps
// ---------------------------------------------------------------------------

/**
 * Many real restaurant PDFs subset their fonts and draw glyph codes that are
 * not the characters they visually represent. `/ToUnicode` CMaps are the
 * official way back to text. We only need the common bfchar/bfrange subset.
 *
 * @param {Uint8Array} bytes
 * @param {string} latin1
 * @param {string[]} warnings
 * @returns {Promise<Map<string, {map: Map<string, string>, codeLengths: number[]}>>}
 */
async function buildFontDecoders(bytes, latin1, warnings) {
  const decoders = new Map();
  const resourceFonts = [...latin1.matchAll(/\/Font\s*<<(.*?)>>/gs)];

  for (const resource of resourceFonts) {
    const refs = [...resource[1].matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+\d+\s+R/g)];

    for (const [, fontName, fontObj] of refs) {
      if (decoders.has(fontName)) continue;

      const font = objectSource(latin1, Number(fontObj));
      const unicodeRef = font?.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
      if (!unicodeRef) continue;

      const stream = streamOfObject(bytes, latin1, Number(unicodeRef[1]));
      if (!stream) continue;

      try {
        const raw = stream.flate ? await inflate(stream.bytes) : stream.bytes;
        const map = parseToUnicodeCMap(bytesToLatin1(raw));
        if (map.size > 0) {
          decoders.set(fontName, {
            map,
            codeLengths: [...new Set([...map.keys()].map((key) => key.length / 2))].sort((a, b) => b - a)
          });
        }
      } catch {
        warnings.push(`Could not decode the ToUnicode map for PDF font ${fontName}.`);
      }
    }
  }

  return decoders;
}

/** @param {string} cmap */
function parseToUnicodeCMap(cmap) {
  const map = new Map();

  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const match = line.match(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/);
      if (match) map.set(normalizeHex(match[1]), unicodeHexToString(match[2]));
    }
  }

  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const range = line.match(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+(<([0-9A-Fa-f]+)>|\[[^\]]+\])/);
      if (!range) continue;

      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const width = normalizeHex(range[1]).length;
      if (range[3].startsWith("<")) {
        let out = Number.parseInt(range[4], 16);
        for (let code = start; code <= end; code += 1, out += 1) {
          map.set(code.toString(16).toUpperCase().padStart(width, "0"), unicodeCodePointToString(out));
        }
      } else {
        const values = [...range[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => unicodeHexToString(m[1]));
        for (let code = start; code <= end && code - start < values.length; code += 1) {
          map.set(code.toString(16).toUpperCase().padStart(width, "0"), values[code - start]);
        }
      }
    }
  }

  return map;
}

function normalizeHex(hex) {
  return hex.length % 2 === 0 ? hex.toUpperCase() : `0${hex.toUpperCase()}`;
}

function unicodeHexToString(hex) {
  const normalized = normalizeHex(hex);
  let out = "";
  for (let i = 0; i + 3 < normalized.length; i += 4) {
    out += unicodeCodePointToString(Number.parseInt(normalized.slice(i, i + 4), 16));
  }
  return out;
}

function unicodeCodePointToString(codePoint) {
  return codePoint <= 0xffff
    ? String.fromCharCode(codePoint)
    : String.fromCodePoint(codePoint);
}

/**
 * Walk `stream ... endstream` pairs, pairing each with its object dictionary.
 *
 * The lookbehind is load-bearing: "endstream" ends with the letters "stream",
 * so a naive /stream\r?\n/ matches twice per stream — once correctly, once
 * inside the terminator. The bogus second match yields a garbage byte range
 * that decodes to noise the parser will happily turn into menu items.
 */
function* findStreams(bytes, latin1) {
  const re = /(?<![A-Za-z])stream\r?\n/g;
  let match;

  while ((match = re.exec(latin1)) !== null) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf(ENDSTREAM, start);
    if (end === -1) break;
    re.lastIndex = end + ENDSTREAM.length;

    const dict = dictFor(latin1, match.index);
    if (NON_CONTENT_DICT.test(dict)) continue;

    const filters = parseFilters(dict);
    if (filters.some((f) => !SUPPORTED_FILTERS.has(f))) continue;

    yield {
      bytes: bytes.subarray(start, trimTrailingEol(bytes, end)),
      flate: filters.includes("FlateDecode")
    };
  }
}

function trimTrailingEol(bytes, end) {
  let stop = end;
  if (stop > 0 && bytes[stop - 1] === 0x0a) stop -= 1;
  if (stop > 0 && bytes[stop - 1] === 0x0d) stop -= 1;
  return stop;
}

/** zlib-wrapped deflate, then raw deflate for streams with a broken header. */
async function inflate(bytes) {
  try {
    return await runDecompression(bytes, "deflate");
  } catch {
    return await runDecompression(bytes, "deflate-raw");
  }
}

async function runDecompression(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// Content stream text operators
// ---------------------------------------------------------------------------

/**
 * Pull text out of a decoded content stream.
 *
 * Handles the operators that actually show text — Tj, TJ, ' and " — plus the
 * positioning operators that imply a line break (Td, TD, T*, Tm). Everything
 * else is skipped by consuming its operands and moving on.
 */
export function extractTextOperators(content, fontDecoders = new Map()) {
  const lines = [];
  let line = "";
  let currentFont = null;
  /** @type {any[]} */
  let operands = [];

  const flush = () => {
    const trimmed = line.replace(/[ \t]+/g, " ").trim();
    if (trimmed !== "") lines.push(trimmed);
    line = "";
  };

  let i = 0;
  while (i < content.length) {
    const ch = content[i];

    if (ch === "(") {
      const [str, next] = readLiteralString(content, i);
      operands.push({ str });
      i = next;
      continue;
    }

    if (ch === "<") {
      if (content[i + 1] === "<") {
        i = skipDictionary(content, i);
        continue;
      }
      const [str, next] = readHexString(content, i);
      operands.push({ str });
      i = next;
      continue;
    }

    if (ch === "[") {
      const [array, next] = readArray(content, i);
      operands.push({ array });
      i = next;
      continue;
    }

    if (ch === "/") {
      const [name, next] = readName(content, i);
      operands.push({ name });
      i = next;
      continue;
    }

    if (ch === "%") {
      while (i < content.length && content[i] !== "\n") i += 1;
      continue;
    }

    if (/[-+.\d]/.test(ch)) {
      let j = i;
      while (j < content.length && /[-+.\d]/.test(content[j])) j += 1;
      operands.push({ num: Number.parseFloat(content.slice(i, j)) });
      i = j;
      continue;
    }

    if (/[A-Za-z'"*]/.test(ch)) {
      let j = i;
      while (j < content.length && /[A-Za-z0-9'"*]/.test(content[j])) j += 1;
      const op = content.slice(i, j);
      i = j;

      switch (op) {
        case "Tj": {
          line += decodePdfString(lastString(operands), currentFont, fontDecoders);
          break;
        }
        case "TJ": {
          const array = [...operands].reverse().find((o) => o.array)?.array ?? [];
          line += joinTjArray(array, currentFont, fontDecoders);
          break;
        }
        case "'":
        case '"': {
          flush();
          line += decodePdfString(lastString(operands), currentFont, fontDecoders);
          break;
        }
        case "Tf": {
          const font = [...operands].reverse().find((o) => typeof o.name === "string")?.name;
          if (font) currentFont = font;
          break;
        }
        case "Td":
        case "TD": {
          // A vertical move starts a new line; a purely horizontal one is a gap.
          const nums = operands.filter((o) => typeof o.num === "number");
          const ty = nums.length >= 2 ? nums[nums.length - 1].num : 0;
          if (ty !== 0) flush();
          else line += " ";
          break;
        }
        case "T*":
        case "BT":
        case "ET":
        case "Tm": {
          flush();
          break;
        }
        default:
          break;
      }
      operands = [];
      continue;
    }

    i += 1;
  }

  flush();
  return lines.join("\n");
}

function lastString(operands) {
  for (let i = operands.length - 1; i >= 0; i -= 1) {
    if (typeof operands[i].str === "string") return operands[i].str;
  }
  return "";
}

/**
 * In a TJ array, numbers shift the next glyph. A sufficiently negative shift
 * moves text right far enough to be a word space.
 */
function joinTjArray(array, currentFont, fontDecoders) {
  let out = "";
  for (const item of array) {
    if (typeof item.str === "string") out += decodePdfString(item.str, currentFont, fontDecoders);
    else if (typeof item.num === "number" && item.num <= -100) out += " ";
  }
  return out;
}

function decodePdfString(str, currentFont, fontDecoders) {
  const decoder = currentFont ? fontDecoders.get(currentFont) : null;
  if (!decoder) return str;

  let out = "";
  for (let i = 0; i < str.length;) {
    let matched = false;
    for (const length of decoder.codeLengths) {
      if (i + length > str.length) continue;
      const key = stringBytesToHex(str.slice(i, i + length));
      const mapped = decoder.map.get(key);
      if (mapped !== undefined) {
        out += mapped;
        i += length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      out += str[i];
      i += 1;
    }
  }
  return out;
}

function stringBytesToHex(str) {
  let hex = "";
  for (let i = 0; i < str.length; i += 1) {
    hex += str.charCodeAt(i).toString(16).toUpperCase().padStart(2, "0");
  }
  return hex;
}

function readArray(content, start) {
  const items = [];
  let i = start + 1;

  while (i < content.length && content[i] !== "]") {
    const ch = content[i];
    if (ch === "(") {
      const [str, next] = readLiteralString(content, i);
      items.push({ str });
      i = next;
    } else if (ch === "<") {
      const [str, next] = readHexString(content, i);
      items.push({ str });
      i = next;
    } else if (/[-+.\d]/.test(ch)) {
      let j = i;
      while (j < content.length && /[-+.\d]/.test(content[j])) j += 1;
      items.push({ num: Number.parseFloat(content.slice(i, j)) });
      i = j;
    } else {
      i += 1;
    }
  }
  return [items, i + 1];
}

const ESCAPES = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

/** PDF literal string: `(text)`, with balanced parens and backslash escapes. */
function readLiteralString(content, start) {
  let i = start + 1;
  let depth = 1;
  let out = "";

  while (i < content.length) {
    const ch = content[i];

    if (ch === "\\") {
      const next = content[i + 1];
      if (next >= "0" && next <= "7") {
        let octal = "";
        let j = i + 1;
        while (j < content.length && octal.length < 3 && content[j] >= "0" && content[j] <= "7") {
          octal += content[j];
          j += 1;
        }
        out += String.fromCharCode(Number.parseInt(octal, 8));
        i = j;
        continue;
      }
      // A backslash before a newline is a line continuation, not a character.
      if (next === "\n") { i += 2; continue; }
      if (next === "\r") { i += content[i + 2] === "\n" ? 3 : 2; continue; }
      out += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }

    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return [out, i + 1];
    }
    out += ch;
    i += 1;
  }
  return [out, i];
}

/** PDF hex string: `<48656c6c6f>`. */
function readHexString(content, start) {
  const end = content.indexOf(">", start);
  if (end === -1) return ["", content.length];

  const hex = content.slice(start + 1, end).replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  // Odd trailing digit is implicitly padded with 0.
  if (hex.length % 2 === 1) {
    out += String.fromCharCode(Number.parseInt(`${hex[hex.length - 1]}0`, 16));
  }
  return [out, end + 1];
}

function skipDictionary(content, start) {
  let depth = 0;
  let i = start;
  while (i < content.length) {
    if (content[i] === "<" && content[i + 1] === "<") { depth += 1; i += 2; continue; }
    if (content[i] === ">" && content[i + 1] === ">") {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return i;
}

function readName(content, start) {
  let i = start + 1;
  while (i < content.length && !/[\s/[\]<>(]/.test(content[i])) i += 1;
  return [content.slice(start + 1, i), i];
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/**
 * Latin-1 view of the bytes. PDF syntax is byte-oriented, and text drawn with
 * the standard WinAnsi encodings maps 1:1 onto Latin-1.
 */
function bytesToLatin1(bytes) {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function tidyLines(text) {
  return text
    .replace(CONTROL_CHARS, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
