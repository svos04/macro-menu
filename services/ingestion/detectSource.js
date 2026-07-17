// services/ingestion/detectSource.js
// Decides what kind of thing the caller handed us.
//
// Note the deliberate split between INPUT KIND and SourceType. This module only
// answers "is this a URL, and does it point at a PDF?". Whether the result is
// `pdf_text` or `pdf_ocr_needed` cannot be known until the PDF has actually been
// opened and its text layer inspected — that call belongs to pdfExtractor.
// Conflating the two is how a scanned menu ends up silently reported as parsed.

const URL_RE = /^https?:\/\/\S+$/i;
const PDF_PATH_RE = /\.pdf(?:$|[?#])/i;

/**
 * @typedef {object} DetectedSource
 * @property {"url"|"raw_text"} inputType
 * @property {boolean} isPdfUrl
 * @property {string|null} url
 */

/**
 * @param {string|{url?: string, text?: string, contentType?: string}} input
 * @returns {DetectedSource}
 */
export function detectSource(input) {
  if (input && typeof input === "object") {
    if (input.url) {
      return {
        inputType: "url",
        isPdfUrl: isPdfUrl(input.url) || isPdfContentType(input.contentType),
        url: input.url
      };
    }
    return { inputType: "raw_text", isPdfUrl: false, url: null };
  }

  const value = String(input ?? "").trim();
  // A URL is a single token. Anything with whitespace is pasted menu text, even
  // if it happens to begin with "http".
  if (URL_RE.test(value)) {
    return { inputType: "url", isPdfUrl: isPdfUrl(value), url: value };
  }
  return { inputType: "raw_text", isPdfUrl: false, url: null };
}

/** @param {string} url */
export function isPdfUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const { pathname, search } = new URL(url);
    return PDF_PATH_RE.test(pathname) || PDF_PATH_RE.test(search);
  } catch {
    return PDF_PATH_RE.test(url);
  }
}

/** @param {string} [contentType] */
export function isPdfContentType(contentType) {
  return typeof contentType === "string" && /application\/pdf/i.test(contentType);
}

/**
 * Sniff a PDF by its magic bytes. More trustworthy than either the URL or the
 * Content-Type header, both of which servers get wrong routinely.
 * @param {Uint8Array} bytes
 */
export function looksLikePdfBytes(bytes) {
  if (!bytes || bytes.length < 5) return false;
  // "%PDF-"
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
