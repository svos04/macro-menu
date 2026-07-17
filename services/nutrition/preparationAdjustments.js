// services/nutrition/preparationAdjustments.js
// How a dish is COOKED, not what it contains.
//
// Adjustments run in two phases, because they are not all the same kind of
// thing and applying them at the wrong time gives the wrong answer:
//
//   Portion phase (before costing)
//     "double protein" doubles an ingredient's portion. It must happen while
//     portions are still numbers, not after they've been turned into calories.
//
//   Macro phase (after costing)
//     "crispy" adds breading that no ingredient in the description names. It is
//     a delta on the finished macros.
//
// THE DOUBLE-COUNTING GUARD
// The fried_chicken table entry already includes its breading. A dish reading
// "Crispy Chicken Sandwich — fried chicken, brioche bun" would otherwise be
// charged for that breading twice: once by the ingredient, once by the "crispy"
// signal. So a macro-phase delta is SUPPRESSED whenever an ingredient that
// already encodes the preparation was costed. The signal is still reported, so
// the assumption list stays honest about what we saw.

/** Macro deltas. Calories are derived (4/4/9) rather than stated separately, so
 *  an adjustment can never claim calories its own macros don't account for. */
const FRIED_DELTA = { protein_g: 0, carbs_g: 12, fat_g: 10 };
const CREAMY_DELTA = { protein_g: 0, carbs_g: 2, fat_g: 9 };
const SWEET_DELTA = { protein_g: 0, carbs_g: 15, fat_g: 0 };
// A CARAMEL / gochujang-caramel / char-siu glaze is not a teriyaki splash: it's
// reduced sugar plus oil or butter, generously coating the protein. ~200 cal,
// so a "glazed" light delta would leave a caramel-glazed entree reading lean.
const CARAMEL_GLAZE_DELTA = { protein_g: 0, carbs_g: 40, fat_g: 9 };
// Restaurant cooking fat for a grilled/roasted/seared protein — roughly 1.3 tsp
// of oil or butter (spec §8/§9 put a restaurant grilled entrée at 1–2 tsp).
// "Grilled" is not "dry": a plancha, a flat-top, and a roasting pan are all
// oiled, and leaving this out biases every lean-protein entrée low on fat and
// calories — the exact direction a dieter can least afford (spec §44.4).
const COOKING_FAT_DELTA = { protein_g: 0, carbs_g: 0, fat_g: 6 };

/** Nutrition keys that already price in each preparation. */
const FRIED_KEYS = new Set(["fried_chicken"]);
const CREAMY_KEYS = new Set([
  "mayo",
  "crema",
  "ranch_dressing",
  "caesar_dressing",
  "alfredo_sauce",
  "pesto"
]);
const SWEET_KEYS = new Set(["bbq_sauce", "teriyaki_sauce", "honey", "sweet_glaze"]);

// Lean proteins that arrive on the plate having been cooked in fat the menu
// never mentions. Excluded on purpose: fried_chicken (its entry already carries
// frying oil), and burger_patty/sausage/bacon/salmon/lamb (fatty enough that a
// further oil allowance would overstate them — spec §9 notes oily preparations
// need less added fat, not more).
const COOKING_FAT_PROTEIN_KEYS = new Set([
  "chicken_breast",
  "steak",
  "beef",
  "turkey",
  "shrimp",
  "white_fish",
  "tuna",
  "pork",
  "tofu"
]);

// If one of these was already costed, the dish's cooking fat is on the plate by
// name — don't add the hidden allowance on top (spec §9: never add cooking fat
// the selected entry already includes).
const EXPLICIT_COOKING_FAT_KEYS = new Set(["olive_oil", "butter"]);

const SIGNAL_PATTERNS = {
  fried: /\b(fried|crispy|breaded|battered|panko|tempura|katsu|crunchy)\b/i,
  // "smothered" and "au gratin" are indulgence words (spec §30) that reliably
  // mean a cream or cheese sauce even when no sauce is named outright.
  creamy: /\b(creamy|cream sauce|queso|alfredo|ranch|aioli|crema|smothered|au gratin|gratin)\b/i,
  sweet: /\b(glazed?|honey|teriyaki|bbq|barbecue|sweet chili|hoisin)\b/i,
  // Specific phrases only, so "caramelized onions" and "candied nuts" (already
  // costed elsewhere) don't trigger a 200-cal glaze delta.
  caramelGlaze: /\b(chili caramel|caramel glaze|gochujang|char ?siu|sticky soy)\b/i,
  // Only a "double/extra <portable protein>" add-on doubles the portion. A bare
  // "double" once matched everything — "double patties", "double cream" — and on
  // a burger it doubled an already-full 6 oz patty to a 12 oz slab (JOEY's
  // double-patty cheeseburger is 40 g protein, not the 87 g that produced). A
  // burger's patties are the dish, already sized by the template, so patty/patties
  // are deliberately excluded here.
  doubleProtein: /\b(double|extra)\s+(protein|chicken|beef|steak|meat|shrimp|prawns?|salmon|tuna|tofu)\b/i,
  extraCheese: /\b(extra|double) cheese\b/i,
  noBread: /\b(lettuce wrap(ped)?|no bun|bunless|protein style|no bread|no tortilla)\b/i,
  noCarb: /\b(low[- ]carb|keto|no rice)\b/i
};

/**
 * A menu-stated protein weight — "14 oz prime new york strip", "5 oz sirloin",
 * "8 oz salmon". The number is used as the protein portion instead of the
 * template default, which is what lets a 14 oz steak or a 22 oz ribeye stop
 * reading like a generic 6 oz plate. The ounces must sit right before a protein
 * cut (with the usual "prime/grilled/bone-in/top" qualifiers between), so a
 * "6 oz Fries" side or a "1 oz caviar" never scales the protein.
 */
const STATED_PROTEIN_OZ =
  /(\d+(?:\.\d+)?)\s*oz\.?\s+(?:of\s+)?(?:prime\s+|dry[- ]?aged\s+|bone[- ]?in\s+|blackened\s+|grilled\s+|seared\s+|top\s+|cab[®\s]+)*(sirloin|rib[- ]?eye|new york|ny\b|strip|filet|tenderloin|steak|porterhouse|t[- ]?bone|wagyu|chicken(?:\s+breast)?|breast|salmon|prawns?|shrimp|tuna|pork|lamb|halibut|cod)/i;

/** kcal from macro grams. */
function caloriesOf({ protein_g, carbs_g, fat_g }) {
  return protein_g * 4 + carbs_g * 4 + fat_g * 9;
}

/**
 * A steakhouse names the CUT in the dish title and leaves the weight standing
 * alone in the description — "Prime New York Strip" / "14 oz, our famous fully
 * loaded crispy mashed potatoes". The weight and the cut are never adjacent, so
 * STATED_PROTEIN_OZ can't see it. When the NAME is already a steak cut, a bare
 * weight is that steak's weight.
 *
 * Gated on a steak cut in the name specifically (not a generic "chicken"), and
 * the ounces must not belong to a side, so "Chicken Tenders … 6 oz fries" is
 * still left alone.
 */
const STEAK_CUT_IN_NAME =
  /\b(sirloin|rib[- ]?eye|new york|ny strip|strip|filet|tenderloin|porterhouse|t[- ]?bone|tomahawk|wagyu|steak)\b/i;
const BARE_OZ =
  /(\d+(?:\.\d+)?)\s*oz\b(?!\s*\.?\s*(?:fries|chips|rice|potatoes?|salad|slaw|vegetables?|sauce|dip|butter))/i;

const inRange = (oz) => (Number.isFinite(oz) && oz >= 4 && oz <= 40 ? oz : null);

/** The protein weight the menu stated in ounces, or null. Clamped to a sane
 *  4-40 oz so a stray number never produces an absurd portion. */
function parseStatedProteinOz(dishName, description) {
  const text = `${dishName} ${description}`;

  const adjacent = text.match(STATED_PROTEIN_OZ);
  if (adjacent) {
    const oz = inRange(Number.parseFloat(adjacent[1]));
    if (oz) return oz;
  }

  if (STEAK_CUT_IN_NAME.test(dishName)) {
    const bare = text.match(BARE_OZ);
    if (bare) return inRange(Number.parseFloat(bare[1]));
  }

  return null;
}

/**
 * @param {string} dishName
 * @param {string} [description]
 * @returns {Record<keyof typeof SIGNAL_PATTERNS, boolean> & {statedProteinOz: number|null}}
 */
export function detectPreparationSignals(dishName, description = "") {
  const text = `${dishName} ${description}`;
  const signals = {};
  for (const [name, re] of Object.entries(SIGNAL_PATTERNS)) {
    signals[name] = re.test(text);
  }
  signals.statedProteinOz = parseStatedProteinOz(dishName, description);
  return signals;
}

/**
 * Phase 1. Reshape portions before anything is costed.
 *
 * @param {import("../../data/portionTemplates.js").PortionSlot[]} slots
 * @param {ReturnType<typeof detectPreparationSignals>} signals
 * @returns {{slots: object[], assumptions: string[], applied: string[]}}
 */
export function applyPortionAdjustments(slots, signals) {
  const assumptions = [];
  const applied = [];
  let next = slots.map((s) => ({ ...s }));

  if (signals.doubleProtein) {
    next = next.map((s) =>
      s.slot === "protein" ? { ...s, amount: s.amount * 2 } : s
    );
    applied.push("doubleProtein");
    assumptions.push("Doubled the protein portion for a double/extra protein item.");
  }

  // A stated weight is an exact fact, so it overrides the template default (and
  // any doubling above). This is what sizes a 14 oz strip or 22 oz ribeye
  // correctly instead of costing every steak as a generic 6 oz portion.
  if (signals.statedProteinOz) {
    next = next.map((s) =>
      s.slot === "protein" ? { ...s, amount: signals.statedProteinOz } : s
    );
    applied.push("statedProteinWeight");
    assumptions.push(
      `Used the ${signals.statedProteinOz} oz protein portion stated on the menu.`
    );
  }

  if (signals.extraCheese) {
    next = next.map((s) =>
      // "Extra cheese" implies cheese even where the template wouldn't assume it.
      s.slot === "cheese" ? { ...s, amount: s.amount * 2, assumeWhenAbsent: true } : s
    );
    applied.push("extraCheese");
    assumptions.push("Doubled the cheese portion for an extra-cheese item.");
  }

  if (signals.noBread || signals.noCarb) {
    const dropped = new Set();
    if (signals.noBread) dropped.add("bread");
    if (signals.noCarb) {
      dropped.add("carb");
      dropped.add("bread");
    }
    const removed = next.filter((s) => dropped.has(s.slot)).map((s) => s.slot);
    next = next.filter((s) => !dropped.has(s.slot));
    if (removed.length > 0) {
      applied.push("noCarbBase");
      assumptions.push(
        `Removed the ${removed.join(" and ")} portion — the item is described as low-carb or served without it.`
      );
    }
  }

  return { slots: next, assumptions, applied };
}

/**
 * Phase 2. Add what the ingredients could not say.
 *
 * @param {import("../../types/menu.js").EstimatedMacros} macros
 * @param {ReturnType<typeof detectPreparationSignals>} signals
 * @param {Set<string>} costedKeys Nutrition keys already included in `macros`.
 * @returns {{macros: object, assumptions: string[], applied: string[]}}
 */
export function applyMacroAdjustments(macros, signals, costedKeys) {
  const assumptions = [];
  const applied = [];
  const out = { ...macros };

  const add = (delta, name, note) => {
    out.protein_g += delta.protein_g;
    out.carbs_g += delta.carbs_g;
    out.fat_g += delta.fat_g;
    out.calories += caloriesOf(delta);
    applied.push(name);
    assumptions.push(note);
  };

  const alreadyCounted = (keys) => [...keys].some((k) => costedKeys.has(k));

  if (signals.fried) {
    if (alreadyCounted(FRIED_KEYS)) {
      assumptions.push(
        "Fried/crispy preparation is already included in the fried chicken values."
      );
    } else {
      add(FRIED_DELTA, "fried", "Added breading and frying oil for a fried/crispy item.");
    }
  }

  if (signals.creamy) {
    if (alreadyCounted(CREAMY_KEYS)) {
      assumptions.push("Creamy preparation is already included in the sauce values.");
    } else {
      add(CREAMY_DELTA, "creamy", "Added fat for a creamy sauce or dressing.");
    }
  }

  // A caramel glaze outweighs a plain sweet glaze and takes its place — adding
  // both would double-count the sugar. Suppressed if a sweet sauce was costed.
  if (signals.caramelGlaze) {
    if (alreadyCounted(SWEET_KEYS)) {
      assumptions.push("Caramel glaze is already included in the sauce values.");
    } else {
      add(
        CARAMEL_GLAZE_DELTA,
        "caramelGlaze",
        "Added a caramel/gochujang glaze — reduced sugar plus oil, generously coating the protein."
      );
    }
  } else if (signals.sweet) {
    if (alreadyCounted(SWEET_KEYS)) {
      assumptions.push("Sweet glaze is already included in the sauce values.");
    } else {
      add(SWEET_DELTA, "sweet", "Added sugar for a glazed, honey, teriyaki, or BBQ item.");
    }
  }

  // Hidden cooking fat for a lean grilled/roasted protein. Skipped when the
  // protein was fried (its own oil is already in the entry) or when an explicit
  // cooking fat — olive oil, butter — was already costed for this dish.
  const leanProteinCosted = alreadyCounted(COOKING_FAT_PROTEIN_KEYS);
  const explicitFatCosted = alreadyCounted(EXPLICIT_COOKING_FAT_KEYS);
  if (leanProteinCosted && !signals.fried && !explicitFatCosted) {
    add(
      COOKING_FAT_DELTA,
      "cookingFat",
      "Added ~1–2 tsp of restaurant cooking oil — grilled and roasted proteins are rarely cooked dry."
    );
  }

  return { macros: out, assumptions, applied };
}
