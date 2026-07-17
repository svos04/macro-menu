// services/ingestion/entreeFilter.js
// V1 ranks meals. Everything else — drinks, sides, desserts, add-ons — is noise
// that would crowd out the answer the user came for.
//
// This module also owns the section vocabulary, because deciding what a heading
// MEANS is the same job as deciding whether to keep what sits under it. The
// menu parser imports `isKnownSectionName` from here to recognize headings.
//
// Precedence is deliberate and order-dependent:
//
//   1. Excluded section  (a burger under "KIDS" is a kids item)
//   2. Excluded item     (a lemonade under "ENTREES" is still a lemonade)
//   3. Included section or recognizable dish type
//   4. Otherwise excluded — we could not tell it was a meal
//
// Rule 1 outranks rule 2 because the heading is the restaurant's own statement
// about the item. Rule 2 outranks rule 3 because headings are often sloppy.

// Headings on real menus are rarely a bare category word. Celebration
// Restaurant calls its entree section "DINNER & SUNDAY LUNCH ENTREES", and
// exact-equality matching silently dropped every dish under it.
//
// So classification matches CATEGORY WORDS anywhere in the heading. Heading
// *detection* (isKnownSectionName) stays anchored — see SECTION_HEADING_NAMES —
// because a loose rule there would read the dish "Grilled Chicken Salad" as a
// section header.

/**
 * Excluded sections. First match wins, so more specific patterns come first:
 * "SMALL PLATES" and "SIDE SALADS" each contain a word that would otherwise
 * mark them as entree sections.
 *
 * Exclusions are tested BEFORE inclusions. A heading naming both ("SANDWICHES
 * & SIDES") is therefore excluded. That is the conservative direction: omitting
 * a sandwich costs the user one option, while ranking a side as a meal breaks
 * the promise the product makes.
 */
const EXCLUDED_SECTIONS = [
  { re: /\bsmall plates\b/i, reason: "small plates section" },
  { re: /\bside salads?\b/i, reason: "side salads section" },
  { re: /\b(drinks|beverages|soft drinks|sodas?|juices?|coffee|tea|smoothies)\b/i, reason: "drinks section" },
  { re: /\b(cocktails?|beer|wine|spirits|bar menu|draft list|happy hour)\b/i, reason: "alcohol section" },
  { re: /\b(desserts?|sweets|pastries)\b/i, reason: "dessert section" },
  { re: /\b(sides?|side dishes|a la carte)\b/i, reason: "sides section" },
  { re: /\b(appetizers?|apps|starters|shareables?|snacks)\b/i, reason: "appetizers section" },
  { re: /\b(kids?|children'?s)\b/i, reason: "kids section" },
  { re: /\b(sauces?|dips?|dressings?)\b/i, reason: "sauces section" },
  { re: /\b(extras?|add[- ]?ons?|additions?|toppings?|modifiers?)\b/i, reason: "add-ons section" },
  { re: /\b(catering|family meals?|family style|party trays?)\b/i, reason: "catering section" }
];

/**
 * Add-on / "elevate your plate" sections: upsell items a diner adds TO an entree
 * — a lobster tail, extra shrimp, a sauce — not meals in their own right. We
 * still surface the food ones (a lean lobster tail has genuinely good macros),
 * but flag them as sides so the UI can say so and the ranking never crowns one
 * the best *meal*.
 *
 * This is also a trap the entree rules fall into on their own: "ELEVATE YOUR
 * PLATE" contains the word PLATE, which INCLUDED_SECTIONS reads as a plates
 * section — which is exactly how a $27 lobster-tail add-on came to rank as the
 * best entree on JOEY's menu.
 */
const ADD_ON_SECTIONS =
  /\belevate\b|\benhance\w*\b|\badd[- ]?ons?\b|\badditions?\b|\bupgrades?\b|\bmake it a meal\b|\bfor the table\b|\bpremium (sides?|additions?|add[- ]?ons?)\b|\ba la carte\b|\bon the side\b|\bsteak (sides?|enhancements?|additions?|toppers?)\b/i;

/** Sections whose items are entrees by default. */
const INCLUDED_SECTIONS = [
  /\blimited time\b/i,
  /\b(entrees?|entr[ée]es?|mains?|main courses?)\b/i,
  /\b(bowls?|rice bowls?|grain bowls?|poke bowls?)\b/i,
  /\bsalads?\b/i,
  /\b(burgers?|smash burgers?)\b/i,
  /\b(sandwiches|sandwhiches|handhelds?|subs?)\b/i,
  /\bwraps?\b/i,
  /\btacos?\b/i,
  /\b(plates?|platters?|steaks?)\b/i,
  /\bpastas?\b/i,
  /\bpizzas?\b/i,
  /\bsushi\b|\bnigiri\b|\bmaki\b/i,
  /\bsoups?\b/i,
  /\b(lunch|dinner|specialties|favorites|from the grill)\b/i
];

/**
 * Anchored names used only to recognize that a LINE is a heading. Loosening
 * these would turn dish names into section breaks.
 */
const SECTION_HEADING_NAMES = [
  /^limited time$/i,
  /^(entrees?|mains?|main courses?|main plates?)$/i,
  /^(bowls?|rice bowls?|grain bowls?|poke bowls?)$/i,
  /^salads?$/i,
  /^(burgers?|smash burgers?)$/i,
  /^(sandwiches|sandwhiches|handhelds?|subs?)$/i,
  /^wraps?$/i,
  /^tacos?$/i,
  /^(plates?|protein plates?|platters?)$/i,
  /^pastas?$/i,
  /^pizzas?$/i,
  /^(sushi|nigiri|sashimi|maki|hand rolls?)$/i,
  /^steaks?$/i,
  /^(soups?|deli sides?(&| and )soups?|deli sides? & soups?)$/i,
  /^(lunch|dinner|specialties|house favorites|favorites|from the grill)$/i,
  /^small plates$/i,
  /^side salads?$/i,
  /^(drinks|beverages|soft drinks|sodas?|juices?|coffee|tea|smoothies)$/i,
  /^(cocktails?|beer|wine|spirits|bar menu|draft list|happy hour)$/i,
  /^(desserts?|sweets|pastries)$/i,
  /^(sides?|side dishes|a la carte)$/i,
  /^(appetizers?|apps|starters|shareables?|snacks)$/i,
  /^(kids|kids? menu|children'?s menu|for the kids)$/i,
  /^(sauces?|dips?|dressings?)$/i,
  /^(extras?|add[- ]?ons?|additions?|toppings?|modifiers?)$/i,
  /^(catering|family meals?|family style|party trays?)$/i
];

/**
 * Items that are never entrees, whatever section they appear under.
 *
 * Most patterns are anchored to the whole name on purpose. A bare `/fries/`
 * would have excluded "Fish and Fries", and `/chips/` would have excluded
 * "Fish and Chips" — a real entree on thousands of menus.
 */
const EXCLUDED_ITEMS = [
  { re: /\b(lemonade|soda|coke|pepsi|sprite|iced tea|hot tea|latte|espresso|cappuccino|juice|smoothie|milkshake|horchata|kombucha)\b|^coffee$/i, reason: "drink" },
  { re: /\b(beer|ipa|lager|pilsner|wine|margarita|mojito|cocktail|sangria|mimosa)\b/i, reason: "alcohol" },
  { re: /\b(ice cream|gelato|brownie|cookie|churro|flan|tiramisu|cheesecake|sundae|pudding|milk shake)\b/i, reason: "dessert" },
  // Qualified on purpose: a bare /cake$/ would exclude "Crab Cakes" and a bare
  // /pie$/ would exclude "Shepherd's Pie". Both are entrees.
  { re: /\b(chocolate|carrot|lava|birthday|coffee) cakes?$/i, reason: "dessert" },
  { re: /\b(apple|pecan|key lime|pumpkin|cherry|banana cream) pie$/i, reason: "dessert" },
  { re: /^(french |sweet potato |curly |waffle |garlic )?fries$/i, reason: "side" },
  { re: /^(tortilla |pita |potato )?chips$/i, reason: "side" },
  { re: /^(onion rings|coleslaw|side salad|garlic bread|bread basket|mashed potatoes|rice)$/i, reason: "side" },
  { re: /^side of\b/i, reason: "side" },
  { re: /^(add|extra)\s/i, reason: "add-on" },
  { re: /^(kids?|kid'?s)\s/i, reason: "kids item" },
  // Bare condiment names, offered as a "choice of sauce" row.
  { re: /^(ranch|caesar|vinaigrette|bbq sauce|salsa|guacamole|aioli|hot sauce|pesto|marinara|alfredo|butter|olive oil)$/i, reason: "sauce" },

  // A bare sauce or dressing offered as a choice: "Marinara Sauce", "Pesto".
  // Capped at three words so "Spaghetti with Meat Sauce" — a real entree that
  // also ends in "sauce" — survives.
  { re: /^(?:[\w'-]+\s+){0,2}(sauces?|dressings?)$/i, reason: "sauce" },
  // A row listing two sauce options: "Meat Sauce  Alfredo Sauce".
  { re: /\bsauce\b.*\bsauce\b/i, reason: "sauce" },

  // Parenthetical modifiers that the parser saw as standalone lines,
  // e.g. "(Beef or Chicken)".
  { re: /^\(.*\)$/, reason: "modifier" },

  // Build-your-own rows describe no food, so there is nothing to estimate.
  { re: /^(choice of|make your own|create your own|build your own)\b/i, reason: "customizable item" }
];

/**
 * Family/catering portions. Excluded even inside an otherwise fine section.
 *
 * "serves 2" and up only: plenty of single entrees are annotated "(serves 1 or
 * 2)", and those are exactly the individually portioned items V1 wants.
 */
const SHARED_PORTION_RE = /\b(feeds|serves)\s*(?:[2-9]|\d{2,})\b|\bfamily (meal|pack|style|bundle)\b|\bparty (pack|tray|platter)\b|\bfor (two|four)\b/i;

/**
 * Does this line name a menu section? Used by the parser to spot headings.
 * @param {string} line
 */
export function isKnownSectionName(line) {
  const trimmed = line.trim().replace(/[:.]+$/, "");
  return SECTION_HEADING_NAMES.some((re) => re.test(trimmed));
}

/** @param {string} [section] */
function matchExcludedSection(section) {
  if (!section) return null;
  const trimmed = section.trim().replace(/[:.]+$/, "");
  return EXCLUDED_SECTIONS.find((s) => s.re.test(trimmed)) ?? null;
}

/** @param {string} [section] */
export function isIncludedSection(section) {
  if (!section) return false;
  const trimmed = section.trim().replace(/[:.]+$/, "");
  return INCLUDED_SECTIONS.some((re) => re.test(trimmed));
}

/** @param {string} [section] Does the heading read as an add-on / enhancement list? */
export function isAddOnSection(section) {
  if (!section) return false;
  return ADD_ON_SECTIONS.test(section.trim().replace(/[:.]+$/, ""));
}

/**
 * An item we're keeping that is really a side/add-on, not a meal. Gated on an
 * unrecognized dish type on purpose: a genuine entree that sits under — or is
 * mis-sectioned into — an add-on heading (JOEY's steaks land under "Elevate Your
 * Plate" once the menu is flattened to text) is kept a meal by its own dish type.
 * A "Lobster Tail" or "Garlic Lemon Shrimp" has no dish type, so it reads as the
 * side it is.
 *
 * @param {{section?: string, dishType: string}} item
 */
function looksLikeSide({ section, dishType }) {
  return dishType === "unknown" && isAddOnSection(section);
}

/**
 * Decide whether a parsed candidate is an entree worth ranking in V1.
 *
 * @param {object} candidate
 * @param {string} candidate.dishName
 * @param {string} [candidate.description]
 * @param {string} [candidate.section]
 * @param {import("../../types/menu.js").DishType} candidate.dishType
 * @returns {{includedInV1: boolean, exclusionReason?: string, isSide?: boolean}}
 */
export function classifyInclusion({ dishName, description = "", section, dishType }) {
  const excludedSection = matchExcludedSection(section);
  const haystack = `${dishName} ${description}`;

  // A catering/family section may still list individually portioned entrees.
  // Only the shared-portion language actually disqualifies them.
  if (excludedSection && /catering section/.test(excludedSection.reason)) {
    if (SHARED_PORTION_RE.test(haystack)) {
      return {
        includedInV1: false,
        exclusionReason: `Shared or family-sized portion in the "${section}" section`
      };
    }
  } else if (excludedSection) {
    return {
      includedInV1: false,
      exclusionReason: `Listed under the "${section}" ${excludedSection.reason}`
    };
  }

  const excludedItem = EXCLUDED_ITEMS.find((item) => item.re.test(dishName.trim()));
  if (excludedItem) {
    return { includedInV1: false, exclusionReason: `Item looks like a ${excludedItem.reason}` };
  }

  if (SHARED_PORTION_RE.test(haystack)) {
    return { includedInV1: false, exclusionReason: "Shared or family-sized portion" };
  }

  if (isIncludedSection(section) || dishType !== "unknown") {
    return { includedInV1: true, isSide: looksLikeSide({ section, dishType }) };
  }

  return {
    includedInV1: false,
    exclusionReason: "Could not identify this as an entree or meal"
  };
}
