// services/ingestion/textNormalizer.js
// Turns whatever text we scraped into lines the menu parser can reason about.
//
// The single most useful thing this module does is PRESERVE BLANK LINES. A
// blank line between menu items is the strongest structural signal a plain-text
// menu offers, and collapsing all whitespace — the obvious first instinct —
// throws it away. Everything else here is cleanup around that decision.

/** Matches a price token: `$14.95`, `14.95`, `$14`, `14`. */
export const PRICE_TOKEN = String.raw`\$?\d{1,3}(?:\.\d{1,2})?`;

/**
 * Lines a menu prints but nobody eats. Dropped before parsing so they can never
 * be mistaken for a dish name or swallowed into a description.
 */
const BOILERPLATE_PATTERNS = [
  /consuming raw or undercooked/i,
  /foodborne illness/i,
  /prices? (are )?(subject to change|may vary)/i,
  /\bgratuity\b/i,
  /please (inform|notify|alert) (your|the) server/i,
  /before placing your order/i,
  /\ballerg(y|en|ies)\b/i,
  /substitutions? (may be )?(charged|extra)/i,
  /\bcopyright\b|©\s*\d{4}/i,
  /all rights reserved/i,
  /^(v|vg|gf|df|n)\s*[=:-]/i, // dietary legend rows: "GF = gluten free"
  /add (chicken|steak|shrimp|salmon|tofu|protein|bacon)\b.{0,24}\$?\d/i,

  // Marketing and contact copy. Real menus are full of it, and a line like
  // "Join our Rewards Club" is otherwise a perfect dish name — title-cased,
  // four words — that the classifier reads as a sandwich (\bclub\b).
  /^(join|sign up|scan|follow us|visit us|please visit|order online|call us|book|reserve|download|subscribe)\b/i,
  /^get \d{1,2}%/i,
  /\b\d{1,2}% off\b/i,
  /\b(rewards club|gift cards?)\b/i,
  /\bqr code\b/i,
  /^@[\w.]+$/,
  /^www\.[\w.-]+/i,
  /\bhttps?:\/\//i,
  /^est\.?\s*\d{4}$/i,
  /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/ // phone number
];

/** Bullet and separator characters restaurants decorate lines with. */
const BULLET_CHARS = /^[\s*•·‣▪◦⁃∙\-–—]+/;

// NBSP, en/em/thin/hair spaces, narrow NBSP, and the ideographic space.
// Each code point is escaped so no accidental `-` range can form in the class.
const NON_BREAKING_SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;

// Zero-width space / non-joiner / joiner and the BOM. These break \b word
// boundaries while being invisible in every editor, so they go first.
const ZERO_WIDTH_CHARS = /[\u200b\u200c\u200d\ufeff]/g;

const SMART_DOUBLE_QUOTES = /[“”]/g;
const SMART_SINGLE_QUOTES = /[‘’]/g;

/**
 * Normalize raw menu text into trimmed lines, keeping blank lines as item
 * separators.
 *
 * @param {string} raw
 * @returns {{lines: string[], text: string}}
 */
export function normalizeMenuText(raw) {
  if (typeof raw !== "string" || raw.length === 0) return { lines: [], text: "" };

  const text = raw
    // NFKC folds fullwidth and ligature forms that PDFs love to emit.
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(NON_BREAKING_SPACES, " ")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(SMART_DOUBLE_QUOTES, '"')
    .replace(SMART_SINGLE_QUOTES, "'");

  const cleaned = [];
  for (const rawLine of text.split("\n")) {
    const line = normalizeLine(rawLine);
    if (line === "") {
      // Collapse runs of blank lines to a single separator.
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== "") cleaned.push("");
      continue;
    }
    if (isBoilerplate(line)) continue;
    cleaned.push(line);
  }
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") cleaned.pop();

  return { lines: cleaned, text: cleaned.join("\n") };
}

/** @param {string} line */
function normalizeLine(line) {
  return (
    line
      // Dot leaders: "Baja Chicken Bowl........15.95"
      .replace(/\.{2,}/g, " ")
      // Spaced dot leaders from PDFs: "Baja Chicken Bowl . . . . 15"
      .replace(/(?:\s*\.\s*){3,}/g, " ")
      // Long dash / underscore runs used as rules or leaders.
      .replace(/[–—_]{2,}/g, " ")
      .replace(BULLET_CHARS, "")
      // "$ 14.95" -> "$14.95"
      .replace(/\$\s+(?=\d)/g, "$")
      // "14 . 95" -> "14.95"
      .replace(/(\d)\s*\.\s*(\d{2})\b/g, "$1.$2")
      // Middot / pipe separators between name and price.
      .replace(/\s*[·|]\s*/g, " ")
      .replace(/[\t ]+/g, " ")
      .trim()
  );
}

/** @param {string} line */
export function isBoilerplate(line) {
  // A line of nothing but punctuation or symbols: "***", "---", "|".
  // Note this is the ONLY length-ish rule. A short line is not boilerplate —
  // "A" is a legitimate line, and dropping it would silently eat content.
  if (!/[a-zA-Z0-9]/.test(line)) return true;
  return BOILERPLATE_PATTERNS.some((re) => re.test(line));
}

/** @param {string} line */
export function isPriceOnly(line) {
  return new RegExp(`^${PRICE_TOKEN}$`).test(line.trim());
}

/**
 * Parse a price string into a number. `$15.95` -> 15.95.
 * @returns {number|null}
 */
export function parsePrice(token) {
  const n = Number.parseFloat(String(token).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// A trailing price, optionally a lunch/dinner pair ("14.95 / 18.95").
const TRAILING_PRICE_RE = new RegExp(
  `(?:^|\\s)(${PRICE_TOKEN})(?:\\s*[/|]\\s*${PRICE_TOKEN})?\\s*$`
);

/**
 * Split a trailing price off a line.
 *
 * A bare integer only counts as a price when it falls in 5..99 and carries no
 * decimal. That rule is what stops "Tacos 3" (a piece count) from being read as
 * a price, without needing a unit blocklist. When two prices are listed, the
 * first — normally the smaller, lunch-sized one — wins.
 *
 * @param {string} line
 * @returns {{text: string, price: number|null}}
 */
export function splitTrailingPrice(line) {
  const match = line.match(TRAILING_PRICE_RE);
  if (!match) return { text: line, price: null };

  const token = match[1];
  const price = parsePrice(token);
  if (price === null) return { text: line, price: null };

  const hasCurrency = token.includes("$");
  const hasDecimal = token.includes(".");
  const plausibleBareInteger = price >= 5 && price <= 99;
  if (!hasCurrency && !hasDecimal && !plausibleBareInteger) {
    return { text: line, price: null };
  }

  const text = line.slice(0, match.index).trim();
  // "15.95" alone is a price line, not a nameless dish.
  if (text === "") return { text: "", price };
  return { text, price };
}

/** @param {string} line */
export function wordCount(line) {
  return line.trim().split(/\s+/).filter(Boolean).length;
}

/** All-caps ignoring digits and punctuation. `"BOWLS"` -> true. */
export function isAllCaps(line) {
  return /[A-Z]/.test(line) && line === line.toUpperCase();
}
