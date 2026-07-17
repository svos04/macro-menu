// data/nutritionTable.js
// Local nutrition assumptions — the only "database" V1 has.
//
// Every value is an approximation of a common restaurant serving, rounded to
// the precision the numbers actually deserve. They are drawn from USDA
// FoodData Central averages for the cooked form of each food, adjusted upward
// where restaurant portions reliably exceed home portions (oils, sauces, buns).
//
// THE GOAL IS USEFUL RELATIVE RANKING, NOT PERFECT NUTRITION.
// A grilled chicken bowl must land above a fried chicken sandwich on
// protein-per-calorie. Whether it lands at 690 cal or 710 cal does not matter.
//
// Each entry declares the serving its macros describe. macroEstimator scales
// linearly from that serving to whatever the dish template asks for, which is
// only valid because every serving here is within the range a real portion
// would fall in. Do not add an entry whose serving is a "per 100g" abstraction.
//
// `condiment: true` means the food is used in garnish quantities (pickles,
// pico, tomato slices). Condiments are always costed at exactly one serving and
// are never scaled up to fill a portion slot — a bowl does not contain a full
// cup of pico de gallo just because its template allocates a cup of vegetables.
//
// `source` is "common_assumption" everywhere. When real USDA / Open Food Facts
// lookups land, they replace entries one at a time and change this field, so
// the UI can show which numbers are looked up and which are still assumed.

const COMMON = "common_assumption";

/**
 * @typedef {object} NutritionEntry
 * @property {string} label            Human-readable, used in assumption strings.
 * @property {{amount: number, unit: "oz"|"cup"|"tbsp"|"serving"}} serving
 * @property {number} calories
 * @property {number} protein_g
 * @property {number} carbs_g
 * @property {number} fat_g
 * @property {boolean} [condiment]
 * @property {string} source
 */

/** @type {Record<string, NutritionEntry>} */
export const NUTRITION_TABLE = Object.freeze({
  // --- Proteins. All per 5 oz cooked, so templates can scale by ounces. ------
  // Protein is ~6.4 g/oz, not the ~8.8 of a USDA lab breast. Restaurant menu
  // figures (Mendocino "add chicken" 3.5 oz = 20 g; a marinated, sauced,
  // partly-thigh portion weighed with its glaze) land here, and under-claiming
  // protein is the safe direction for a dieter.
  chicken_breast: {
    label: "cooked chicken breast",
    serving: { amount: 5, unit: "oz" },
    calories: 220,
    protein_g: 32,
    carbs_g: 1,
    fat_g: 8,
    source: COMMON
  },
  // Breaded + deep fried. The breading is already priced in here, which is why
  // preparationAdjustments suppresses its "fried" delta when this entry is used.
  // Breaded + deep fried, so less meat per ounce than a grilled breast and more
  // of the weight is crust and oil: protein stays below chicken_breast's 6.4
  // g/oz, calories stay high.
  fried_chicken: {
    label: "fried chicken",
    serving: { amount: 5, unit: "oz" },
    calories: 375,
    protein_g: 24,
    carbs_g: 16,
    fat_g: 24,
    source: COMMON
  },
  // Protein is ~6 g/oz, not the ~8.4 of a USDA-lab cut — the same restaurant-vs-
  // lab gap already corrected for chicken. JOEY's plain-steak anchors are
  // consistent: 7 oz sirloin = 40 g, 11 oz = 63 g, 14 oz NY = 82 g, all ~5.8 g/oz
  // cooked. Calories stay generous (a mid cut between lean sirloin and fatty
  // ribeye) and the freed calories move into fat, so protein lands conservative
  // and calories stay high — the safe direction for a dieter.
  steak: {
    label: "cooked steak",
    serving: { amount: 5, unit: "oz" },
    calories: 300,
    protein_g: 30,
    carbs_g: 0,
    fat_g: 20,
    source: COMMON
  },
  beef: {
    label: "cooked beef",
    serving: { amount: 5, unit: "oz" },
    calories: 290,
    protein_g: 38,
    carbs_g: 0,
    fat_g: 15,
    source: COMMON
  },
  // 80/20 ground beef, cooked. A 6 oz template portion lands near 425 cal.
  burger_patty: {
    label: "beef burger patty",
    serving: { amount: 5, unit: "oz" },
    calories: 355,
    protein_g: 31,
    carbs_g: 0,
    fat_g: 25,
    source: COMMON
  },
  turkey: {
    label: "roasted turkey",
    serving: { amount: 5, unit: "oz" },
    calories: 210,
    protein_g: 40,
    carbs_g: 0,
    fat_g: 5,
    source: COMMON
  },
  salmon: {
    label: "cooked salmon",
    serving: { amount: 5, unit: "oz" },
    calories: 290,
    protein_g: 35,
    carbs_g: 0,
    fat_g: 16,
    source: COMMON
  },
  // Seared/raw restaurant tuna (poke, tataki, ahi salad) is ~6.8 g protein/oz as
  // served, not the ~8 of a lab fillet — the same restaurant-vs-lab gap as
  // chicken and steak. A 5 oz slot at 40 g over-credited JOEY's poke bowl and
  // yellowfin salad by ~30%; 34 g lands both within a gram or two.
  tuna: {
    label: "tuna",
    serving: { amount: 5, unit: "oz" },
    calories: 165,
    protein_g: 34,
    carbs_g: 0,
    fat_g: 2,
    source: COMMON
  },
  shrimp: {
    label: "cooked shrimp",
    serving: { amount: 5, unit: "oz" },
    calories: 145,
    protein_g: 34,
    carbs_g: 1,
    fat_g: 2,
    source: COMMON
  },
  pork: {
    label: "cooked pork",
    serving: { amount: 5, unit: "oz" },
    calories: 300,
    protein_g: 38,
    carbs_g: 0,
    fat_g: 16,
    source: COMMON
  },
  // Lean shellfish (lobster, scallops, crab). Grouped like white_fish covers the
  // lean fish — one entry is enough for ranking. Close to shrimp: high protein,
  // very little fat. Without it, a lobster or scallop dish detected no protein at
  // all and scored as an empty, low-calorie plate.
  shellfish: {
    label: "cooked shellfish",
    serving: { amount: 5, unit: "oz" },
    calories: 150,
    protein_g: 32,
    carbs_g: 1,
    fat_g: 2,
    source: COMMON
  },
  // Sea bass, branzino, snapper — the meatier, richer fish that a lean "white
  // fish" understates. Kept modest so a sake-glazed or steamed preparation
  // (JOEY's Chilean sea bass reads 38 g protein across the plated dish) is not
  // over-credited.
  sea_bass: {
    label: "cooked sea bass",
    serving: { amount: 5, unit: "oz" },
    calories: 220,
    protein_g: 34,
    carbs_g: 0,
    fat_g: 9,
    source: COMMON
  },
  tofu: {
    label: "firm tofu",
    serving: { amount: 5, unit: "oz" },
    calories: 180,
    protein_g: 20,
    carbs_g: 4,
    fat_g: 10,
    source: COMMON
  },
  // Cod, catfish, tilapia, trout, halibut. Lean enough that one entry covers
  // them for ranking purposes.
  white_fish: {
    label: "cooked white fish",
    serving: { amount: 5, unit: "oz" },
    calories: 180,
    protein_g: 34,
    carbs_g: 0,
    fat_g: 4,
    source: COMMON
  },
  lamb: {
    label: "cooked lamb",
    serving: { amount: 5, unit: "oz" },
    calories: 340,
    protein_g: 38,
    carbs_g: 0,
    fat_g: 20,
    source: COMMON
  },
  sausage: {
    label: "sausage",
    serving: { amount: 5, unit: "oz" },
    calories: 400,
    protein_g: 24,
    carbs_g: 2,
    fat_g: 33,
    source: COMMON
  },
  egg: {
    label: "eggs",
    serving: { amount: 1, unit: "serving" }, // one serving = 2 large eggs
    calories: 145,
    protein_g: 13,
    carbs_g: 1,
    fat_g: 10,
    source: COMMON
  },
  // A fixed add-on, so `condiment` — which is load-bearing, not cosmetic. Bacon
  // sits in the "sauce" slot (it must never be read as the dish's protein), and
  // as a bulk item it SPLIT that slot with the real sauce: a club sandwich's
  // spicy mayo was halved to 0.5 tbsp because bacon was standing in the sauce's
  // portion. As a condiment it is costed at exactly one serving and leaves the
  // sauce portion whole.
  bacon: {
    label: "bacon",
    serving: { amount: 1, unit: "serving" }, // one serving = 2 slices
    calories: 90,
    protein_g: 6,
    carbs_g: 0,
    fat_g: 7,
    condiment: true,
    source: COMMON
  },

  // --- Carbs ---------------------------------------------------------------
  white_rice: {
    label: "cooked white rice",
    serving: { amount: 1, unit: "cup" },
    calories: 205,
    protein_g: 4,
    carbs_g: 45,
    fat_g: 0.4,
    source: COMMON
  },
  brown_rice: {
    label: "cooked brown rice",
    serving: { amount: 1, unit: "cup" },
    calories: 218,
    protein_g: 5,
    carbs_g: 46,
    fat_g: 1.6,
    source: COMMON
  },
  quinoa: {
    label: "cooked quinoa",
    serving: { amount: 1, unit: "cup" },
    calories: 222,
    protein_g: 8,
    carbs_g: 39,
    fat_g: 3.6,
    source: COMMON
  },
  farro: {
    label: "cooked farro",
    serving: { amount: 1, unit: "cup" },
    calories: 200,
    protein_g: 7,
    carbs_g: 40,
    fat_g: 1.5,
    source: COMMON
  },
  // Restaurant pasta entrees are ~2 cups cooked, which is why the serving is
  // stated that way rather than per cup.
  pasta: {
    label: "cooked pasta",
    serving: { amount: 2, unit: "cup" },
    calories: 440,
    protein_g: 16,
    carbs_g: 86,
    fat_g: 2.6,
    source: COMMON
  },
  black_beans: {
    label: "black beans",
    serving: { amount: 0.5, unit: "cup" },
    calories: 114,
    protein_g: 8,
    carbs_g: 20,
    fat_g: 0.5,
    source: COMMON
  },
  lentils: {
    label: "cooked lentils",
    serving: { amount: 0.5, unit: "cup" },
    calories: 115,
    protein_g: 9,
    carbs_g: 20,
    fat_g: 0.4,
    source: COMMON
  },
  chickpeas: {
    label: "chickpeas",
    serving: { amount: 0.5, unit: "cup" },
    calories: 135,
    protein_g: 7,
    carbs_g: 22,
    fat_g: 2,
    source: COMMON
  },
  potato: {
    label: "potato",
    serving: { amount: 1, unit: "cup" },
    calories: 130,
    protein_g: 3,
    carbs_g: 30,
    fat_g: 0.2,
    source: COMMON
  },
  fries: {
    label: "french fries",
    serving: { amount: 1, unit: "serving" },
    calories: 365,
    protein_g: 4,
    carbs_g: 48,
    fat_g: 17,
    source: COMMON
  },
  // Crunchy salad toppings. Fried, so calorie-dense for their volume — the whole
  // point of listing them is that a salad's crunch is not free. Served at ~0.5
  // cup so the salad "carb" slot costs one topping's worth, never a pasta bowl.
  crispy_noodles: {
    label: "crispy noodles",
    serving: { amount: 0.5, unit: "cup" },
    calories: 150,
    protein_g: 2,
    carbs_g: 18,
    fat_g: 7,
    source: COMMON
  },
  croutons: {
    label: "croutons",
    serving: { amount: 0.5, unit: "cup" },
    calories: 90,
    protein_g: 2,
    carbs_g: 14,
    fat_g: 3,
    source: COMMON
  },
  tortilla_strips: {
    label: "tortilla strips",
    serving: { amount: 0.5, unit: "cup" },
    calories: 120,
    protein_g: 2,
    carbs_g: 14,
    fat_g: 6,
    source: COMMON
  },
  burger_bun: {
    label: "burger bun",
    serving: { amount: 1, unit: "serving" },
    calories: 160,
    protein_g: 5,
    carbs_g: 28,
    fat_g: 3,
    source: COMMON
  },
  sandwich_bread: {
    label: "sandwich bread",
    serving: { amount: 1, unit: "serving" }, // one serving = 2 standard slices
    // Restaurant bread runs heavier than the 2-slice grocery loaf. Spec §10/§12
    // put two standard slices at 160–230 cal.
    // The FAT, not the carb, was the understatement: a restaurant serves brioche,
    // ciabatta or focaccia — enriched with butter/egg/oil and often griddled —
    // not lean sandwich slices. 3 g of fat is a grocery-loaf number. The carb
    // figure is left alone: it reproduced JOEY's chicken sandwich exactly (34 g).
    calories: 205,
    protein_g: 7,
    carbs_g: 32,
    fat_g: 6,
    source: COMMON
  },
  // A restaurant wrap tortilla is a 10–12" flour round, not the 8" grocery kind.
  // Spec §13 puts the standard wrap tortilla near 250 cal and explicitly warns
  // against assuming spinach/wheat/gluten-free wraps are lighter. 220 keeps a
  // wrap honest without overstating a smaller deli tortilla.
  tortilla: {
    label: "flour tortilla",
    serving: { amount: 1, unit: "serving" },
    calories: 220,
    protein_g: 6,
    carbs_g: 36,
    fat_g: 6,
    source: COMMON
  },
  // Oversized burrito tortilla (spec §13: 300–420 cal). Kept distinct from the
  // wrap tortilla so a burrito is not silently costed as a thin deli wrap.
  burrito_tortilla: {
    label: "large burrito tortilla",
    serving: { amount: 1, unit: "serving" },
    calories: 310,
    protein_g: 8,
    carbs_g: 52,
    fat_g: 8,
    source: COMMON
  },
  corn_tortilla: {
    label: "corn tortilla",
    serving: { amount: 1, unit: "serving" },
    calories: 60,
    protein_g: 1.5,
    carbs_g: 12,
    fat_g: 1,
    source: COMMON
  },
  pita: {
    label: "pita bread",
    serving: { amount: 1, unit: "serving" },
    calories: 165,
    protein_g: 6,
    carbs_g: 33,
    fat_g: 1,
    source: COMMON
  },
  // Cheese pizza, one slice of a 14" pie. Toppings are added separately.
  pizza_slice: {
    label: "cheese pizza slice",
    serving: { amount: 1, unit: "serving" },
    calories: 285,
    protein_g: 12,
    carbs_g: 36,
    fat_g: 10,
    source: COMMON
  },
  soup_base: {
    label: "soup broth and vegetables",
    serving: { amount: 1, unit: "cup" },
    calories: 70,
    protein_g: 3,
    carbs_g: 9,
    fat_g: 2,
    source: COMMON
  },

  // --- Fats ----------------------------------------------------------------
  avocado: {
    label: "avocado",
    serving: { amount: 1, unit: "serving" }, // one serving = ~50 g, half an avocado
    calories: 80,
    protein_g: 1,
    carbs_g: 4,
    fat_g: 7.3,
    source: COMMON
  },
  // ~1 oz of nuts, the amount a salad or bowl is actually topped with. Costed as
  // a condiment (exactly one serving) so it never scales to fill the fat slot,
  // and so "honey roasted almonds" stops being mistaken for a spoonful of honey.
  almonds: {
    label: "nuts",
    serving: { amount: 1, unit: "serving" },
    calories: 170,
    protein_g: 6,
    carbs_g: 6,
    fat_g: 15,
    condiment: true,
    source: COMMON
  },
  // A scatter of olives (kalamata, castelvetrano) on a Mediterranean bowl or
  // salad. Small but nearly all fat — dropping them left those dishes reading far
  // too lean. Costed as a condiment: one serving, never scaled to a portion.
  olives: {
    label: "olives",
    serving: { amount: 1, unit: "serving" }, // ~1 oz, 6-8 olives
    calories: 45,
    protein_g: 0.3,
    carbs_g: 2,
    fat_g: 4.5,
    condiment: true,
    source: COMMON
  },
  cheese: {
    label: "cheese",
    serving: { amount: 1, unit: "oz" },
    calories: 115,
    protein_g: 7,
    carbs_g: 1,
    fat_g: 9.4,
    source: COMMON
  },
  mozzarella: {
    label: "mozzarella",
    serving: { amount: 1, unit: "oz" },
    calories: 85,
    protein_g: 6,
    carbs_g: 1,
    fat_g: 6,
    source: COMMON
  },
  feta: {
    label: "feta",
    serving: { amount: 1, unit: "oz" },
    calories: 75,
    protein_g: 4,
    carbs_g: 1.2,
    fat_g: 6,
    source: COMMON
  },
  parmesan: {
    label: "parmesan",
    serving: { amount: 1, unit: "oz" },
    calories: 110,
    protein_g: 10,
    carbs_g: 1,
    fat_g: 7,
    source: COMMON
  },
  mayo: {
    label: "mayo or aioli",
    serving: { amount: 1, unit: "tbsp" },
    calories: 94,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 10,
    source: COMMON
  },
  crema: {
    label: "crema or sour cream",
    serving: { amount: 1, unit: "tbsp" },
    calories: 30,
    protein_g: 0.4,
    carbs_g: 0.6,
    fat_g: 3,
    source: COMMON
  },
  olive_oil: {
    label: "olive oil",
    serving: { amount: 1, unit: "tbsp" },
    calories: 119,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 13.5,
    source: COMMON
  },
  butter: {
    label: "butter",
    serving: { amount: 1, unit: "tbsp" },
    calories: 102,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 11.5,
    source: COMMON
  },
  pesto: {
    label: "pesto",
    serving: { amount: 1, unit: "tbsp" },
    calories: 80,
    protein_g: 1,
    carbs_g: 1,
    fat_g: 8,
    source: COMMON
  },
  hummus: {
    label: "hummus",
    serving: { amount: 2, unit: "tbsp" },
    calories: 70,
    protein_g: 2,
    carbs_g: 4,
    fat_g: 5,
    source: COMMON
  },
  tahini: {
    label: "tahini",
    serving: { amount: 1, unit: "tbsp" },
    calories: 89,
    protein_g: 2.6,
    carbs_g: 3,
    fat_g: 8,
    source: COMMON
  },

  // --- Sauces and dressings ------------------------------------------------
  ranch_dressing: {
    label: "ranch dressing",
    serving: { amount: 2, unit: "tbsp" },
    calories: 130,
    protein_g: 1,
    carbs_g: 2,
    fat_g: 13,
    source: COMMON
  },
  caesar_dressing: {
    label: "caesar dressing",
    serving: { amount: 2, unit: "tbsp" },
    calories: 160,
    protein_g: 1,
    carbs_g: 1,
    fat_g: 17,
    source: COMMON
  },
  vinaigrette: {
    label: "vinaigrette",
    serving: { amount: 2, unit: "tbsp" },
    calories: 130,
    protein_g: 0,
    carbs_g: 2,
    fat_g: 14,
    source: COMMON
  },
  // Nut/seed-butter dressings (Thai almond, peanut, sesame-ginger). Heavier and
  // sweeter than a vinaigrette — the reason a "light" Thai salad isn't light.
  almond_dressing: {
    label: "thai almond dressing",
    serving: { amount: 2, unit: "tbsp" },
    calories: 120,
    protein_g: 3,
    carbs_g: 8,
    fat_g: 9,
    source: COMMON
  },
  // Creamy herb dressing (green goddess, avocado-based). Mostly oil.
  green_goddess_dressing: {
    label: "green goddess dressing",
    serving: { amount: 2, unit: "tbsp" },
    calories: 120,
    protein_g: 1,
    carbs_g: 2,
    fat_g: 12,
    source: COMMON
  },
  alfredo_sauce: {
    label: "alfredo sauce",
    serving: { amount: 0.5, unit: "cup" },
    calories: 280,
    protein_g: 6,
    carbs_g: 7,
    fat_g: 26,
    source: COMMON
  },
  marinara: {
    label: "marinara sauce",
    serving: { amount: 0.5, unit: "cup" },
    calories: 70,
    protein_g: 2,
    carbs_g: 12,
    fat_g: 2,
    source: COMMON
  },
  bbq_sauce: {
    label: "bbq sauce",
    serving: { amount: 1, unit: "tbsp" },
    calories: 30,
    protein_g: 0,
    carbs_g: 7,
    fat_g: 0,
    source: COMMON
  },
  teriyaki_sauce: {
    label: "teriyaki sauce",
    serving: { amount: 1, unit: "tbsp" },
    calories: 30,
    protein_g: 0.6,
    carbs_g: 6,
    fat_g: 0,
    source: COMMON
  },
  honey: {
    label: "honey",
    serving: { amount: 1, unit: "tbsp" },
    calories: 64,
    protein_g: 0,
    carbs_g: 17,
    fat_g: 0,
    source: COMMON
  },
  sweet_glaze: {
    label: "sweet glaze",
    serving: { amount: 1, unit: "tbsp" },
    calories: 50,
    protein_g: 0,
    carbs_g: 12,
    fat_g: 0,
    source: COMMON
  },
  buffalo_sauce: {
    label: "buffalo sauce",
    serving: { amount: 1, unit: "tbsp" },
    calories: 15,
    protein_g: 0,
    carbs_g: 1,
    fat_g: 1.5,
    source: COMMON
  },

  // --- Vegetables ----------------------------------------------------------
  // Generic cooked/raw mixed vegetables. Used when a dish template allocates a
  // vegetable portion but the description never says which vegetables.
  vegetables: {
    label: "mixed vegetables",
    serving: { amount: 1, unit: "cup" },
    calories: 45,
    protein_g: 2,
    carbs_g: 9,
    fat_g: 0.5,
    source: COMMON
  },
  // Kept separate from `vegetables` because 3 cups of greens in a salad is
  // ~30 cal, while 3 cups of mixed veg would be ~135 — a difference big enough
  // to reorder a ranking.
  leafy_greens: {
    label: "leafy greens",
    serving: { amount: 1, unit: "cup" },
    calories: 10,
    protein_g: 1,
    carbs_g: 2,
    fat_g: 0.1,
    source: COMMON
  },
  // Fruit on a savory salad (mango, pineapple, mandarin, berries). A condiment
  // portion — real sugar, but never a whole cup. Slotted as "fruit" so it does
  // not evict the leafy-greens base from the vegetable slot.
  fruit: {
    label: "fruit",
    serving: { amount: 1, unit: "serving" }, // ~half a cup
    calories: 60,
    protein_g: 1,
    carbs_g: 15,
    fat_g: 0.2,
    condiment: true,
    source: COMMON
  },
  peppers: {
    label: "peppers",
    serving: { amount: 0.5, unit: "cup" },
    calories: 20,
    protein_g: 0.7,
    carbs_g: 4.6,
    fat_g: 0.2,
    source: COMMON
  },
  broccoli: {
    label: "broccoli",
    serving: { amount: 1, unit: "cup" },
    calories: 35,
    protein_g: 2.5,
    carbs_g: 7,
    fat_g: 0.4,
    source: COMMON
  },
  cabbage: {
    label: "cabbage",
    serving: { amount: 1, unit: "cup" },
    calories: 22,
    protein_g: 1,
    carbs_g: 5,
    fat_g: 0.1,
    source: COMMON
  },
  // Dressed, which is why it is not simply cabbage.
  slaw: {
    label: "slaw",
    serving: { amount: 0.5, unit: "cup" },
    calories: 60,
    protein_g: 1,
    carbs_g: 6,
    fat_g: 4,
    source: COMMON
  },
  corn: {
    label: "corn",
    serving: { amount: 0.5, unit: "cup" },
    calories: 65,
    protein_g: 2,
    carbs_g: 14,
    fat_g: 1,
    source: COMMON
  },
  edamame: {
    label: "edamame",
    serving: { amount: 0.5, unit: "cup" },
    calories: 95,
    protein_g: 8,
    carbs_g: 7,
    fat_g: 4,
    source: COMMON
  },
  mushrooms: {
    label: "mushrooms",
    serving: { amount: 0.5, unit: "cup" },
    calories: 10,
    protein_g: 1,
    carbs_g: 1.5,
    fat_g: 0.2,
    source: COMMON
  },

  // --- Condiment vegetables. Always exactly one serving. --------------------
  pico_de_gallo: {
    label: "pico de gallo",
    serving: { amount: 0.25, unit: "cup" },
    calories: 15,
    protein_g: 0.5,
    carbs_g: 3,
    fat_g: 0.1,
    condiment: true,
    source: COMMON
  },
  salsa: {
    label: "salsa",
    serving: { amount: 0.25, unit: "cup" },
    calories: 20,
    protein_g: 1,
    carbs_g: 4,
    fat_g: 0.1,
    condiment: true,
    source: COMMON
  },
  tomato: {
    label: "tomato",
    serving: { amount: 1, unit: "serving" },
    calories: 10,
    protein_g: 0.5,
    carbs_g: 2,
    fat_g: 0.1,
    condiment: true,
    source: COMMON
  },
  onion: {
    label: "onion",
    serving: { amount: 1, unit: "serving" },
    calories: 15,
    protein_g: 0.4,
    carbs_g: 3.5,
    fat_g: 0,
    condiment: true,
    source: COMMON
  },
  cucumber: {
    label: "cucumber",
    serving: { amount: 1, unit: "serving" },
    calories: 8,
    protein_g: 0.3,
    carbs_g: 2,
    fat_g: 0,
    condiment: true,
    source: COMMON
  },
  pickles: {
    label: "pickles",
    serving: { amount: 1, unit: "serving" },
    calories: 5,
    protein_g: 0,
    carbs_g: 1,
    fat_g: 0,
    condiment: true,
    source: COMMON
  },
  radish: {
    label: "radish",
    serving: { amount: 1, unit: "serving" },
    calories: 5,
    protein_g: 0,
    carbs_g: 1,
    fat_g: 0,
    condiment: true,
    source: COMMON
  }
});

/** @returns {NutritionEntry|null} */
export function lookupNutritionEntry(key) {
  return NUTRITION_TABLE[key] ?? null;
}

/**
 * Scale an entry from its stated serving to `amount` of `unit`.
 *
 * Returns null when the units disagree (e.g. a template asks for 1.5 tbsp of
 * something measured in ounces). Callers fall back to one standard serving and
 * record an assumption rather than inventing a conversion factor.
 */
export function scaleEntry(entry, amount, unit) {
  if (!entry) return null;
  if (entry.condiment) return macrosOf(entry, 1);
  if (entry.serving.unit !== unit) return null;
  return macrosOf(entry, amount / entry.serving.amount);
}

/** Multiply an entry's macros by `factor`. */
export function macrosOf(entry, factor) {
  return {
    calories: entry.calories * factor,
    protein_g: entry.protein_g * factor,
    carbs_g: entry.carbs_g * factor,
    fat_g: entry.fat_g * factor
  };
}
