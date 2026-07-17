// services/ingestion/domMenuExtractor.js
// Turns the raw blocks content/pageSnapshot.js reads off the page into the same
// candidate shape menuParser.js produces from lines of text.
//
// WHY THIS EXISTS RATHER THAN A FIX TO menuParser.js
//
// menuParser reconstructs structure from a flat string, because that is all a
// PDF or a pasted menu ever gives it. Its rules are inferences: a title-cased
// line is a name, a blank line ends an item, a trailing number is a price. Each
// one was forced into existence by a real menu, and each one is a guess.
//
// A rendered page does not need to be guessed at. The restaurant already told
// us which element is the name and which is the description. Flattening that to
// text and re-inferring it is strictly lossy, and it fails in three ways that
// have nothing to do with the menu:
//
//   - CSS `text-transform: uppercase` makes every dish name look like an
//     ALL-CAPS section heading, so "Picnic Bowl" is read as a heading and the
//     dish under it disappears.
//   - Block elements put a blank line between a name and its description, and
//     a blank line is precisely menuParser's "this item is over" signal.
//   - A calorie count is a bare 3-digit number, which is also what a price is.
//
// So the DOM gets its own path. menuParser keeps its rules and its PDF tests;
// nothing here can regress them.

import { scoreParseConfidence } from "../confidenceScoring.js";
import { parsePublishedMacros, parsePublishedMacrosPartial } from "./publishedMacros.js";
import { splitTrailingPrice } from "./textNormalizer.js";

const MAX_NAME_LENGTH = 90;
const MAX_NAME_WORDS = 12;
const MAX_DESCRIPTION_LENGTH = 400;
const MAX_SECTION_LENGTH = 60;

/** How much of an item's text we will read looking for macros. */
const MAX_ITEM_TEXT_LENGTH = 4000;

/** A price anywhere in the item's text: `$15.95`, `$ 15`. */
const PRICE_IN_TEXT = /\$\s*(\d{1,3}(?:\.\d{1,2})?)(?!\d)/;

/**
 * An allergen line is not a description. "Contains milk, wheat, tree nuts"
 * enumerates like a description and sits right where one goes, but feeding it
 * to the ingredient detector puts milk and nuts into a dish that has neither.
 */
const ALLERGEN_LINE = /^\s*(?:contains|allergens?|may contain)\b/i;

/**
 * A nutrition label is not a dish. content/pageSnapshot.js already refuses to
 * name an item "Calories", but this module is the boundary every caller crosses
 * and the check is one regex.
 */
const MACRO_LABEL = /^(?:calories|calorie|kcals?|cals?|cal|protein|carbs?|carbohydrates?|(?:total )?fat)$/i;

/**
 * Everything here arrives from an arbitrary website, so every field is coerced
 * to a string and clipped before it is looked at.
 * @param {unknown} value
 * @param {number} maxLength
 */
function clean(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * Strip a trailing footnote marker from a dish name: "Grilled Chicken Club*" ->
 * "Grilled Chicken Club". Menus hang an asterisk or dagger off any dish carrying
 * the raw/undercooked disclaimer, and it is punctuation, not part of the name.
 */
function stripFootnoteMarker(name) {
  return name.replace(/[*†‡+^]+$/, "").trim();
}

/** @param {string} name */
function isUsableName(name) {
  if (name.length < 3) return false;
  // A name has at least one real word: "29G" is a value from a nutrition list.
  if (!/[A-Za-z]{3,}/.test(name)) return false;
  if (/[.!?]$/.test(name)) return false;
  if (MACRO_LABEL.test(name)) return false;
  return name.split(/\s+/).length <= MAX_NAME_WORDS;
}

/**
 * @param {{name?: string, description?: string, section?: string, text?: string}} raw
 * @returns {import("./menuParser.js").ParsedCandidate & {publishedMacros?: object, publishedPartialMacros?: object} | null}
 */
function toCandidate(raw) {
  const text = clean(raw?.text, MAX_ITEM_TEXT_LENGTH);

  // A price can be printed inside the name ("Baja Bowl 15.95") or anywhere in
  // the card. The name is the more reliable place, so it wins.
  const { text: namePart, price: namePrice } = splitTrailingPrice(clean(raw?.name, MAX_NAME_LENGTH));
  const dishName = stripFootnoteMarker(namePart.trim());
  if (!isUsableName(dishName)) return null;

  const descriptionText = clean(raw?.description, MAX_DESCRIPTION_LENGTH);
  const description = ALLERGEN_LINE.test(descriptionText) ? "" : descriptionText;
  const section = clean(raw?.section, MAX_SECTION_LENGTH);

  const priceFromText = text.match(PRICE_IN_TEXT);
  const price = namePrice ?? (priceFromText ? Number.parseFloat(priceFromText[1]) : null);

  /** @type {any} */
  const candidate = { dishName, parseConfidence: 0 };
  if (section) candidate.section = section;
  if (description) candidate.description = description;
  if (price !== null && Number.isFinite(price)) candidate.price = price;

  const published = parsePublishedMacros(text);
  if (published) {
    candidate.publishedMacros = published;
  } else {
    const partial = parsePublishedMacrosPartial(text);
    if (Object.keys(partial).length > 0) candidate.publishedPartialMacros = partial;
  }

  candidate.parseConfidence = scoreParseConfidence(candidate);
  return candidate;
}

/**
 * @param {Array<{name?: string, description?: string, section?: string, text?: string}>} rawItems
 *   Output of snapshotRenderedPage().items
 * @returns {Array<import("./menuParser.js").ParsedCandidate & {publishedMacros?: object, publishedPartialMacros?: object}>}
 */
export function extractDomItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const seen = new Set();
  const candidates = [];

  for (const raw of rawItems) {
    const candidate = toCandidate(raw);
    if (!candidate) continue;

    // The same dish can be rendered twice — a mobile and a desktop layout, or a
    // "featured" carousel above the list it also appears in.
    const key = `${candidate.dishName}|${candidate.description ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push(candidate);
  }

  return candidates;
}
