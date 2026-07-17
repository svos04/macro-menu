// services/ingestion/htmlExtractor.js
// Pulls menu-like text and linked-PDF candidates out of an HTML page.
//
// Two implementations, one contract. `DOMParser` exists in the side panel and
// content scripts but NOT in an MV3 service worker, and not in Node under
// `node --test`. Rather than let the pipeline work in one context and silently
// fail in another, the tokenizer is the reference implementation and the DOM
// path is an optimization that must agree with it.
//
// Both share SKIP_TAGS, BLOCK_TAGS and BOILERPLATE_ATTR, so a fix to one
// applies to the other.
//
// V1 aims for good menu-like TEXT BLOCKS, not perfect DOM item extraction. The
// menuParser restructures the text afterward, and it is far better at it than a
// selector guessing which div is an item card.

/** Their content is never visible menu text. */
const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
  "nav",
  "footer",
  "aside",
  "form",
  "button",
  "select",
  "iframe"
]);

/** Their boundaries are line breaks in the extracted text. */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "tr",
  "td",
  "th",
  "table",
  "section",
  "article",
  "header",
  "dt",
  "dd",
  "dl",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6"
]);

/** Void elements never have a closing tag. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

/**
 * Class/id fragments that mark chrome rather than content.
 *
 * Deliberately conservative. "menu" is absent: restaurant sites use it for both
 * the nav menu and the food menu, and dropping the food menu to lose a navbar
 * is a terrible trade.
 */
const BOILERPLATE_ATTR = /\b(cookie|consent|gdpr|newsletter|subscribe|social|breadcrumb|skip-link|modal|popup)\b/i;

/** Anchor text that promises a menu even when the href hides the extension. */
const PDF_LINK_TEXT = /\b(menu|nutrition|download|view menu|full menu)\b/i;
const PDF_HREF = /\.pdf(?:$|[?#])/i;

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’",
  lsquo: "‘", ldquo: "“", rdquo: "”", middot: "·", bull: "•"
};

/** @param {string} text */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * @typedef {object} HtmlExtraction
 * @property {string} text        Menu-like text, block boundaries as newlines.
 * @property {string} [title]     Page <title>, used as a restaurant-name guess.
 * @property {Array<{href: string, text: string, confident: boolean}>} pdfLinks
 */

/**
 * @param {string} html
 * @param {{baseUrl?: string, forceTokenizer?: boolean}} [options]
 * @returns {HtmlExtraction}
 */
export function extractHtml(html, options = {}) {
  if (typeof html !== "string" || html.trim() === "") {
    return { text: "", pdfLinks: [] };
  }

  const useDom = !options.forceTokenizer && typeof DOMParser !== "undefined";
  const extracted = useDom ? extractWithDom(html) : extractWithTokenizer(html);

  return {
    text: tidy(extracted.text),
    title: extracted.title,
    pdfLinks: dedupeLinks(extracted.pdfLinks, options.baseUrl)
  };
}

// ---------------------------------------------------------------------------
// Tokenizer path — the reference implementation. Works everywhere.
// ---------------------------------------------------------------------------

const TAG_RE = /<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
// <!doctype html>, <![CDATA[...]]>. TAG_RE ignores them (no leading letter), so
// without this they survive as literal text.
const DECLARATION_RE = /<![^>]*>/g;

function extractWithTokenizer(html) {
  const source = html.replace(COMMENT_RE, "").replace(DECLARATION_RE, "");
  const out = [];
  const pdfLinks = [];
  let title;

  // Stack of open tag names. A text node is skipped when any ancestor is a
  // skip tag or a boilerplate container, so nesting is handled without
  // per-tag depth counters.
  /** @type {Array<{name: string, skip: boolean}>} */
  const stack = [];
  let skipDepth = 0;

  // Anchor state, so a link's text can be paired with its href.
  let anchorHref = null;
  let anchorText = "";

  let cursor = 0;
  let match;

  const emitText = (raw) => {
    if (skipDepth > 0) return;
    const text = decodeEntities(raw).replace(/\s+/g, " ");
    if (text.trim() !== "") out.push(text);
  };

  while ((match = TAG_RE.exec(source)) !== null) {
    const between = source.slice(cursor, match.index);
    if (between) {
      emitText(between);
      if (anchorHref !== null && skipDepth === 0) anchorText += decodeEntities(between);
    }
    cursor = TAG_RE.lastIndex;

    const raw = match[0];
    const name = match[1].toLowerCase();
    const attrs = match[2] ?? "";
    const isClosing = raw[1] === "/";
    const isSelfClosing = /\/\s*>$/.test(raw) || VOID_TAGS.has(name);

    if (name === "title" && !isClosing && title === undefined) {
      const end = source.indexOf("</title", cursor);
      if (end !== -1) title = decodeEntities(source.slice(cursor, end)).trim();
    }

    if (isClosing) {
      if (name === "a" && anchorHref !== null) {
        collectPdfLink(pdfLinks, anchorHref, anchorText.trim());
        anchorHref = null;
        anchorText = "";
      }
      // Pop back through to the matching open tag, tolerating unclosed tags.
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === name) {
          for (let k = stack.length - 1; k >= i; k -= 1) {
            if (stack[k].skip) skipDepth -= 1;
          }
          stack.length = i;
          break;
        }
      }
      out.push(BLOCK_TAGS.has(name) ? "\n" : " ");
      continue;
    }

    if (name === "a" && !isSelfClosing) {
      anchorHref = attrValue(attrs, "href");
      anchorText = "";
    }

    // Inline boundaries become spaces. Without this, the extremely common
    // `<span>Baja Chicken Bowl</span><span>$15.95</span>` extracts as
    // "Baja Chicken Bowl$15.95" and the price never splits off the name.
    out.push(BLOCK_TAGS.has(name) ? "\n" : " ");

    if (isSelfClosing) continue;

    const skip = SKIP_TAGS.has(name) || BOILERPLATE_ATTR.test(attrValue(attrs, "class") ?? "") ||
      BOILERPLATE_ATTR.test(attrValue(attrs, "id") ?? "");

    // Raw-text elements: jump the cursor past their content entirely, so a
    // "</div>" inside a <script> string can never unbalance the stack.
    if (name === "script" || name === "style" || name === "noscript" || name === "template") {
      const close = source.toLowerCase().indexOf(`</${name}`, cursor);
      cursor = close === -1 ? source.length : close;
      TAG_RE.lastIndex = cursor;
      continue;
    }

    stack.push({ name, skip });
    if (skip) skipDepth += 1;
  }

  emitText(source.slice(cursor));

  return { text: out.join(""), title: title || undefined, pdfLinks };
}

/** Read one attribute out of a raw attribute string. */
function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = attrs.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

// ---------------------------------------------------------------------------
// DOM path — used in the side panel and content scripts.
// ---------------------------------------------------------------------------

function extractWithDom(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const el of doc.querySelectorAll([...SKIP_TAGS].join(","))) el.remove();
  for (const el of doc.querySelectorAll("[class],[id]")) {
    const marker = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`;
    if (BOILERPLATE_ATTR.test(marker)) el.remove();
  }

  const pdfLinks = [];
  for (const anchor of doc.querySelectorAll("a[href]")) {
    collectPdfLink(pdfLinks, anchor.getAttribute("href"), (anchor.textContent ?? "").trim());
  }

  const body = doc.body ?? doc.documentElement;
  return {
    text: body ? domText(body) : "",
    title: doc.title?.trim() || undefined,
    pdfLinks
  };
}

/** Depth-first text collection, inserting newlines at block boundaries. */
function domText(node) {
  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;
  let out = "";

  for (const child of node.childNodes) {
    if (child.nodeType === TEXT_NODE) {
      out += (child.nodeValue ?? "").replace(/\s+/g, " ");
    } else if (child.nodeType === ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      // Same boundary rule as the tokenizer: blocks break lines, inline
      // elements at least break words.
      const boundary = BLOCK_TAGS.has(tag) ? "\n" : " ";
      out += boundary + domText(child) + boundary;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Two tiers, and the difference matters to the caller.
 *
 *   confident: the href really ends in .pdf. Safe to fetch automatically.
 *   candidate: the href doesn't, but the anchor says "Download Menu". Could be
 *              a real PDF behind a redirect, or could be the nav's "Menu" link.
 *              Reported to the user, never fetched on its own.
 */
function collectPdfLink(sink, href, text) {
  if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) return;

  if (PDF_HREF.test(href)) {
    sink.push({ href, text, confident: true });
  } else if (PDF_LINK_TEXT.test(text)) {
    sink.push({ href, text, confident: false });
  }
}

function dedupeLinks(links, baseUrl) {
  const seen = new Set();
  const out = [];
  // Confident links first, so a caller taking pdfLinks[0] gets the real PDF.
  for (const link of [...links].sort((a, b) => Number(b.confident) - Number(a.confident))) {
    const href = resolveUrl(link.href, baseUrl);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: link.text, confident: link.confident });
  }
  return out;
}

function resolveUrl(href, baseUrl) {
  if (!href) return null;
  if (!baseUrl) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/** Collapse the newline soup that block boundaries produce. */
function tidy(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cheap heuristic: does this page look like it has a menu on it?
 * Three or more prices plus menu vocabulary is a strong signal.
 * @param {string} html
 */
export function isLikelyMenuPage(html) {
  if (typeof html !== "string") return false;
  const { text } = extractHtml(html);
  const prices = text.match(/\$\d{1,3}(?:\.\d{2})?/g) ?? [];
  const hasMenuWords = /\b(menu|entrees?|appetizers?|bowls?|sandwiches|burgers?|salads?)\b/i.test(text);
  return prices.length >= 3 && hasMenuWords;
}
