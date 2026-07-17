// services/nutrition/macroEstimator.js
// Turns a parsed menu item into estimated macros, plus every assumption we made
// getting there.
//
// The pipeline, in order:
//
//   1. Classify the dish type            -> which portion template applies
//   2. Detect ingredients                -> what's actually in it
//   3. Adjust portions ("double protein")
//   4. Fill each template slot           -> detected ingredients first
//   5. Fill remaining structural slots   -> template defaults
//   6. Sum
//   7. Adjust macros ("crispy")
//   8. Score confidence
//
// Two rules do most of the work, and both exist to keep the estimate honest:
//
//   NEVER INVENT PROTEIN. Structural slots (a bun, a base grain) are assumed
//   because the dish type guarantees them. Protein is assumed only where the
//   dish name *is* the protein — a burger has a patty. A "Veggie Bowl" with no
//   protein simply scores as a low-protein meal, which is the truth.
//
//   NEVER COST A SIDE. An ingredient whose slot the template doesn't define is
//   counted only if it's a cheese, sauce, or fat — small and definitional.
//   A carb or vegetable outside its slot ("served with fries") is a side, and
//   charging the entree for it would silently add 365 calories.

import {
  lookupNutritionEntry,
  macrosOf,
  scaleEntry
} from "../../data/nutritionTable.js";
import {
  COSTED_WHEN_UNSLOTTED,
  FALLBACK_DISH_TYPE,
  templateFor
} from "../../data/portionTemplates.js";
import { MACRO_SOURCE_ESTIMATED } from "../../types/menu.js";
import { scoreMacroConfidence } from "../confidenceScoring.js";
import { classifyDishType } from "./dishTypeClassifier.js";
import { detectIngredients, toDetectedIngredient } from "./ingredientDetector.js";
import {
  applyMacroAdjustments,
  applyPortionAdjustments,
  detectPreparationSignals
} from "./preparationAdjustments.js";

/** Slots that count as a dish's "base" for the core-ingredients confidence check. */
const BASE_SLOTS = new Set(["carb", "bread", "vegetable"]);

const zeroMacros = () => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

function addMacros(target, delta) {
  target.calories += delta.calories;
  target.protein_g += delta.protein_g;
  target.carbs_g += delta.carbs_g;
  target.fat_g += delta.fat_g;
}

/**
 * Calories to the nearest 5, grams to the nearest 1.
 * Rounding to 5 is a deliberate signal: a number ending in 7 looks measured.
 */
function roundMacros(macros) {
  return {
    calories: Math.max(0, Math.round(macros.calories / 5) * 5),
    protein_g: Math.max(0, Math.round(macros.protein_g)),
    carbs_g: Math.max(0, Math.round(macros.carbs_g)),
    fat_g: Math.max(0, Math.round(macros.fat_g))
  };
}

/** How each macro is named in an assumption sentence, and its unit suffix. */
const PUBLISHED_OVERRIDE_LABELS = {
  calories: ["calorie count", ""],
  protein_g: ["protein", "g"],
  carbs_g: ["carb count", "g"],
  fat_g: ["fat count", "g"]
};

/**
 * Replace whichever estimated macros the restaurant already told us, one key
 * at a time. A macro `published` doesn't have stays exactly as estimated.
 */
function applyPublishedOverrides(estimatedMacros, published, assumptions) {
  if (!published) return estimatedMacros;

  const out = { ...estimatedMacros };
  for (const key of Object.keys(PUBLISHED_OVERRIDE_LABELS)) {
    const value = published[key];
    if (!Number.isFinite(value)) continue;

    out[key] = value;
    const [label, unit] = PUBLISHED_OVERRIDE_LABELS[key];
    assumptions.push(`Used the ${label} printed on the menu (${value}${unit}) instead of estimating it.`);
  }
  return out;
}

const article = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** "1 cup", "3 cups", "5 oz", "1.5 tbsp". Only cup/serving take a plural. */
function portionPhrase(amount, unit) {
  const pluralizes = unit === "serving" || unit === "cup";
  const noun = pluralizes && amount !== 1 ? `${unit}s` : unit;
  return `${amount} ${noun}`;
}

/**
 * Estimate macros for one parsed menu item.
 *
 * @param {object} item
 * @param {string} item.dishName
 * @param {string} [item.description]
 * @param {string} [item.section]
 * @param {object} [options]
 * @param {object} [options.publishedMacros] Whichever macros the restaurant
 *   printed but not as a complete set (see publishedMacros.js's
 *   parsePublishedMacrosPartial) — e.g. `{ calories: 600, protein_g: 11 }`
 *   when a card states protein and calories but never carbs or fat. Each key
 *   present overrides that one estimated figure; keys it doesn't have stay
 *   estimates. There is no reason to guess a number the restaurant already
 *   told us, one macro at a time, the way estimating the whole dish from
 *   scratch otherwise would.
 * @returns {{dishType: string, detectedIngredients: object[], estimatedMacros: object,
 *            macroSource: string, macroConfidence: number, assumptions: string[]}}
 */
export function estimateMacros(item, options = {}) {
  const { dishName, description = "", section = "" } = item;
  const { publishedMacros } = options;

  const { dishType, sectionSupportsDishType } = classifyDishType({
    dishName,
    description,
    section
  });
  const { matches, phraseStats } = detectIngredients(dishName, description);
  const signals = detectPreparationSignals(dishName, description);

  const assumptions = [];
  if (dishType === "unknown") {
    assumptions.push(
      `Dish type not recognized; used generic ${FALLBACK_DISH_TYPE} portions.`
    );
  }

  const template = templateFor(dishType);
  const portioned = applyPortionAdjustments(template.slots, signals);
  assumptions.push(...portioned.assumptions);

  const dishLabel = dishType === "unknown" ? FALLBACK_DISH_TYPE : dishType;
  const costed = costIngredients({
    slots: portioned.slots,
    matches,
    dishLabel: dishLabel.replace(/_/g, " ")
  });
  assumptions.push(...costed.assumptions);

  const adjusted = applyMacroAdjustments(costed.macros, signals, costed.costedKeys);
  assumptions.push(...adjusted.assumptions);

  const proteinDetected = matches.some((m) => m.definition.slot === "protein");
  const macroConfidence = scoreMacroConfidence({
    dishName,
    dishType,
    description,
    proteinDetected,
    ingredientCount: matches.length,
    coreIngredientsMapped: costed.filledSlots.has("protein") && hasBase(costed.filledSlots),
    sectionSupportsDishType,
    phraseStats
  });

  const estimatedMacros = applyPublishedOverrides(
    roundMacros(adjusted.macros),
    publishedMacros,
    assumptions
  );

  return {
    dishType,
    detectedIngredients: matches.map((m) =>
      toDetectedIngredient(m, costed.countedNames.has(m.definition.normalizedName))
    ),
    estimatedMacros,
    macroSource: MACRO_SOURCE_ESTIMATED,
    macroConfidence,
    assumptions
  };
}

/** @param {Set<string>} filledSlots */
function hasBase(filledSlots) {
  return [...BASE_SLOTS].some((slot) => filledSlots.has(slot));
}

/**
 * Fill the template's slots from detected ingredients, then from defaults.
 * Returns the summed macros and a full account of what went in.
 */
function costIngredients({ slots, matches, dishLabel }) {
  const macros = zeroMacros();
  const assumptions = [];
  const costedKeys = new Set();
  const countedNames = new Set();
  const filledSlots = new Set();

  const slotDefs = new Map(slots.map((s) => [s.slot, s]));

  /** @type {Map<string, typeof matches>} */
  const bySlot = new Map();
  for (const match of matches) {
    const slot = match.definition.slot;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(match);
  }

  const count = (match, delta) => {
    addMacros(macros, delta);
    costedKeys.add(match.definition.nutritionKey);
    countedNames.add(match.definition.normalizedName);
  };

  for (const [slotName, group] of bySlot) {
    const slot = slotDefs.get(slotName);

    // Condiments are garnish quantities. Always exactly one serving, never
    // scaled up to fill a portion — a bowl has no full cup of pico de gallo.
    const condiments = group.filter((m) => entryOf(m)?.condiment);
    const bulk = group.filter((m) => !entryOf(m)?.condiment);

    for (const match of condiments) {
      const entry = entryOf(match);
      if (!entry) continue;
      count(match, macrosOf(entry, 1));
      assumptions.push(`Assumed 1 standard serving of ${entry.label}.`);
      filledSlots.add(slotName);
    }

    if (bulk.length === 0) continue;

    if (!slot) {
      if (!COSTED_WHEN_UNSLOTTED.includes(slotName)) {
        // Reported in detectedIngredients with countedInMacros: false.
        for (const match of bulk) {
          const entry = entryOf(match);
          if (entry) {
            assumptions.push(
              `Did not count ${entry.label} — likely a side or garnish rather than part of ${article(dishLabel)} ${dishLabel}.`
            );
          }
        }
        continue;
      }
      for (const match of bulk) {
        const entry = entryOf(match);
        if (!entry) continue;
        count(match, macrosOf(entry, 1));
        assumptions.push(
          `Counted 1 standard serving of ${entry.label} (${article(dishLabel)} ${dishLabel} has no set ${slotName} portion).`
        );
      }
      continue;
    }

    // Two proteins in one dish split the protein portion between them.
    const share = slot.amount / bulk.length;
    for (const match of bulk) {
      const entry = entryOf(match);
      if (!entry) continue;

      const scaled = scaleEntry(entry, share, slot.unit);
      if (scaled) {
        count(match, scaled);
        assumptions.push(
          `Assumed ${portionPhrase(round1(share), slot.unit)} of ${entry.label}.`
        );
      } else {
        // Units disagree. Fall back to the entry's own serving rather than
        // inventing a conversion factor.
        count(match, macrosOf(entry, 1));
        assumptions.push(
          `Assumed 1 standard serving of ${entry.label} (portion units differ).`
        );
      }
    }
    filledSlots.add(slotName);
  }

  // Structural slots the description never mentioned.
  for (const slot of slots) {
    if (filledSlots.has(slot.slot)) continue;
    if (!slot.assumeWhenAbsent || !slot.default) continue;

    const entry = lookupNutritionEntry(slot.default);
    if (!entry) continue;

    const scaled = scaleEntry(entry, slot.amount, slot.unit) ?? macrosOf(entry, 1);
    addMacros(macros, scaled);
    costedKeys.add(slot.default);
    filledSlots.add(slot.slot);
    assumptions.push(
      `Assumed ${portionPhrase(slot.amount, slot.unit)} of ${entry.label} — typical for ${article(dishLabel)} ${dishLabel}.`
    );
  }

  return { macros, assumptions, costedKeys, countedNames, filledSlots };
}

function entryOf(match) {
  return lookupNutritionEntry(match.definition.nutritionKey);
}

const round1 = (n) => Math.round(n * 10) / 10;
