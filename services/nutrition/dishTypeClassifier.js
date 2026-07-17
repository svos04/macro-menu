// services/nutrition/dishTypeClassifier.js
// Keyword rules mapping a dish onto the template that will portion it.
//
// RULE ORDER IS THE WHOLE ALGORITHM. The first match wins, so the list runs
// from most specific to least. "Burger Bowl" is a burger; "Chicken Alfredo" is
// pasta even though the word "pasta" never appears; "Steak Plate" only reaches
// the generic `plate` rule because nothing above it matched.
//
// Signals are consulted in order of authority: the dish name (what the
// restaurant calls it), then the description, then the section heading. A
// heading is the weakest signal because "Lunch" and "Favorites" say nothing
// about form, and a salad listed under "Bowls" is still a salad.

const DISH_RULES = [
  // \b cannot see inside "cheeseburger", so it is spelled out.
  { dishType: "burger", re: /\b(cheese)?burgers?\b|\bpatty melt\b|\bsmash ?burger\b/i },
  { dishType: "taco", re: /\btacos?\b/i },
  // Fajitas before pizza/pasta/plate: a big protein plus a stack of tortillas,
  // peppers and guacamole the diner assembles. Costed as a plate it lost the
  // tortillas entirely and read ~700 cal against a real ~1,300.
  { dishType: "fajita", re: /\bfajitas?\b/i },
  { dishType: "pizza", re: /\bpizzas?\b|\bflatbreads?\b|\bcalzone\b/i },
  {
    dishType: "pasta",
    re: /\b(pasta|spaghetti|fettuccine|linguine|rigatoni|penne|lasagna|alfredo|carbonara|bolognese|mac (and|&) cheese|noodles?)\b/i
  },
  // Burrito must precede wrap: a burrito is a wrap by shape but carries rice and
  // beans a plain wrap does not, so it has its own heavier template.
  { dishType: "burrito", re: /\bburritos?\b|\bchimichangas?\b/i },
  { dishType: "wrap", re: /\bwraps?\b/i },
  // Parmigiana before plate/pasta: a breaded cutlet over a full pasta portion
  // with melted cheese. "Chicken Parmesan" would otherwise fall to `plate` (via
  // the bare "chicken" rule) and be costed with a rice base and no breading.
  {
    dishType: "parmigiana",
    re: /\b(chicken|veal|eggplant|shrimp) parm(igiana|esan)?\b|\bparmigiana\b/i
  },
  {
    dishType: "sandwich",
    re: /\bsandwich(es)?\b|\bsubs?\b|\bclub\b|\bpanini\b|\bhoagie\b|\bmelt\b|\bblt\b|\btorta\b|\bcheesesteak\b|\bbanh mi\b/i
  },
  { dishType: "salad_with_protein", re: /\bsalads?\b/i },
  { dishType: "bowl", re: /\bbowls?\b|\bpoke\b/i },
  // "chili" the stew, NOT the pepper: a negative lookahead keeps "chili glaze",
  // "chili oil", "chili crisp", "sweet chili", etc. — ubiquitous on Asian menus —
  // from typing a fried cauliflower or a glazed wing as soup.
  {
    dishType: "soup",
    re: /\bsoups?\b|\bchili\b(?!\s*(?:glaze|oil|crisp|crunch|sauce|paste|flake|caramel|lime|garlic|aioli|mayo|butter|jam))|\bstew\b|\bramen\b|\bpho\b|\bchowder\b/i
  },
  // Sushi before the bare-protein plate rule below: "Seared Salmon Sushi" names
  // salmon, which the plate rule would otherwise read as a plated fillet. A
  // "<fish> roll" is sushi too, but "roll" is gated on a fish/sushi word so a
  // lobster roll (a sandwich), spring roll, or egg roll doesn't match.
  { dishType: "sushi", re: /\b(sushi|nigiri|sashimi|temaki|uramaki|hosomaki|omakase|hand roll)\b/i },
  {
    dishType: "sushi",
    re: /\b(tuna|salmon|ahi|yellowtail|hamachi|crab|california|dragon|rainbow|eel|unagi|tempura|tobiko)\b[\w '&-]*\broll\b/i
  },
  {
    // nameOnly: a bare protein noun classifies a dish only when it is the dish's
    // NAME ("Grilled Salmon" -> plate). In a description these words are just
    // ingredients — nearly every salad, bowl, and wrap lists "chicken" — so
    // letting them match a description would mistype a "Green Goddess" salad
    // (described as "Chicken Adobado, ...") as a plate.
    dishType: "plate",
    nameOnly: true,
    re: /\b(plates?|platters?|entr[ée]e|combo|halibut|salmon|sea ?bass|branzino|cod|seabass|cioppino|filet|rib[- ]?eye|ny strip|new york|sirloin|strip|tomahawk|porterhouse|t[- ]?bone|steak|ribs?|pork|chicken|katsu|piccata)\b/i
  }
];

/** Section headings that vouch for a dish type. Used only for confidence. */
const SECTION_TO_DISH_TYPE = [
  { dishType: "bowl", re: /^(bowls?|rice bowls?|grain bowls?|poke bowls?)$/i },
  { dishType: "salad_with_protein", re: /^salads?$/i },
  { dishType: "sandwich", re: /^(sandwiches|handhelds?|subs?)$/i },
  { dishType: "burger", re: /^(burgers?|smash burgers?)$/i },
  { dishType: "wrap", re: /^wraps?$/i },
  { dishType: "burrito", re: /^burritos?$/i },
  { dishType: "taco", re: /^tacos?$/i },
  { dishType: "pasta", re: /^pastas?$/i },
  { dishType: "pizza", re: /^pizzas?$/i },
  { dishType: "sushi", re: /^(sushi|nigiri|sashimi|rolls?|hand rolls?|maki)$/i },
  { dishType: "plate", re: /^(plates?|protein plates?|platters?|steaks?)$/i },
  { dishType: "soup", re: /^soups?$/i }
];

/**
 * @typedef {object} DishTypeResult
 * @property {import("../../types/menu.js").DishType} dishType
 * @property {"name"|"description"|"section"|"none"} matchedOn
 * @property {boolean} sectionSupportsDishType
 */

/**
 * @param {object} item
 * @param {string} item.dishName
 * @param {string} [item.description]
 * @param {string} [item.section]
 * @returns {DishTypeResult}
 */
export function classifyDishType({ dishName, description = "", section = "" }) {
  const fromName = matchRules(dishName);
  const fromDescription = fromName ? null : matchRules(description, { nameOnly: false });
  const fromSection = sectionDishType(section);

  let dishType = "unknown";
  let matchedOn = "none";

  if (fromName) {
    dishType = fromName;
    matchedOn = "name";
  } else if (fromDescription) {
    dishType = fromDescription;
    matchedOn = "description";
  } else if (fromSection) {
    // Last resort. A "Chef's Selection" under "Bowls" is a bowl, probably.
    dishType = fromSection;
    matchedOn = "section";
  }

  return {
    dishType,
    matchedOn,
    // Only meaningful when something other than the section decided the type.
    sectionSupportsDishType:
      matchedOn !== "none" && matchedOn !== "section" && fromSection === dishType
  };
}

/**
 * @param {string} text
 * @param {{nameOnly?: boolean}} [opts] When matching a description, pass
 *   `{ nameOnly: false }` to skip rules that are only valid against a dish name.
 */
function matchRules(text, opts = { nameOnly: true }) {
  if (!text) return null;
  const allowNameOnly = opts.nameOnly !== false;
  const rule = DISH_RULES.find((r) => (allowNameOnly || !r.nameOnly) && r.re.test(text));
  return rule ? rule.dishType : null;
}

/** @param {string} section */
function sectionDishType(section) {
  if (!section) return null;
  const trimmed = section.trim().replace(/[:.]+$/, "");
  const rule = SECTION_TO_DISH_TYPE.find((r) => r.re.test(trimmed));
  return rule ? rule.dishType : null;
}
