// services/ingestion/menuParser.js
// Turns normalized lines into {section, dishName, description, price}.
//
// The parser is a small state machine over lines rather than a grammar, because
// menus are not grammatical. It leans on three signals, in order of reliability:
//
//   1. A trailing price ends a dish name. Nearly universal.
//   2. A blank line ends an item. Strong when present, absent on dense PDFs.
//   3. Line shape. A 3-word line is a name; a 9-word line with commas is a
//      description. Weakest, and only consulted when 1 and 2 say nothing.
//
// Both menu layouts in the spec fall out of these rules without special cases:
//
//     Baja Chicken Bowl 15.95            Baja Chicken Bowl
//     Grilled chicken, brown rice...     $15.95
//                                        Grilled chicken, brown rice...

import {
  isAllCaps,
  isPriceOnly,
  normalizeMenuText,
  parsePrice,
  splitTrailingPrice,
  wordCount
} from "./textNormalizer.js";
import { isKnownSectionName } from "./entreeFilter.js";
import { scoreParseConfidence } from "../confidenceScoring.js";
import { parsePublishedMacros, parsePublishedMacrosPartial } from "./publishedMacros.js";

/** A dish name longer than this is almost certainly a description. */
const MAX_NAME_WORDS = 10;

/** Section headings are short. */
const MAX_SECTION_WORDS = 5;

/** A description is at least this many words, unless it carries a comma. */
const MIN_DESCRIPTION_WORDS = 5;

/**
 * PDF menus wrap descriptions across several lines and put the price at the
 * end of the last one, so a description can legitimately run this long. The
 * loop stops early on the next dish name, which is the reliable terminator.
 */
const MAX_DESCRIPTION_LINES = 4;

/**
 * Share of a line's meaningful words that must be capitalized for it to read as
 * a dish name.
 *
 * This is the single most useful discriminator on real menus, because
 * restaurants Title Case Their Dish Names and write descriptions in prose:
 *
 *   "Small Garden Salad"                          -> 3/3 capitalized -> name
 *   "tomato, carrots, pepperoncini, and croutons" -> 0/4             -> prose
 *   "All salads include garlic bread"             -> 1/4             -> prose
 *
 * Without it, every wrapped description line becomes a phantom menu item.
 */
const MIN_NAME_CAP_RATIO = 0.5;

/** Ignored when measuring capitalization — nobody capitalizes these. */
const NAME_STOPWORDS = new Set([
  "and", "or", "of", "with", "the", "a", "an", "in", "on", "for",
  "to", "de", "la", "el", "our", "your", "my", "at", "by", "w"
]);

/**
 * @typedef {object} ParsedCandidate
 * @property {string} [section]
 * @property {string} dishName
 * @property {string} [description]
 * @property {number} [price]
 * @property {number} parseConfidence
 */

/**
 * Many PDF menus are typeset entirely in capitals. There, ALL CAPS carries no
 * information, so the only headings we trust are ones we recognize by name.
 * @param {string[]} lines
 */
function documentIsAllCaps(lines) {
  const content = lines.filter((l) => l !== "" && /[a-zA-Z]/.test(l));
  if (content.length < 4) return false;
  const caps = content.filter(isAllCaps).length;
  return caps / content.length > 0.8;
}

/**
 * @param {string} line
 * @param {string|undefined} nextLine
 * @param {boolean} allCapsDoc
 */
function isSectionHeader(line, nextLine, allCapsDoc) {
  if (isPriceOnly(line)) return false;
  if (splitTrailingPrice(line).price !== null) return false;
  if (line.includes(",")) return false;
  if (/[.!?]$/.test(line)) return false;
  if (wordCount(line) > MAX_SECTION_WORDS) return false;

  // "BAJA CHICKEN BOWL" followed by "$15.95" is a dish, not a heading. Without
  // this lookahead, every all-caps menu loses its first item per section.
  if (nextLine !== undefined && isPriceOnly(nextLine)) return false;
  if (nextLine !== undefined) {
    const { text: nextText, price: nextPrice } = splitTrailingPrice(nextLine);
    if (nextPrice !== null && isDescriptionLine(nextText)) return false;
  }

  if (isKnownSectionName(line)) return true;
  return !allCapsDoc && isAllCaps(line);
}

/** Fraction of meaningful words that begin with a capital. @param {string} text */
function capitalizationRatio(text) {
  const words = text
    .split(/\s+/)
    .filter((w) => /[a-zA-Z]/.test(w))
    .filter((w) => !NAME_STOPWORDS.has(w.replace(/[^a-zA-Z]/g, "").toLowerCase()));

  if (words.length === 0) return 0;
  const capitalized = words.filter((w) => /^[^a-zA-Z]*[A-Z]/.test(w)).length;
  return capitalized / words.length;
}

/**
 * @param {string} line Text with any trailing price already removed.
 * @param {boolean} allCapsDoc
 */
function isDishNameCandidate(line, allCapsDoc) {
  if (line === "" || !/[a-zA-Z]/.test(line)) return false;
  if (wordCount(line) > MAX_NAME_WORDS) return false;

  // A leftover price inside the line means this is a price row
  // ("Small $5.75  Large $7.50"), not a dish name.
  if (line.includes("$") || /\d+\.\d{2}/.test(line)) return false;

  // Dish names are labels, not sentences.
  if (/[.!?]$/.test(line)) return false;

  // A comma means a list of ingredients. Dish names don't enumerate.
  if (line.includes(",")) return false;

  // A size row: `Small 10"  Medium 12"  Extra Large 16"`. Title-cased and
  // comma-free, so nothing above catches it, but it names no dish.
  if (/\d\s*"/.test(line)) return false;

  // In an all-caps document, capitalization says nothing — the same reason
  // isSectionHeader stops trusting ALL CAPS there. The comma and length rules
  // above are all we have, and they are enough.
  if (allCapsDoc && isAllCaps(line)) return true;

  return capitalizationRatio(line) >= MIN_NAME_CAP_RATIO;
}

/**
 * Descriptions are prose-ish: commas, or simply long. A short line without a
 * comma is the next dish name.
 * @param {string} line
 */
function isDescriptionLine(line) {
  if (line === "" || !/[a-zA-Z]/.test(line)) return false;
  if (line.includes(",")) return wordCount(line) >= 2;
  if (/[.]$/.test(line)) return true;
  return wordCount(line) >= MIN_DESCRIPTION_WORDS;
}

/**
 * Parse normalized lines into menu item candidates.
 *
 * Inclusion (entree vs drink) is NOT decided here — see entreeFilter. Keeping
 * parsing free of product policy means a change to what counts as an entree
 * never risks changing how text is read.
 *
 * @param {string[]} lines Output of normalizeMenuText().lines
 * @returns {ParsedCandidate[]}
 */
export function parseMenuLines(lines) {
  const allCapsDoc = documentIsAllCaps(lines);
  /** @type {ParsedCandidate[]} */
  const items = [];

  let section;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line === "") {
      i += 1;
      continue;
    }

    if (isSectionHeader(line, lines[i + 1], allCapsDoc)) {
      section = line.replace(/[:.]+$/, "").trim();
      i += 1;
      continue;
    }

    const { text: nameText, price: inlinePrice } = splitTrailingPrice(line);

    // A price with no name before it, and no item open to attach it to.
    if (nameText === "" || !isDishNameCandidate(nameText, allCapsDoc)) {
      i += 1;
      continue;
    }

    i += 1;
    let price = inlinePrice;

    // Layout 2: the price sits on its own line beneath the name.
    if (price === null && i < lines.length && isPriceOnly(lines[i])) {
      price = parsePrice(lines[i]);
      i += 1;
    }

    const description = [];
    while (i < lines.length && lines[i] !== "" && description.length < MAX_DESCRIPTION_LINES) {
      const candidate = lines[i];
      if (isSectionHeader(candidate, lines[i + 1], allCapsDoc)) break;
      if (isPriceOnly(candidate)) break;

      const { text: stripped, price: trailingPrice } = splitTrailingPrice(candidate);

      // An annotation carrying the price: "(8) $9.85", "(1/2 lb) 14.00".
      // Nothing to say about the dish, but the price belongs to it.
      if (trailingPrice !== null && !/[a-zA-Z]/.test(stripped)) {
        if (price === null) price = trailingPrice;
        i += 1;
        continue;
      }

      // A trailing price does NOT necessarily open the next item. Print menus
      // routinely end a wrapped description with the price:
      //   "tomato, carrots, pepperoncini, and croutons. $5.75"
      // Only a title-cased line is the next dish.
      if (isDishNameCandidate(stripped, allCapsDoc)) break;
      if (!isDescriptionLine(stripped)) break;

      description.push(stripped);
      if (trailingPrice !== null && price === null) price = trailingPrice;
      i += 1;
    }

    items.push(buildCandidate({ section, dishName: nameText, description, price }));
  }

  return items;
}

/**
 * @returns {ParsedCandidate & {publishedMacros?: object, publishedPartialMacros?: object}}
 */
function buildCandidate({ section, dishName, description, price }) {
  const joined = description.join(" ").trim();

  /** @type {any} */
  const item = { dishName: dishName.trim(), parseConfidence: 0 };
  if (section) item.section = section;
  if (joined) item.description = joined;
  if (price !== null && price !== undefined) item.price = price;

  // A site whose markup gives extractDomItems nothing to work with — no
  // element resembling an "item" or "card" by name, page-builder div soup,
  // Tailwind utility classes with no semantic hook — still lands here, on the
  // flat-text fallback. Its dish still might state its own macros in plain
  // words right next to the description: True Food Kitchen prints
  // "(11g protein | 600 cal)" inside the very paragraph this function just
  // joined. Without this, that number is thrown away and macros are guessed
  // from an ingredient dictionary instead of read off the page — the fallback
  // parser silently lost a capability the DOM parser has always had.
  const macroText = [dishName, joined].filter(Boolean).join(" ");
  const published = parsePublishedMacros(macroText);
  if (published) {
    item.publishedMacros = published;
  } else {
    const partial = parsePublishedMacrosPartial(macroText);
    if (Object.keys(partial).length > 0) item.publishedPartialMacros = partial;
  }

  item.parseConfidence = scoreParseConfidence(item);
  return item;
}

/**
 * Convenience wrapper for callers holding raw text rather than normalized lines.
 * @param {string} text
 * @returns {ParsedCandidate[]}
 */
export function parseMenuText(text) {
  return parseMenuLines(normalizeMenuText(text).lines);
}
