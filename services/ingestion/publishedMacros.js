// services/ingestion/publishedMacros.js
// Reads macros a restaurant printed on its own page.
//
// Chains publish exact nutrition next to the dish name, and the pipeline used
// to throw it away and guess: sweetgreen's Picnic Bowl says "580 Calories 29G
// Protein 39G Carbs 32G Fat" three lines under the title, and the estimator
// answered 275 cal / 10g protein from an ingredient dictionary. When the
// restaurant tells us, we listen.
//
// The bar for believing them is deliberately high. A wrong number here is worse
// than a missing one: it wears a "From the restaurant" label and a high
// confidence, so nothing about it invites the user to doubt it. Three rules:
//
//   1. ALL FOUR macros or nothing. A partial read (calories + protein, carbs
//      and fat estimated) would produce a meal whose provenance is half fact
//      and half guess, and no single label could describe it honestly.
//   2. Grams must be explicit for protein/carbs/fat. Without that rule
//      "$14.95 Protein Bowl" reads as 14.95g of protein.
//   3. The four numbers must agree with each other (see ATWATER_TOLERANCE).

/** A macro number: `580`, `29`, `4.5`. */
const NUMBER = String.raw`\d{1,4}(?:\.\d{1,2})?`;

/** `g`, `G`, `grams`. */
const GRAMS = String.raw`(?:grams?|gr|g)`;

/**
 * Fat qualified by a fatty-acid type is a sub-line of a nutrition panel, never
 * the total. Blanked before matching so "Saturated Fat 9g" can't answer for
 * "Total Fat 32g". Same for the fiber/sugar rows that sit under carbohydrate.
 */
const SUBLINE_PATTERNS = [
  /\b(?:saturated|sat\.?|trans|mono(?:un)?saturated|poly(?:un)?saturated|unsaturated)\s+fat\b/gi,
  /\bfat\s+calories\b/gi,
  /\bcalories\s+from\s+fat\b/gi,
  /\b(?:dietary\s+)?fib(?:er|re)\b/gi,
  /\b(?:added\s+|total\s+)?sugars?\b/gi
];

/**
 * Plausible ranges for a single restaurant menu item. A match outside these is
 * a number that happened to sit next to the right word.
 */
const RANGES = {
  calories: [20, 3000],
  protein_g: [0, 300],
  carbs_g: [0, 400],
  fat_g: [0, 300]
};

/**
 * How far the stated calories may sit from 4·protein + 4·carbs + 9·fat.
 *
 * The Atwater factors are approximate — fiber, sugar alcohols and alcohol all
 * push a real menu item off the sum — so this is a sanity check, not an audit.
 * Observed on sweetgreen: 2% (peach salad) to 19% (chicken caesar). It exists
 * to reject a misparse that grabbed a price, a calorie count from a neighboring
 * card, or a serving size, not to second-guess a nutritionist.
 */
export const ATWATER_TOLERANCE = 0.4;

/** Which macro a label names. Longest alternatives first, so "cal" can never
 *  shadow "calories" and "carb" can never shadow "carbohydrate". */
const LABELS = [
  ["calories", "calories"], ["calorie", "calories"], ["kcals", "calories"],
  ["kcal", "calories"], ["cals", "calories"], ["cal", "calories"],
  ["protein", "protein_g"],
  ["total carbohydrates", "carbs_g"], ["total carbohydrate", "carbs_g"],
  ["carbohydrates", "carbs_g"], ["carbohydrate", "carbs_g"],
  ["carbs", "carbs_g"], ["carb", "carbs_g"],
  ["total fat", "fat_g"], ["fat", "fat_g"]
];

const LABEL_RE = new RegExp(String.raw`\b(${LABELS.map(([text]) => text).join("|")})\b`, "gi");

/**
 * A number, with its grams unit if it carries one.
 *
 * The `(?<![\$\d.])` guard drops anything that is part of a price or of a
 * larger number: in "Steak Frites $28.00", neither `28` nor `00` is a macro.
 */
const NUMBER_RE = new RegExp(String.raw`(?<![\$\d.])(${NUMBER})\s*(${GRAMS})?(?![\w.])`, "gi");

/** Macros that must state their grams explicitly — see rule 2 up top. */
const REQUIRES_GRAMS = new Set(["protein_g", "carbs_g", "fat_g"]);

/**
 * How many unmatched `(` sit before each character of `text`. `depth[i] > 0`
 * means position `i` sits inside parentheses.
 * @param {string} text
 * @returns {number[]}
 */
function parenDepths(text) {
  const depth = new Array(text.length + 1);
  depth[0] = 0;
  for (let i = 0; i < text.length; i += 1) {
    depth[i + 1] = depth[i] + (text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0);
  }
  return depth;
}

/**
 * Read the text as an ordered run of number and label tokens.
 * @returns {Array<{kind: "number"|"label", index: number, inParens: boolean} & Record<string, any>>}
 */
function tokenize(text) {
  const tokens = [];
  const depth = parenDepths(text);

  for (const match of text.matchAll(NUMBER_RE)) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value)) {
      tokens.push({
        kind: "number",
        index: match.index,
        value,
        hasGrams: Boolean(match[2]),
        inParens: depth[match.index] > 0
      });
    }
  }
  for (const match of text.matchAll(LABEL_RE)) {
    const key = LABELS.find(([label]) => label === match[1].toLowerCase())[1];
    tokens.push({ kind: "label", index: match.index, key, inParens: depth[match.index] > 0 });
  }

  return tokens.sort((a, b) => a.index - b.index);
}

/**
 * Pair each label with its number.
 *
 * Adjacent nutrients make a purely local regex ambiguous: in "Protein: 41 g
 * Total Carbohydrate: 45 g", the number 41 sits directly before the carbohydrate
 * label and directly after the protein label. Nothing about that one pairing
 * says who owns it. What resolves it is that a page states ALL its nutrients the
 * same way round, so we read the whole run under one orientation and keep the
 * one that accounts for every macro:
 *
 *   value first  "580 Calories 29G Protein"    (sweetgreen, Chipotle)
 *   label first  "Calories: 580 Protein: 41 g" (nutrition panels)
 *
 * @param {ReturnType<typeof tokenize>} tokens
 * @param {"value_first"|"label_first"} orientation
 * @param {"first"|"last"} tieBreak Which occurrence wins when a label repeats
 *   — see parsePublishedMacros for why both are tried.
 * @returns {Record<string, number>|null} null if any macro is unaccounted for.
 */
function assign(tokens, orientation, tieBreak) {
  const step = orientation === "value_first" ? -1 : 1;
  /** @type {Record<string, Array<{value: number, inParens: boolean}>>} */
  const candidatesByKey = {};

  for (let i = 0; i < tokens.length; i += 1) {
    const label = tokens[i];
    if (label.kind !== "label") continue;

    const neighbor = tokens[i + step];
    if (!neighbor || neighbor.kind !== "number") continue;
    if (REQUIRES_GRAMS.has(label.key) && !neighbor.hasGrams) continue;

    const [min, max] = RANGES[label.key];
    if (neighbor.value < min || neighbor.value > max) continue;

    (candidatesByKey[label.key] ??= []).push({
      value: neighbor.value,
      inParens: label.inParens || neighbor.inParens
    });
  }

  /** @type {Record<string, number>} */
  const macros = {};
  for (const key of Object.keys(RANGES)) {
    const candidates = candidatesByKey[key];
    if (!candidates || candidates.length === 0) continue;

    // A total stated plainly outranks one stated in parentheses. Chopt prints
    // "WITH BASIL CAESAR (110 Cals) ... 455 cal" — the parenthetical is the
    // DRESSING's own calorie count, not the dish's, and a real total is
    // essentially never itself parenthesized. Only trust the parenthetical
    // figure when the card states nothing else for this macro at all — True
    // Food Kitchen's "(11g protein | 600 cal)" is the dish's ONLY statement
    // of either number, parentheses and all, so there is nothing to prefer it
    // over.
    const plain = candidates.filter((c) => !c.inParens);
    const pool = plain.length > 0 ? plain : candidates;
    macros[key] = tieBreak === "last" ? pool[pool.length - 1].value : pool[0].value;
  }

  const complete = Object.keys(RANGES).every((key) => key in macros);
  return complete ? macros : null;
}

/** Blank out sub-lines so they cannot answer for their totals. */
function stripSublines(text) {
  return SUBLINE_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, (match) => " ".repeat(match.length)),
    text
  );
}

/**
 * Do the four numbers describe the same dish?
 * @param {{calories: number, protein_g: number, carbs_g: number, fat_g: number}} macros
 */
export function macrosAreSelfConsistent({ calories, protein_g, carbs_g, fat_g }) {
  if (calories <= 0) return false;
  const fromMacros = 4 * protein_g + 4 * carbs_g + 9 * fat_g;
  return Math.abs(fromMacros - calories) <= ATWATER_TOLERANCE * calories;
}

/**
 * Pull whichever macros a menu item states, independently of whether all
 * four are present. True Food Kitchen prints "(11g protein | 600 cal)" under
 * a salad — no carbs, no fat, ever, on that page. parsePublishedMacros
 * correctly refuses that as a set (rule 1: all four or nothing), but there is
 * no reason for estimation to guess a protein figure or a calorie count the
 * page already gave it. Each macro is searched independently, in both
 * orientations, exactly the way parsePublishedCalories searched for calories
 * alone — never by requiring one orientation to account for every macro at
 * once, which is what parsePublishedMacros does and must keep doing for its
 * own "From the restaurant" guarantee.
 *
 * This does NOT relax rule 1. A result from this function is never labeled
 * as the restaurant's own numbers — it only tells estimation which macros it
 * can stop guessing at.
 *
 * @param {string} text
 * @returns {Partial<{calories: number, protein_g: number, carbs_g: number, fat_g: number}>}
 */
export function parsePublishedMacrosPartial(text) {
  if (typeof text !== "string" || text.length === 0) return {};

  const tokens = tokenize(stripSublines(text.replace(/\s+/g, " ")));
  /** @type {Partial<{calories: number, protein_g: number, carbs_g: number, fat_g: number}>} */
  const found = {};

  for (const key of Object.keys(RANGES)) {
    const [min, max] = RANGES[key];

    for (const orientation of ["value_first", "label_first"]) {
      const step = orientation === "value_first" ? -1 : 1;
      /** @type {Array<{value: number, inParens: boolean}>} */
      const candidates = [];

      for (let i = 0; i < tokens.length; i += 1) {
        const label = tokens[i];
        if (label.kind !== "label" || label.key !== key) continue;

        const neighbor = tokens[i + step];
        if (!neighbor || neighbor.kind !== "number") continue;
        if (REQUIRES_GRAMS.has(key) && !neighbor.hasGrams) continue;
        if (neighbor.value < min || neighbor.value > max) continue;

        candidates.push({ value: Math.round(neighbor.value), inParens: label.inParens || neighbor.inParens });
      }

      // Same rule as assign(): a plainly-stated number outranks one in
      // parentheses, which is usually qualifying an add-on rather than
      // stating the dish's own total — see assign() for the Chopt example.
      const plain = candidates.find((c) => !c.inParens);
      const matched = plain ? plain.value : candidates.length > 0 ? candidates[0].value : null;

      if (matched !== null) {
        found[key] = matched;
        break; // first orientation that finds this macro wins
      }
    }
  }

  return found;
}

/**
 * Pull just a published CALORIE count out of a menu item's text. A thin,
 * calories-only view over parsePublishedMacrosPartial — kept because callers
 * that only ever want the calorie anchor shouldn't have to unpack an object.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function parsePublishedCalories(text) {
  return parsePublishedMacrosPartial(text).calories ?? null;
}

/**
 * Pull restaurant-published macros out of a menu item's text.
 *
 * @param {string} text Flattened text of one menu item's container.
 * @returns {{calories: number, protein_g: number, carbs_g: number, fat_g: number}|null}
 *   null when the page does not publish a full, coherent set — the caller then
 *   falls back to estimation.
 */
export function parsePublishedMacros(text) {
  if (typeof text !== "string" || text.length === 0) return null;

  const tokens = tokenize(stripSublines(text.replace(/\s+/g, " ")));

  // Both orientations are tried with "first" before either is tried with
  // "last". A card that states its macros exactly once — sweetgreen, a bare
  // nutrition panel — resolves identically under "first" and "last", so this
  // ordering changes nothing for them; "last" only ever gets to decide a card
  // that "first" (in either orientation) could not.
  //
  // "last" exists for cards like Just Salad's: a short teaser badge
  // ("470 Cal ... 22G of Protein") sits before a full "Nutrition Facts" panel
  // ("Calories 470 ... Total Fat 29G ... Protein 22G") in the SAME item's
  // text. The teaser repeats "Calories" and "Protein" in value-first order
  // while the panel restates everything in label-first order — two different
  // orientations in one card. Reading the whole run under a single global
  // orientation and keeping each label's FIRST match makes the teaser's
  // protein number look like the panel's calorie count, and the result gets
  // rejected as inconsistent. Preferring the LAST occurrence of each label
  // finds the complete, correctly-ordered panel instead, because the panel is
  // what a card states last when it also states a summary first.
  const attempts = [
    ["value_first", "first"],
    ["label_first", "first"],
    ["value_first", "last"],
    ["label_first", "last"]
  ];

  for (const [orientation, tieBreak] of attempts) {
    const macros = assign(tokens, orientation, tieBreak);
    if (!macros) continue;

    const rounded = {
      calories: Math.round(macros.calories),
      protein_g: Math.round(macros.protein_g),
      carbs_g: Math.round(macros.carbs_g),
      fat_g: Math.round(macros.fat_g)
    };
    if (macrosAreSelfConsistent(rounded)) return rounded;
  }

  return null;
}
