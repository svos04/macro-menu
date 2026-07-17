// data/portionTemplates.js
// Default portion assumptions by dish type.
//
// THESE ARE ASSUMPTIONS, NOT FACTS. Every one of them ends up in the
// `assumptions` array of the item it shaped, so a user can see exactly what we
// guessed and disagree with it.
//
// Each slot answers three questions:
//
//   amount + unit     How much of whatever fills this slot?
//   default           What fills it when the description never says?
//   assumeWhenAbsent  Do we fill it at all when nothing was detected?
//
// `assumeWhenAbsent` is the interesting one. Structural slots are safe to
// assume — a burger has a bun whether or not the menu mentions one, and a bowl
// has a base grain. Protein is not: inventing chicken for a "Veggie Bowl" would
// invent 44g of protein and push it up the ranking. So protein is assumed only
// where the dish name *is* the protein (a burger has a patty by definition).
//
// When no protein is assumed the item simply scores as a low-protein meal,
// which scoringService already caps. Under-claiming is recoverable;
// over-claiming is the failure that loses a user's trust.

/**
 * @typedef {object} PortionSlot
 * @property {string} slot
 * @property {number} amount
 * @property {"oz"|"cup"|"tbsp"|"serving"} unit
 * @property {string} [default]         Nutrition table key.
 * @property {boolean} assumeWhenAbsent
 */

/** @type {Record<string, {slots: PortionSlot[]}>} */
export const PORTION_TEMPLATES = Object.freeze({
  bowl: {
    slots: [
      // 3.5 oz, not 5: like an entree salad, a restaurant bowl's protein is a
      // scoop/topping over a rice-and-veg base, not a plated fillet, and the base
      // (rice + beans/wontons + dressing) already carries 7-14 g of its own. A
      // 5 oz slot over-credited JOEY's poke (29 g), Mediterranean (30 g) and tofu
      // (16 g) bowls by 40-60%; 3.5 oz lands them within a few grams. A
      // Chipotle-style protein bowl still clears ~35 g here.
      { slot: "protein", amount: 3.5, unit: "oz", assumeWhenAbsent: false },
      { slot: "carb", amount: 1, unit: "cup", default: "white_rice", assumeWhenAbsent: true },
      { slot: "beans", amount: 0.5, unit: "cup", default: "black_beans", assumeWhenAbsent: false },
      { slot: "vegetable", amount: 1, unit: "cup", default: "vegetables", assumeWhenAbsent: true },
      { slot: "sauce", amount: 1.5, unit: "tbsp", assumeWhenAbsent: false },
      { slot: "fat", amount: 1, unit: "serving", assumeWhenAbsent: false }
    ]
  },

  salad_with_protein: {
    slots: [
      // 3.5 oz, not 5: an entree salad's protein is a topping, not a plated
      // fillet, and the name ("Chinese Chicken Salad") tempts an over-estimate.
      // The salad's other toppings (nuts, crispy carbs, dressing) add their own
      // protein, so a big protein slot double-counts. Under-claiming protein is
      // the safe direction for a dieter.
      { slot: "protein", amount: 3, unit: "oz", assumeWhenAbsent: false },
      { slot: "vegetable", amount: 3, unit: "cup", default: "leafy_greens", assumeWhenAbsent: true },
      // A salad's crunchy carbs (ramen, wontons, croutons, tortilla strips) are
      // part of the dish, not a side. No default: only costed when detected, so
      // a plain green salad still gets nothing here.
      { slot: "carb", amount: 0.5, unit: "cup", assumeWhenAbsent: false },
      // Salads arrive dressed, at a real ~2 fl oz (3 tbsp) restaurant pour.
      // Assuming otherwise would make every salad look ~200 cal leaner than it
      // is, which is exactly the error a dieter can't afford us to make.
      { slot: "sauce", amount: 3, unit: "tbsp", default: "vinaigrette", assumeWhenAbsent: true },
      { slot: "cheese", amount: 1, unit: "oz", assumeWhenAbsent: false },
      { slot: "fat", amount: 1, unit: "serving", assumeWhenAbsent: false }
    ]
  },

  sandwich: {
    slots: [
      // 3.5 oz, not 4: the bread, cheese and bacon already carry ~20 g of protein
      // between them, so a 4 oz fillet on top over-credits the total. (JOEY's
      // grilled chicken sandwich is 40 g protein all-in.)
      { slot: "protein", amount: 3.5, unit: "oz", assumeWhenAbsent: false },
      { slot: "bread", amount: 1, unit: "serving", default: "sandwich_bread", assumeWhenAbsent: true },
      { slot: "cheese", amount: 1, unit: "oz", assumeWhenAbsent: false },
      // 2 tbsp, not 1: a restaurant spreads aioli/spicy mayo across both faces of
      // the bread — the same "real pour, not a grocery teaspoon" lesson the salad
      // dressing slot learned. On a lean grilled chicken sandwich the spread is
      // the single largest fat source, and 1 tbsp left it reading ~40% light.
      { slot: "sauce", amount: 2, unit: "tbsp", default: "mayo", assumeWhenAbsent: false },
      // Not in the original spec template. Added so that detected vegetables
      // (slaw, lettuce) have somewhere to go instead of being silently dropped.
      { slot: "vegetable", amount: 0.5, unit: "cup", assumeWhenAbsent: false }
    ]
  },

  burger: {
    slots: [
      // The patty is the dish. Assuming it is not a leap.
      { slot: "protein", amount: 6, unit: "oz", default: "burger_patty", assumeWhenAbsent: true },
      { slot: "bread", amount: 1, unit: "serving", default: "burger_bun", assumeWhenAbsent: true },
      { slot: "cheese", amount: 1, unit: "oz", assumeWhenAbsent: false },
      { slot: "sauce", amount: 1, unit: "tbsp", default: "mayo", assumeWhenAbsent: true },
      { slot: "vegetable", amount: 0.5, unit: "cup", assumeWhenAbsent: false }
    ]
  },

  wrap: {
    slots: [
      { slot: "protein", amount: 4, unit: "oz", assumeWhenAbsent: false },
      { slot: "bread", amount: 1, unit: "serving", default: "tortilla", assumeWhenAbsent: true },
      { slot: "cheese", amount: 0.75, unit: "oz", assumeWhenAbsent: false },
      { slot: "sauce", amount: 1, unit: "tbsp", assumeWhenAbsent: false },
      { slot: "vegetable", amount: 0.5, unit: "cup", assumeWhenAbsent: false }
    ]
  },

  // A burrito is not a wrap. It wraps a large tortilla around rice AND beans on
  // top of the protein, which is why it needs its own template — the wrap
  // template would cost a thin tortilla and no starch, landing a burrito ~400
  // cal below the range real burritos occupy (spec §15, sanity check 700–1400).
  // Rice and beans are structural here (assumed when absent) because "burrito"
  // implies them the way "burger" implies a bun.
  burrito: {
    slots: [
      { slot: "bread", amount: 1, unit: "serving", default: "burrito_tortilla", assumeWhenAbsent: true },
      { slot: "protein", amount: 5, unit: "oz", assumeWhenAbsent: false },
      { slot: "carb", amount: 1, unit: "cup", default: "white_rice", assumeWhenAbsent: true },
      { slot: "beans", amount: 0.5, unit: "cup", default: "black_beans", assumeWhenAbsent: true },
      { slot: "cheese", amount: 1, unit: "oz", assumeWhenAbsent: false },
      { slot: "sauce", amount: 2, unit: "tbsp", assumeWhenAbsent: false },
      { slot: "fat", amount: 1, unit: "serving", assumeWhenAbsent: false }
    ]
  },

  // Fajitas: a large grilled protein served with a stack of tortillas, sauteed
  // peppers and onions, and guacamole to build your own. The tortilla stack is
  // most of the calories (JOEY's chicken fajitas carry ~140 g carb), so the bread
  // is structural. Protein defaults to a generous entree portion and is resized
  // when the menu states an ounce weight.
  fajita: {
    slots: [
      { slot: "protein", amount: 6, unit: "oz", assumeWhenAbsent: false },
      { slot: "bread", amount: 3, unit: "serving", default: "tortilla", assumeWhenAbsent: true },
      { slot: "vegetable", amount: 1, unit: "cup", default: "peppers", assumeWhenAbsent: true },
      { slot: "fat", amount: 1, unit: "serving", assumeWhenAbsent: false },
      { slot: "sauce", amount: 2, unit: "tbsp", assumeWhenAbsent: false }
    ]
  },

  // Not in the original spec's template list, but "taco" is a DishType and an
  // included V1 section, so it needs portions or it estimates to nothing.
  taco: {
    slots: [
      { slot: "protein", amount: 4, unit: "oz", assumeWhenAbsent: false },
      { slot: "bread", amount: 3, unit: "serving", default: "corn_tortilla", assumeWhenAbsent: true },
      { slot: "beans", amount: 0.5, unit: "cup", assumeWhenAbsent: false },
      { slot: "vegetable", amount: 0.5, unit: "cup", assumeWhenAbsent: false },
      { slot: "cheese", amount: 0.75, unit: "oz", assumeWhenAbsent: false },
      { slot: "sauce", amount: 2, unit: "tbsp", assumeWhenAbsent: false }
    ]
  },

  pasta: {
    slots: [
      // 2.5 cups: a full-service pasta entree is larger than the 2-cup home
      // portion — JOEY's plated pastas run 600-670 g. The parmigiana template
      // keeps its own 2-cup portion (the cutlet and cheese carry its calories).
      { slot: "carb", amount: 2.5, unit: "cup", default: "pasta", assumeWhenAbsent: true },
      { slot: "protein", amount: 4, unit: "oz", assumeWhenAbsent: false },
      { slot: "sauce", amount: 0.5, unit: "cup", default: "marinara", assumeWhenAbsent: true },
      { slot: "cheese", amount: 1, unit: "oz", assumeWhenAbsent: false }
    ]
  },

  // Chicken/veal parmigiana: a breaded, pan-fried cutlet over a full pasta
  // portion, blanketed in melted mozzarella with tomato sauce. Its calories are
  // carb + fat heavy (breading, pasta, frying oil, cheese) against only moderate
  // protein, so the cutlet uses the breaded entry, the cheese is kept modest to
  // avoid over-claiming protein, and the frying oil is costed explicitly.
  parmigiana: {
    slots: [
      { slot: "protein", amount: 6, unit: "oz", default: "fried_chicken", assumeWhenAbsent: true },
      { slot: "carb", amount: 2, unit: "cup", default: "pasta", assumeWhenAbsent: true },
      { slot: "cheese", amount: 1.5, unit: "oz", default: "mozzarella", assumeWhenAbsent: true },
      { slot: "sauce", amount: 0.5, unit: "cup", default: "marinara", assumeWhenAbsent: true },
      { slot: "fat", amount: 2, unit: "tbsp", default: "olive_oil", assumeWhenAbsent: true }
    ]
  },

  pizza: {
    slots: [
      { slot: "bread", amount: 2, unit: "serving", default: "pizza_slice", assumeWhenAbsent: true },
      { slot: "protein", amount: 2, unit: "oz", assumeWhenAbsent: false },
      { slot: "vegetable", amount: 0.5, unit: "cup", assumeWhenAbsent: false }
    ]
  },

  // A sushi order (roll, nigiri, hand roll/cone) is rice-forward with only a
  // couple ounces of fish and a little mayo/avocado — nothing like a plated
  // fillet. Costing it as a plate (6 oz protein + a full grain base) tripled a
  // $8 cone and read 5x its protein. Rice is structural; the fish is always
  // named, so protein is costed only when detected, never invented for a
  // vegetable roll.
  sushi: {
    slots: [
      { slot: "carb", amount: 1, unit: "cup", default: "white_rice", assumeWhenAbsent: true },
      { slot: "protein", amount: 2, unit: "oz", assumeWhenAbsent: false },
      { slot: "sauce", amount: 1, unit: "tbsp", assumeWhenAbsent: false },
      { slot: "fat", amount: 1, unit: "serving", assumeWhenAbsent: false }
    ]
  },

  soup: {
    slots: [
      { slot: "carb", amount: 1.5, unit: "cup", default: "soup_base", assumeWhenAbsent: true },
      { slot: "protein", amount: 3, unit: "oz", assumeWhenAbsent: false },
      { slot: "beans", amount: 0.5, unit: "cup", assumeWhenAbsent: false },
      { slot: "vegetable", amount: 0.5, unit: "cup", assumeWhenAbsent: false }
    ]
  },

  plate: {
    slots: [
      { slot: "protein", amount: 6, unit: "oz", assumeWhenAbsent: false },
      { slot: "carb", amount: 1, unit: "cup", default: "white_rice", assumeWhenAbsent: true },
      { slot: "vegetable", amount: 1, unit: "cup", default: "vegetables", assumeWhenAbsent: true },
      { slot: "sauce", amount: 1, unit: "tbsp", assumeWhenAbsent: false },
      { slot: "fat", amount: 1, unit: "serving", assumeWhenAbsent: false }
    ]
  }
});

// An unrecognized dish still gets estimated, using the most generic template we
// have. The item records that it fell back here, and its macro confidence is
// docked for the unknown dish type.
export const FALLBACK_DISH_TYPE = "plate";

/**
 * Slots we still cost when the dish template has no place for them.
 *
 * A cheese or a sauce named in a description is part of the dish; a carb or a
 * vegetable named outside its slot is usually a side ("served with fries") or a
 * garnish. Costing an unslotted side would quietly add 365 calories to a burger
 * that never claimed to include one.
 */
export const COSTED_WHEN_UNSLOTTED = Object.freeze(["cheese", "sauce", "fat"]);

/** @returns {{slots: PortionSlot[]}} */
export function templateFor(dishType) {
  return PORTION_TEMPLATES[dishType] ?? PORTION_TEMPLATES[FALLBACK_DISH_TYPE];
}
