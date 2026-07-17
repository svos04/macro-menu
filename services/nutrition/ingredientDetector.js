// services/nutrition/ingredientDetector.js
// Finds known ingredients in a dish name + description.
//
// The matcher is longest-alias-first with SPAN CONSUMPTION: once "crispy
// chicken" claims characters 0..14, no shorter alias may match inside them. That
// one rule is what makes the synonym table work. Without it, "crispy chicken"
// yields both fried chicken AND chicken breast, and the dish gets two proteins.
//
// It also reports how much of the description it failed to understand. A dish
// described entirely in words we don't know is a dish we should not claim to
// have estimated, and `phraseStats` is what lets confidenceScoring say so.

import { ALIAS_INDEX } from "../../data/ingredientDictionary.js";

/** Multi-word aliases are specific enough to trust; bare nouns less so. */
const MULTIWORD_CONFIDENCE = 0.9;
const SINGLE_WORD_CONFIDENCE = 0.75;

/** Connectives restaurants use to join ingredients in a description. */
const PHRASE_SPLIT_RE = /,|;|\band\b|\bwith\b|\bover\b|\btopped with\b|&/i;

/** Punctuation → space, so "pico de gallo," matches the alias "pico de gallo". */
function normalizeForMatch(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @typedef {object} DetectionResult
 * @property {Array<{definition: object, rawText: string, confidence: number, index: number}>} matches
 * @property {{total: number, matched: number}} phraseStats
 */

/**
 * @param {string} dishName
 * @param {string} [description]
 * @returns {DetectionResult}
 */
export function detectIngredients(dishName, description = "") {
  const haystack = normalizeForMatch(`${dishName} ${description}`);
  const claimed = new Array(haystack.length).fill(false);

  /** @type {Map<string, {definition: object, rawText: string, confidence: number, index: number}>} */
  const byName = new Map();

  for (const { alias, def } of ALIAS_INDEX) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "g");
    let match;
    while ((match = re.exec(haystack)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      let overlaps = false;
      for (let k = start; k < end; k += 1) {
        if (claimed[k]) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      for (let k = start; k < end; k += 1) claimed[k] = true;

      // One ingredient per normalized name. "Fried chicken" in the name and
      // again in the description is one protein, not two.
      if (!byName.has(def.normalizedName)) {
        byName.set(def.normalizedName, {
          definition: def,
          rawText: match[0],
          confidence:
            alias.includes(" ") ? MULTIWORD_CONFIDENCE : SINGLE_WORD_CONFIDENCE,
          index: start
        });
      }
    }
  }

  const matches = [...byName.values()].sort((a, b) => a.index - b.index);
  return { matches, phraseStats: measurePhrases(description, matches) };
}

/**
 * What fraction of the description's ingredient phrases did we recognize?
 *
 * "Grilled chicken, brown rice, black beans" is three phrases, three matched.
 * "Za'atar cauliflower, sumac labneh" is two phrases, zero matched — and that
 * item should not report a confident macro estimate.
 */
function measurePhrases(description, matches) {
  if (!description) return { total: 0, matched: 0 };

  const phrases = description
    .split(PHRASE_SPLIT_RE)
    .map((p) => normalizeForMatch(p))
    .filter((p) => p.length >= 3);

  if (phrases.length === 0) return { total: 0, matched: 0 };

  const matchedTexts = matches.map((m) => m.rawText);
  const matched = phrases.filter((phrase) =>
    matchedTexts.some((text) => phrase.includes(text))
  ).length;

  return { total: phrases.length, matched };
}

/**
 * Shape a raw match for the public output.
 * @returns {import("../../types/menu.js").DetectedIngredient}
 */
export function toDetectedIngredient(match, countedInMacros) {
  return {
    rawText: match.rawText,
    normalizedName: match.definition.normalizedName,
    category: match.definition.category,
    confidence: match.confidence,
    countedInMacros
  };
}
