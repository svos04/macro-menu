// data/ingredientDictionary.js
// Maps the words restaurants actually write on menus onto entries in
// nutritionTable.js.
//
// Two fields do different jobs and must not be merged:
//
//   category — what the food IS, nutritionally. Reported to the user.
//              Follows the product spec: mayo/aioli/crema/pesto are "fat".
//   slot     — where the food SITS in a dish. Drives portioning.
//              Mayo occupies the "sauce" slot; black beans occupy "beans"
//              even though their category is "carb".
//
// Matching is longest-alias-first with span consumption, so "crispy chicken"
// wins over "chicken" and never yields both. Add long aliases freely; the
// matcher handles precedence for you.

/**
 * @typedef {object} IngredientDefinition
 * @property {string} normalizedName
 * @property {import("../types/menu.js").IngredientCategory} category
 * @property {string} slot
 * @property {string} nutritionKey  Key into NUTRITION_TABLE.
 * @property {string[]} aliases     Lowercase. Matched on word boundaries.
 */

/** @type {IngredientDefinition[]} */
export const INGREDIENT_DEFINITIONS = [
  // --- Proteins ------------------------------------------------------------
  {
    normalizedName: "chicken breast",
    category: "protein",
    slot: "protein",
    nutritionKey: "chicken_breast",
    aliases: [
      "grilled chicken breast",
      "grilled chicken",
      "roasted chicken",
      "chicken breast",
      "blackened chicken",
      "chicken"
    ]
  },
  {
    // Synonym rule from the spec: crispy chicken -> fried chicken.
    normalizedName: "fried chicken",
    category: "protein",
    slot: "protein",
    nutritionKey: "fried_chicken",
    // Parmesan/parmigiana/milanese are breaded, pan-fried cutlets. Spelled out
    // so the dish name routes to the breaded entry (not a grilled breast) AND so
    // "parmesan" in "chicken parmesan" is consumed here, not re-matched as a
    // scoop of parmesan cheese.
    aliases: [
      "chicken parmigiana",
      "chicken parmesan",
      "veal parmigiana",
      "veal parmesan",
      "chicken milanese",
      "crispy chicken breast",
      "buttermilk chicken",
      "breaded chicken",
      "chicken katsu",
      "chicken tenders",
      "crispy chicken",
      "fried chicken",
      "chicken parm"
    ]
  },
  {
    normalizedName: "steak",
    category: "protein",
    slot: "protein",
    nutritionKey: "steak",
    // Named cuts, longest-first so "new york strip" wins over "strip". A menu's
    // steak section names the cut, not the word "steak"; without these a "Prime
    // New York Strip" detected no protein at all and scored as an empty plate.
    aliases: [
      "prime top sirloin",
      "new york strip",
      "new york steak",
      "top sirloin",
      "filet mignon",
      "seared steak",
      "grilled steak",
      "porterhouse",
      "carne asada",
      "ny strip",
      "tenderloin",
      "tomahawk",
      "t-bone",
      "ribeye",
      "rib eye",
      "sirloin",
      "prime rib",
      "strip loin",
      "steak"
    ]
  },
  {
    normalizedName: "beef",
    category: "protein",
    slot: "protein",
    nutritionKey: "beef",
    // "pot roast", "meat loaf" and "meatball" are the names real menus use for
    // what is nutritionally just beef.
    aliases: [
      "ground beef",
      "braised beef",
      "barbacoa",
      "brisket",
      "pot roast",
      "meatloaf",
      "meat loaf",
      "meatballs",
      "meatball",
      "beef"
    ]
  },
  {
    normalizedName: "white fish",
    category: "protein",
    slot: "protein",
    nutritionKey: "white_fish",
    aliases: ["catfish", "tilapia", "halibut", "mahi mahi", "trout", "cod", "whitefish"]
  },
  {
    normalizedName: "lamb",
    category: "protein",
    slot: "protein",
    nutritionKey: "lamb",
    aliases: ["lamb"]
  },
  {
    normalizedName: "sausage",
    category: "protein",
    slot: "protein",
    nutritionKey: "sausage",
    aliases: ["italian sausage", "sausage"]
  },
  {
    // Synonym rule from the spec: patty -> burger patty.
    normalizedName: "burger patty",
    category: "protein",
    slot: "protein",
    nutritionKey: "burger_patty",
    // "grass-fed beef" / "angus beef" on a burger is a ground patty, not a lean
    // steak cut — spelled out so it out-ranks the bare "beef" alias and is costed
    // as the fattier, lower-protein patty it actually is.
    aliases: [
      "grass-fed beef",
      "grass fed beef",
      "beef burger",
      "angus beef",
      "beef patty",
      "burger patty",
      "smash patty",
      "patty"
    ]
  },
  {
    normalizedName: "turkey",
    category: "protein",
    slot: "protein",
    nutritionKey: "turkey",
    aliases: ["roasted turkey", "sliced turkey", "turkey"]
  },
  {
    normalizedName: "salmon",
    category: "protein",
    slot: "protein",
    nutritionKey: "salmon",
    aliases: ["roasted salmon", "grilled salmon", "salmon"]
  },
  {
    normalizedName: "tuna",
    category: "protein",
    slot: "protein",
    nutritionKey: "tuna",
    aliases: ["seared tuna", "ahi tuna", "tuna"]
  },
  {
    normalizedName: "shrimp",
    category: "protein",
    slot: "protein",
    nutritionKey: "shrimp",
    aliases: ["grilled shrimp", "shrimp", "prawns"]
  },
  {
    normalizedName: "pork",
    category: "protein",
    slot: "protein",
    nutritionKey: "pork",
    aliases: ["pulled pork", "carnitas", "pork belly", "pork"]
  },
  {
    // Lean shellfish. "lobster tail" and "lump crab" are spelled out so the long
    // alias wins; "lobster-lemon butter sauce" still resolves the bare "lobster"
    // here, but detection dedupes it against the named lobster.
    normalizedName: "shellfish",
    category: "protein",
    slot: "protein",
    nutritionKey: "shellfish",
    aliases: [
      "atlantic lobster",
      "poached lobster",
      "lobster tail",
      "lump crab meat",
      "lump crab",
      "sea scallops",
      "scallops",
      "scallop",
      "lobster",
      "crab meat",
      "crab"
    ]
  },
  {
    // Meatier, richer fish kept separate from lean white_fish. "chilean sea bass"
    // spelled out so the full name is consumed as one span.
    normalizedName: "sea bass",
    category: "protein",
    slot: "protein",
    nutritionKey: "sea_bass",
    aliases: ["chilean sea bass", "sea bass", "seabass", "branzino", "snapper"]
  },
  {
    normalizedName: "bacon",
    category: "protein",
    slot: "sauce", // small add-on; never the identity of the dish
    nutritionKey: "bacon",
    aliases: ["bacon"]
  },
  {
    normalizedName: "tofu",
    category: "protein",
    slot: "protein",
    nutritionKey: "tofu",
    aliases: ["marinated tofu", "crispy tofu", "tofu"]
  },
  {
    normalizedName: "egg",
    category: "protein",
    slot: "protein",
    nutritionKey: "egg",
    aliases: ["fried egg", "poached egg", "eggs", "egg"]
  },

  // --- Carbs ---------------------------------------------------------------
  {
    normalizedName: "brown rice",
    category: "carb",
    slot: "carb",
    nutritionKey: "brown_rice",
    aliases: ["brown rice"]
  },
  {
    normalizedName: "white rice",
    category: "carb",
    slot: "carb",
    // Bare "rice" resolves to white rice: the more common restaurant default,
    // and the less flattering assumption of the two.
    nutritionKey: "white_rice",
    aliases: ["white rice", "jasmine rice", "cilantro lime rice", "rice"]
  },
  {
    normalizedName: "quinoa",
    category: "carb",
    slot: "carb",
    nutritionKey: "quinoa",
    aliases: ["quinoa"]
  },
  {
    normalizedName: "farro",
    category: "carb",
    slot: "carb",
    nutritionKey: "farro",
    aliases: ["farro"]
  },
  {
    normalizedName: "pasta",
    category: "carb",
    slot: "carb",
    nutritionKey: "pasta",
    aliases: [
      "fettuccine",
      "spaghetti",
      "linguine",
      "rigatoni",
      "penne",
      "noodles",
      "pasta"
    ]
  },
  {
    normalizedName: "black beans",
    category: "carb",
    slot: "beans",
    nutritionKey: "black_beans",
    aliases: ["black beans", "pinto beans", "refried beans", "beans"]
  },
  {
    normalizedName: "lentils",
    category: "carb",
    slot: "beans",
    nutritionKey: "lentils",
    aliases: ["lentils"]
  },
  {
    normalizedName: "chickpeas",
    category: "carb",
    slot: "beans",
    nutritionKey: "chickpeas",
    aliases: ["chickpeas", "garbanzo beans"]
  },
  {
    normalizedName: "potato",
    category: "carb",
    slot: "carb",
    nutritionKey: "potato",
    aliases: ["roasted potatoes", "mashed potatoes", "potatoes", "potato"]
  },
  {
    normalizedName: "fries",
    category: "carb",
    slot: "carb",
    nutritionKey: "fries",
    aliases: ["french fries", "fries"]
  },
  {
    // Crunchy salad toppings. "ramen noodles" must out-rank the pasta alias
    // "noodles", so it is spelled out here (longest-alias-first handles it).
    normalizedName: "crispy noodles",
    category: "carb",
    slot: "carb",
    nutritionKey: "crispy_noodles",
    aliases: [
      "crispy wonton strips",
      "crispy rice noodles",
      "chow mein noodles",
      "crispy wontons",
      "crispy noodles",
      "wonton strips",
      "ramen noodles",
      "fried noodles",
      "crispy rice",
      "ramen"
    ]
  },
  {
    normalizedName: "croutons",
    category: "carb",
    slot: "carb",
    nutritionKey: "croutons",
    aliases: ["croutons", "crouton"]
  },
  {
    normalizedName: "tortilla strips",
    category: "carb",
    slot: "carb",
    nutritionKey: "tortilla_strips",
    aliases: ["crispy tortilla strips", "tortilla strips", "tortilla chips"]
  },
  {
    normalizedName: "bun",
    category: "carb",
    slot: "bread",
    nutritionKey: "burger_bun",
    aliases: ["brioche bun", "potato bun", "sesame bun", "bun"]
  },
  {
    normalizedName: "bread",
    category: "carb",
    slot: "bread",
    nutritionKey: "sandwich_bread",
    aliases: ["sourdough", "ciabatta", "focaccia", "toast", "bread"]
  },
  {
    normalizedName: "tortilla",
    category: "carb",
    slot: "bread",
    nutritionKey: "tortilla",
    aliases: ["flour tortilla", "tortilla"]
  },
  {
    normalizedName: "corn tortilla",
    category: "carb",
    slot: "bread",
    nutritionKey: "corn_tortilla",
    aliases: ["corn tortilla", "corn tortillas"]
  },
  {
    normalizedName: "pita",
    category: "carb",
    slot: "bread",
    nutritionKey: "pita",
    aliases: ["pita"]
  },

  // --- Fats ----------------------------------------------------------------
  {
    normalizedName: "avocado",
    category: "fat",
    slot: "fat",
    nutritionKey: "avocado",
    aliases: ["avocado", "guacamole"]
  },
  {
    // "honey roasted almonds" and "candied walnuts" are listed in full so the
    // long alias wins over "honey" and over any bare nut word — otherwise the
    // matcher costs a spoonful of honey and drops the nuts entirely.
    normalizedName: "nuts",
    category: "fat",
    slot: "fat",
    nutritionKey: "almonds",
    aliases: [
      "honey roasted almonds",
      "candied walnuts",
      "candied pecans",
      "spiced almonds",
      "sliced almonds",
      "toasted almonds",
      "marcona almonds",
      "mixed nuts",
      "sunflower seeds",
      "pumpkin seeds",
      "sesame seeds",
      "almonds",
      "almond",
      "cashews",
      "peanuts",
      "walnuts",
      "pecans",
      "pistachios",
      "pepitas",
      "seeds",
      "nuts"
    ]
  },
  {
    // "cheeseburger" is listed here on purpose. \bcheese\b cannot match inside
    // it, so without this alias every cheeseburger would silently lose its
    // cheese. The rawText in the output makes the reasoning visible.
    normalizedName: "cheese",
    category: "fat",
    slot: "cheese",
    nutritionKey: "cheese",
    aliases: ["cheddar cheese", "cheddar", "swiss", "pepper jack", "cheeseburger", "cheese"]
  },
  {
    normalizedName: "mozzarella",
    category: "fat",
    slot: "cheese",
    nutritionKey: "mozzarella",
    // "mozzarella cheese" spelled out so the trailing "cheese" is consumed here
    // and not double-counted as a second, generic cheese serving.
    aliases: ["fresh mozzarella", "mozzarella cheese", "mozzarella"]
  },
  {
    normalizedName: "feta",
    category: "fat",
    slot: "cheese",
    nutritionKey: "feta",
    aliases: ["feta"]
  },
  {
    normalizedName: "parmesan",
    category: "fat",
    slot: "cheese",
    nutritionKey: "parmesan",
    aliases: ["parmesan cheese", "parmigiano", "parmesan"]
  },
  {
    // Synonym rule from the spec: aioli -> mayo.
    normalizedName: "mayo",
    category: "fat",
    slot: "sauce",
    nutritionKey: "mayo",
    aliases: ["spicy aioli", "garlic aioli", "chipotle mayo", "aioli", "mayonnaise", "mayo"]
  },
  {
    // Synonym rule from the spec: chipotle crema -> crema.
    normalizedName: "crema",
    category: "fat",
    slot: "sauce",
    nutritionKey: "crema",
    aliases: ["chipotle crema", "lime crema", "sour cream", "crema"]
  },
  {
    normalizedName: "olive oil",
    category: "fat",
    slot: "fat",
    nutritionKey: "olive_oil",
    // "olive oil" before "olives" so the oil wins its own span.
    aliases: ["olive oil"]
  },
  {
    normalizedName: "olives",
    category: "fat",
    slot: "fat",
    nutritionKey: "olives",
    aliases: ["kalamata olives", "castelvetrano olives", "olives", "olive"]
  },
  {
    normalizedName: "butter",
    category: "fat",
    slot: "fat",
    nutritionKey: "butter",
    // "beurre blanc" is a butter-and-wine reduction — an invisible-but-heavy fat
    // on menus (JOEY's herb salmon and lobster spaghetti both lean on it).
    aliases: ["truffle butter", "garlic butter", "beurre blanc", "butter"]
  },
  {
    normalizedName: "pesto",
    category: "fat",
    slot: "sauce",
    nutritionKey: "pesto",
    aliases: ["pesto"]
  },
  {
    normalizedName: "hummus",
    category: "fat",
    slot: "sauce",
    nutritionKey: "hummus",
    aliases: ["hummus"]
  },
  {
    normalizedName: "tahini",
    category: "fat",
    slot: "sauce",
    nutritionKey: "tahini",
    aliases: ["tahini"]
  },

  // --- Sauces and dressings ------------------------------------------------
  {
    normalizedName: "ranch",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "ranch_dressing",
    aliases: ["ranch dressing", "ranch"]
  },
  {
    normalizedName: "caesar dressing",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "caesar_dressing",
    aliases: ["caesar dressing", "caesar"]
  },
  {
    // A nut/seed-butter dressing. Listed before the generic "dressing" catch so
    // "thai almond dressing" resolves here, not to a plain vinaigrette.
    normalizedName: "almond dressing",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "almond_dressing",
    aliases: [
      "thai almond dressing",
      "thai peanut dressing",
      "almond dressing",
      "peanut dressing",
      "sesame ginger",
      "peanut sauce"
    ]
  },
  {
    normalizedName: "green goddess",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "green_goddess_dressing",
    aliases: ["green goddess dressing", "green goddess", "goddess dressing"]
  },
  {
    // "dressing" is a generic catch so any unrecognized "<x> dressing" is still
    // costed as a dressing (a salad is never actually undressed) rather than
    // silently dropped. Longer, specific dressing aliases above win over it.
    normalizedName: "vinaigrette",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "vinaigrette",
    aliases: ["balsamic vinaigrette", "house dressing", "vinaigrette", "dressing"]
  },
  {
    normalizedName: "alfredo",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "alfredo_sauce",
    aliases: ["alfredo sauce", "alfredo"]
  },
  {
    normalizedName: "marinara",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "marinara",
    aliases: ["marinara", "tomato sauce", "pomodoro"]
  },
  {
    normalizedName: "bbq sauce",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "bbq_sauce",
    aliases: ["barbecue sauce", "bbq sauce", "bbq"]
  },
  {
    normalizedName: "teriyaki",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "teriyaki_sauce",
    aliases: ["teriyaki"]
  },
  {
    normalizedName: "honey",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "honey",
    aliases: ["hot honey", "honey"]
  },
  {
    normalizedName: "glaze",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "sweet_glaze",
    aliases: ["glaze", "glazed"]
  },
  {
    normalizedName: "buffalo sauce",
    category: "sauce",
    slot: "sauce",
    nutritionKey: "buffalo_sauce",
    aliases: ["buffalo sauce", "buffalo"]
  },

  // --- Vegetables ----------------------------------------------------------
  {
    // Synonym rule from the spec: greens -> lettuce/spinach. All leafy greens
    // share one nutrition entry; the normalized name preserves what was written.
    normalizedName: "lettuce",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "leafy_greens",
    // "butter lettuce" / "bibb" are spelled out so the long alias wins and
    // "butter" is not separately matched as a pat of fat.
    aliases: [
      "butter lettuce",
      "bibb lettuce",
      "little gem",
      "mixed greens",
      "spring mix",
      "butterhead",
      "romaine",
      "arugula",
      "greens",
      "lettuce"
    ]
  },
  {
    normalizedName: "spinach",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "leafy_greens",
    aliases: ["baby spinach", "spinach"]
  },
  {
    normalizedName: "kale",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "leafy_greens",
    aliases: ["kale"]
  },
  {
    normalizedName: "peppers",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "peppers",
    aliases: ["bell peppers", "roasted peppers", "peppers"]
  },
  {
    normalizedName: "broccoli",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "broccoli",
    aliases: ["broccoli"]
  },
  {
    normalizedName: "cabbage",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "cabbage",
    aliases: ["cabbage"]
  },
  {
    normalizedName: "slaw",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "slaw",
    aliases: ["coleslaw", "slaw"]
  },
  {
    normalizedName: "corn",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "corn",
    aliases: ["street corn", "corn"]
  },
  {
    normalizedName: "edamame",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "edamame",
    aliases: ["edamame"]
  },
  {
    normalizedName: "mushrooms",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "mushrooms",
    aliases: ["mushrooms", "mushroom"]
  },
  {
    normalizedName: "vegetables",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "vegetables",
    aliases: [
      "wok-fired vegetables",
      "seasonal vegetables",
      "roasted vegetables",
      "roasted cauliflower",
      "cauliflower",
      "artichokes",
      "artichoke",
      "snap peas",
      "vegetables",
      "veggies"
    ]
  },
  {
    // Fruit on a savory salad. slot "fruit" (not "vegetable") so it is costed as
    // its own condiment without evicting the greens base from the veg slot.
    normalizedName: "fruit",
    category: "carb",
    slot: "fruit",
    nutritionKey: "fruit",
    aliases: [
      "dried cranberries",
      "mandarin oranges",
      "strawberries",
      "blueberries",
      "raspberries",
      "pineapple",
      "mango",
      "berries",
      "peaches",
      "apple"
    ]
  },

  // --- Condiment vegetables ------------------------------------------------
  {
    // Synonym rule from the spec: pico -> pico de gallo.
    normalizedName: "pico de gallo",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "pico_de_gallo",
    aliases: ["pico de gallo", "pico"]
  },
  {
    normalizedName: "salsa",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "salsa",
    aliases: ["salsa verde", "salsa"]
  },
  {
    normalizedName: "tomato",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "tomato",
    aliases: ["cherry tomatoes", "tomatoes", "tomato"]
  },
  {
    normalizedName: "onion",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "onion",
    aliases: ["red onion", "pickled onions", "shallots", "shallot", "onions", "onion"]
  },
  {
    normalizedName: "cucumber",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "cucumber",
    aliases: ["cucumbers", "cucumber"]
  },
  {
    normalizedName: "pickles",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "pickles",
    aliases: ["pickled fresnos", "pickled jalapenos", "pickled fresno", "fresnos", "pickles", "pickle"]
  },
  {
    normalizedName: "radish",
    category: "vegetable",
    slot: "vegetable",
    nutritionKey: "radish",
    aliases: ["watermelon radish", "daikon", "radish"]
  }
];

// Flattened, longest-first. Sorting once at module load is what lets the matcher
// resolve "crispy chicken" before "chicken" without any special-casing.
export const ALIAS_INDEX = INGREDIENT_DEFINITIONS.flatMap((def) =>
  def.aliases.map((alias) => ({ alias, def }))
).sort((a, b) => b.alias.length - a.alias.length);
