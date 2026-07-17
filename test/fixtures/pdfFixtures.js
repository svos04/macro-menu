// test/fixtures/pdfFixtures.js
// Builds real (if minimal) PDF files in memory, so the PDF tests exercise the
// actual byte-level parser rather than a mock of it.
//
// Uses CompressionStream — the exact counterpart of the DecompressionStream the
// extractor relies on — which keeps the fixtures dependency-free too.

const encoder = new TextEncoder();

/** Escape the three characters a PDF literal string cares about. */
function escapePdfString(text) {
  return text.replace(/([\\()])/g, "\\$1");
}

/** One `Tj` per line, with a `Td` line feed between them. */
function contentStreamFor(lines) {
  const body = lines
    .map((line, i) => {
      const move = i === 0 ? "72 720 Td" : "0 -18 Td";
      return `${move} (${escapePdfString(line)}) Tj`;
    })
    .join("\n");
  return `BT\n/F1 12 Tf\n${body}\nET\n`;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * A one-page PDF whose text layer contains `lines`.
 * @param {string[]} lines
 * @param {{compress?: boolean}} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function buildTextPdf(lines, options = {}) {
  const raw = encoder.encode(contentStreamFor(lines));
  const stream = options.compress ? await deflate(raw) : raw;
  const filter = options.compress ? " /Filter /FlateDecode" : "";

  return concatBytes([
    encoder.encode(
      [
        "%PDF-1.4",
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        "3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj",
        `4 0 obj << /Length ${stream.length}${filter} >>`,
        "stream\n"
      ].join("\n")
    ),
    stream,
    encoder.encode(
      [
        "\nendstream",
        "endobj",
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
        "trailer << /Root 1 0 R >>",
        "%%EOF\n"
      ].join("\n")
    )
  ]);
}

/**
 * A PDF that has been saved twice, leaving an orphaned copy of its old page
 * content behind — exactly what Fratellino's dinner menu does.
 *
 * The live `3 0 obj` (the later one) points at the new content stream; the dead
 * one still points at the old. An extractor that scans every stream in the file
 * emits BOTH, duplicating the whole menu. Following the page tree emits only
 * `newLines`.
 *
 * @param {string[]} oldLines Superseded content. Must not appear in the output.
 * @param {string[]} newLines Live content.
 * @returns {Promise<Uint8Array>}
 */
export async function buildIncrementallyUpdatedPdf(oldLines, newLines) {
  const oldStream = encoder.encode(contentStreamFor(oldLines));
  const newStream = encoder.encode(contentStreamFor(newLines));

  return concatBytes([
    encoder.encode(
      [
        "%PDF-1.4",
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        // Revision 1: page 3 points at the old content stream.
        "3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj",
        `4 0 obj << /Length ${oldStream.length} >>`,
        "stream\n"
      ].join("\n")
    ),
    oldStream,
    encoder.encode(
      [
        "\nendstream",
        "endobj",
        "trailer << /Root 1 0 R >>",
        "%%EOF",
        // Revision 2 appended: page 3 is redefined to point at stream 5.
        "3 0 obj << /Type /Page /Parent 2 0 R /Contents 5 0 R >> endobj",
        `5 0 obj << /Length ${newStream.length} >>`,
        "stream\n"
      ].join("\n")
    ),
    newStream,
    encoder.encode(
      ["\nendstream", "endobj", "trailer << /Root 1 0 R >>", "%%EOF\n"].join("\n")
    )
  ]);
}

/**
 * A PDF whose page content is a JPEG (DCTDecode) with no /Subtype /Image to
 * give it away. The filter alone must be enough to skip it: handing JPEG bytes
 * to the operator scanner yields convincing-looking garbage.
 * @returns {Uint8Array}
 */
export function buildUnsupportedFilterPdf() {
  const jpegish = new Uint8Array(600).fill(0x5a);
  return concatBytes([
    encoder.encode(
      [
        "%PDF-1.4",
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        "3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj",
        `4 0 obj << /Length ${jpegish.length} /Filter /DCTDecode >>`,
        "stream\n"
      ].join("\n")
    ),
    jpegish,
    encoder.encode(
      ["\nendstream", "endobj", "trailer << /Root 1 0 R >>", "%%EOF\n"].join("\n")
    )
  ]);
}

/**
 * A one-page PDF containing a single image and no text layer — a scanned menu.
 * The extractor must report `pdf_ocr_needed` for this, not an empty success.
 * @returns {Uint8Array}
 */
export function buildImageOnlyPdf() {
  const imageBytes = new Uint8Array(512).fill(0x7f);
  return concatBytes([
    encoder.encode(
      [
        "%PDF-1.4",
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        "3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj",
        `4 0 obj << /Type /XObject /Subtype /Image /Width 8 /Height 8 /Length ${imageBytes.length} >>`,
        "stream\n"
      ].join("\n")
    ),
    imageBytes,
    encoder.encode(["\nendstream", "endobj", "trailer << /Root 1 0 R >>", "%%EOF\n"].join("\n"))
  ]);
}

/** The menu used across the pipeline tests. */
export const FIXTURE_MENU_LINES = [
  "BOWLS",
  "Baja Chicken Bowl 15.95",
  "Grilled chicken, brown rice, black beans, avocado, pico de gallo, chipotle crema",
  "Crispy Chicken Sandwich 14.50",
  "Fried chicken, brioche bun, slaw, pickles, spicy aioli",
  "SIDES",
  "French Fries 6.00",
  "DRINKS",
  "House Lemonade 4.00"
];

/**
 * The same menu with a third entree, long enough to clear the PDF extractor's
 * 200-character quality floor.
 *
 * The Steak Plate sits BEFORE the SIDES heading on purpose. A menu line's
 * section is whatever heading precedes it, so appending an entree after
 * "DRINKS" would — correctly — get it excluded as a drink.
 */
export const FIXTURE_MENU_LINES_LONG = [
  "BOWLS",
  "Baja Chicken Bowl 15.95",
  "Grilled chicken, brown rice, black beans, avocado, pico de gallo, chipotle crema",
  "Crispy Chicken Sandwich 14.50",
  "Fried chicken, brioche bun, slaw, pickles, spicy aioli",
  "Steak Plate 22.00",
  "Grilled sirloin, roasted potatoes, seasonal vegetables",
  "SIDES",
  "French Fries 6.00",
  "DRINKS",
  "House Lemonade 4.00"
];

/** The same menu as raw pasted text, blank lines and all. */
export const FIXTURE_MENU_TEXT = `BOWLS

Baja Chicken Bowl 15.95
Grilled chicken, brown rice, black beans, avocado, pico de gallo, chipotle crema

Crispy Chicken Sandwich 14.50
Fried chicken, brioche bun, slaw, pickles, spicy aioli

SIDES

French Fries 6.00

DRINKS

House Lemonade 4.00
`;
