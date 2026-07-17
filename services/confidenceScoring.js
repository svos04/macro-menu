// services/confidenceScoring.js
// Confidence scoring for the two things V1 guesses at: how well we PARSED an
// item off the page, and how well we ESTIMATED its macros.
//
// Both live here rather than beside their callers so the numbers can be tuned
// together. A parse confidence of 0.9 next to a macro confidence of 0.4 tells a
// coherent story ("we read it correctly, we're unsure what's in it"); the two
// scales drifting apart does not.
//
// Both are clamped to 0..1. Macro confidence carries an additional ceiling —
// see MAX_MACRO_CONFIDENCE.

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Parse confidence
// ---------------------------------------------------------------------------
// Weights are tuned so a fully-structured item — section heading, clean 2–6
// word name, a description, and a price — lands at 0.86 rather than 1.0.
// Nothing we infer from a regex over a stranger's HTML deserves certainty.

export const PARSE_CONFIDENCE = Object.freeze({
  BASE: 0.3,
  NAME_QUALITY_MAX: 0.16,
  HAS_DESCRIPTION: 0.15,
  HAS_PRICE: 0.15,
  HAS_SECTION: 0.1,
  VAGUE_NAME_PENALTY: 0.15
});

/**
 * A dish name reads as clean when it's 2–6 words of mostly letters. One-word
 * names ("Tacos") are legitimate but ambiguous; ten-word names are usually a
 * description we misread as a name.
 */
function nameQuality(dishName) {
  const words = dishName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  let quality = 1;
  if (words.length === 1) quality -= 0.4;
  if (words.length > 6) quality -= 0.3;
  if (words.length > 8) quality -= 0.3;
  // Digits in a name usually mean we swallowed a price or a "3 pc" count.
  if (/\d/.test(dishName)) quality -= 0.3;

  return clamp01(quality);
}

/**
 * @param {object} item
 * @param {string} item.dishName
 * @param {string} [item.description]
 * @param {number} [item.price]
 * @param {string} [item.section]
 * @returns {number} 0..1
 */
export function scoreParseConfidence({ dishName, description, price, section }) {
  const W = PARSE_CONFIDENCE;
  let score = W.BASE;

  score += W.NAME_QUALITY_MAX * nameQuality(dishName);
  if (description) score += W.HAS_DESCRIPTION;
  if (typeof price === "number") score += W.HAS_PRICE;
  if (section) score += W.HAS_SECTION;
  if (isVagueName(dishName)) score -= W.VAGUE_NAME_PENALTY;

  return round2(clamp01(score));
}

// ---------------------------------------------------------------------------
// Vague names
// ---------------------------------------------------------------------------
// Items whose name tells us nothing about what is in them. We can still parse
// them perfectly; we simply cannot estimate them.

// Apostrophes are matched in both straight and curly form: text that reaches
// here from an HTML page has been normalized, but a caller passing a raw string
// straight to estimateMacros() has not.
const VAGUE_NAME_PATTERNS = [
  /\bchef['’]?s? (special|choice|selection)\b/i,
  /\bhouse (special|specialty)\b/i,
  /\b(daily|today['’]?s|seasonal) (special|selection|plate|catch)\b/i,
  /\bmarket (fish|plate|price|special)\b/i,
  /\bcatch of the day\b/i,
  /\bask your server\b/i,
  /\bspecial of the day\b/i
];

/** @param {string} dishName */
export function isVagueName(dishName) {
  return VAGUE_NAME_PATTERNS.some((re) => re.test(dishName));
}

// ---------------------------------------------------------------------------
// Macro confidence
// ---------------------------------------------------------------------------

export const MACRO_CONFIDENCE = Object.freeze({
  BASE: 0.3,
  DISH_TYPE_IDENTIFIED: 0.15,
  PROTEIN_DETECTED: 0.15,
  HAS_DESCRIPTION: 0.1,
  THREE_PLUS_INGREDIENTS: 0.1,
  CORE_INGREDIENTS_MAPPED: 0.1,
  SECTION_SUPPORTS_DISH_TYPE: 0.05,

  DISH_TYPE_UNKNOWN: 0.1,
  NO_DESCRIPTION: 0.1,
  MANY_UNKNOWN_INGREDIENTS: 0.1,
  VAGUE_NAME: 0.15
});

/**
 * Hard ceiling on macro confidence.
 *
 * Every number in nutritionTable.js is an assumption, and every portion in
 * portionTemplates.js is a guess. Even a perfectly parsed item with a fully
 * mapped ingredient list is an estimate of a dish nobody weighed. Reporting
 * 0.95 here would contradict the warning we attach to every result.
 *
 * This ceiling is the one place to raise the cap once real nutrition lookups
 * (USDA, Open Food Facts) start replacing table entries.
 */
export const MAX_MACRO_CONFIDENCE = 0.85;

/**
 * Floor below which an estimate is not worth showing.
 *
 * An item with no description, no recognizable dish type, and no detected
 * ingredients — "Skate Grenobloise" on a real menu — still produces macros,
 * because the fallback portion template assumes a cup of rice and a cup of
 * vegetables. Those numbers describe the template, not the dish.
 *
 * Ranking such an item would be worse than omitting it: it occupies a slot a
 * real meal could have had, and a low-confidence badge does not undo the
 * impression made by a concrete calorie count. Suppressed items are still
 * reported in `excludedItems` with a reason, so nothing disappears silently.
 *
 * Callers can override this per-extraction via `minMacroConfidence`.
 */
export const MIN_MACRO_CONFIDENCE = 0.3;

/**
 * At least this share of a description's ingredient phrases must map to a known
 * ingredient, or we treat the item as mostly unknown.
 */
const MIN_MATCHED_PHRASE_RATIO = 0.5;

/**
 * @param {object} signals
 * @param {string} signals.dishName
 * @param {import("../types/menu.js").DishType} signals.dishType
 * @param {string} [signals.description]
 * @param {boolean} signals.proteinDetected
 * @param {number} signals.ingredientCount
 * @param {boolean} signals.coreIngredientsMapped
 * @param {boolean} signals.sectionSupportsDishType
 * @param {{total: number, matched: number}} signals.phraseStats
 * @returns {number} 0..MAX_MACRO_CONFIDENCE
 */
export function scoreMacroConfidence(signals) {
  const W = MACRO_CONFIDENCE;
  const hasDescription = Boolean(signals.description);
  const dishTypeKnown = signals.dishType !== "unknown";

  let score = W.BASE;

  if (dishTypeKnown) score += W.DISH_TYPE_IDENTIFIED;
  else score -= W.DISH_TYPE_UNKNOWN;

  if (signals.proteinDetected) score += W.PROTEIN_DETECTED;

  if (hasDescription) score += W.HAS_DESCRIPTION;
  else score -= W.NO_DESCRIPTION;

  if (signals.ingredientCount >= 3) score += W.THREE_PLUS_INGREDIENTS;
  if (signals.coreIngredientsMapped) score += W.CORE_INGREDIENTS_MAPPED;
  if (signals.sectionSupportsDishType) score += W.SECTION_SUPPORTS_DISH_TYPE;

  if (hasManyUnknownIngredients(signals.phraseStats)) {
    score -= W.MANY_UNKNOWN_INGREDIENTS;
  }
  if (isVagueName(signals.dishName)) score -= W.VAGUE_NAME;

  return round2(Math.min(clamp01(score), MAX_MACRO_CONFIDENCE));
}

/**
 * True when most of the comma-separated phrases in a description produced no
 * ingredient match — i.e. the dish is made of things we've never heard of.
 */
export function hasManyUnknownIngredients(phraseStats) {
  if (!phraseStats || phraseStats.total === 0) return false;
  return phraseStats.matched / phraseStats.total < MIN_MATCHED_PHRASE_RATIO;
}

/**
 * Bucket a 0..1 confidence into the labels the existing UI already speaks.
 * @returns {"high"|"medium"|"low"}
 */
export function confidenceLabel(confidence) {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}
