// test/macroEstimator.test.js
//
// Macro assertions are RANGES, not exact numbers. The nutrition table is a set
// of assumptions we expect to tune; freezing "705 calories" into a test would
// make every future tuning pass look like a regression. What must not change is
// the relationships: a grilled bowl beats a fried sandwich on protein density,
// frying costs calories, and we never invent protein that isn't there.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { estimateMacros } from "../services/nutrition/macroEstimator.js";
import { detectIngredients } from "../services/nutrition/ingredientDetector.js";
import {
  applyMacroAdjustments,
  applyPortionAdjustments,
  detectPreparationSignals
} from "../services/nutrition/preparationAdjustments.js";
import { MAX_MACRO_CONFIDENCE } from "../services/confidenceScoring.js";
import { MACRO_SOURCE_ESTIMATED } from "../types/menu.js";

const CHICKEN_BOWL = {
  section: "Bowls",
  dishName: "Baja Chicken Bowl",
  description: "Grilled chicken, brown rice, black beans, avocado, pico de gallo, chipotle crema"
};

const CRISPY_SANDWICH = {
  section: "Bowls",
  dishName: "Crispy Chicken Sandwich",
  description: "Fried chicken, brioche bun, slaw, pickles, spicy aioli"
};

const names = (result) => result.detectedIngredients.map((i) => i.normalizedName);
const proteinDensity = (m) => m.protein_g / m.calories;

describe("ingredientDetector", () => {
  test("detects ingredients from a description", () => {
    const { matches } = detectIngredients(CHICKEN_BOWL.dishName, CHICKEN_BOWL.description);
    const detected = matches.map((m) => m.definition.normalizedName);
    for (const expected of ["chicken breast", "brown rice", "black beans", "avocado", "pico de gallo", "crema"]) {
      assert.ok(detected.includes(expected), `expected to detect ${expected}, got ${detected}`);
    }
  });

  test("longest alias wins: \"crispy chicken\" is fried chicken, not chicken breast", () => {
    const { matches } = detectIngredients("Crispy Chicken Sandwich", "");
    const detected = matches.map((m) => m.definition.normalizedName);
    assert.ok(detected.includes("fried chicken"));
    assert.ok(!detected.includes("chicken breast"), "must not also match the bare noun");
  });

  test("applies the synonym rules", () => {
    const synonyms = [
      ["spicy aioli", "mayo"],
      ["chipotle crema", "crema"],
      ["pico", "pico de gallo"],
      ["beef patty", "burger patty"],
      ["mixed greens", "lettuce"]
    ];
    for (const [raw, normalized] of synonyms) {
      const { matches } = detectIngredients("Dish", raw);
      const detected = matches.map((m) => m.definition.normalizedName);
      assert.ok(detected.includes(normalized), `${raw} should normalize to ${normalized}`);
    }
  });

  test("an ingredient named twice is detected once", () => {
    const { matches } = detectIngredients("Crispy Chicken Sandwich", "Fried chicken, brioche bun");
    const proteins = matches.filter((m) => m.definition.slot === "protein");
    assert.equal(proteins.length, 1);
  });

  test("reports how much of a description it did not understand", () => {
    const known = detectIngredients("Bowl", "Grilled chicken, brown rice, black beans");
    assert.equal(known.phraseStats.matched, known.phraseStats.total);

    const unknown = detectIngredients("Bowl", "Za'atar labneh, sumac muhammara, dukkah");
    assert.equal(unknown.phraseStats.matched, 0);
    assert.ok(unknown.phraseStats.total > 0);
  });
});

describe("macroEstimator: a chicken bowl", () => {
  const result = estimateMacros(CHICKEN_BOWL);

  test("identifies the dish type and its ingredients", () => {
    assert.equal(result.dishType, "bowl");
    assert.ok(names(result).includes("chicken breast"));
    assert.ok(names(result).includes("brown rice"));
  });

  test("estimates macros in a plausible range for a chicken bowl", () => {
    const m = result.estimatedMacros;
    assert.ok(m.calories >= 550 && m.calories <= 850, `calories ${m.calories}`);
    // A grilled-chicken bowl is still a strong-protein meal, but the protein slot
    // is a conservative 3.5 oz scoop (see portionTemplates): restaurant bowls
    // carry protein as a topping, and JOEY's real bowls run 29-38 g. ~35+ here.
    assert.ok(m.protein_g >= 35, `protein ${m.protein_g}`);
    assert.ok(m.carbs_g >= 50 && m.carbs_g <= 95, `carbs ${m.carbs_g}`);
    assert.ok(m.fat_g >= 10 && m.fat_g <= 35, `fat ${m.fat_g}`);
  });

  test("marks the macros as estimated and lists its assumptions", () => {
    assert.equal(result.macroSource, MACRO_SOURCE_ESTIMATED);
    assert.ok(result.assumptions.length >= 4);
    assert.ok(result.assumptions.some((a) => /chicken/i.test(a)));
    assert.ok(result.assumptions.some((a) => /rice/i.test(a)));
    assert.ok(result.assumptions.some((a) => /beans/i.test(a)));
  });

  test("condiments are counted at one serving, never scaled to a full portion", () => {
    // 1 cup of pico de gallo would be absurd; the bowl's vegetable slot is 1 cup.
    assert.ok(result.assumptions.some((a) => /1 standard serving of pico de gallo/i.test(a)));
  });

  test("macro confidence is high but never certain", () => {
    assert.ok(result.macroConfidence > 0.6);
    assert.ok(result.macroConfidence <= MAX_MACRO_CONFIDENCE);
  });
});

describe("macroEstimator: relative quality is the point", () => {
  test("the grilled chicken bowl beats the crispy chicken sandwich on protein density", () => {
    const bowl = estimateMacros(CHICKEN_BOWL).estimatedMacros;
    const sandwich = estimateMacros(CRISPY_SANDWICH).estimatedMacros;
    assert.ok(
      proteinDensity(bowl) > proteinDensity(sandwich),
      `bowl ${proteinDensity(bowl).toFixed(3)} should beat sandwich ${proteinDensity(sandwich).toFixed(3)}`
    );
  });

  test("frying the same sandwich costs calories and fat, and loses protein", () => {
    const grilled = estimateMacros({
      dishName: "Grilled Chicken Sandwich",
      description: "Grilled chicken, brioche bun, lettuce, tomato"
    }).estimatedMacros;
    const crispy = estimateMacros({
      dishName: "Crispy Chicken Sandwich",
      description: "Fried chicken, brioche bun, lettuce, tomato"
    }).estimatedMacros;

    assert.ok(crispy.calories > grilled.calories);
    assert.ok(crispy.fat_g > grilled.fat_g);
    assert.ok(crispy.protein_g < grilled.protein_g);
  });
});

describe("macroEstimator: never invent protein", () => {
  test("a veggie bowl gets no meat and scores as a low-protein meal", () => {
    const result = estimateMacros({
      dishName: "Veggie Grain Bowl",
      description: "Roasted vegetables, chickpeas, and farro with tahini"
    });
    assert.ok(!names(result).includes("chicken breast"));
    assert.ok(result.estimatedMacros.protein_g < 30);
    assert.ok(result.estimatedMacros.calories > 0);
  });

  test("a burger gets a patty and a bun, because the dish type guarantees them", () => {
    const result = estimateMacros({ dishName: "Cheeseburger" });
    assert.equal(result.dishType, "burger");
    assert.ok(result.estimatedMacros.protein_g > 25);
    assert.ok(result.assumptions.some((a) => /patty/i.test(a)));
    assert.ok(result.assumptions.some((a) => /bun/i.test(a)));
  });
});

describe("macroEstimator: sides are not counted as part of the entree", () => {
  test("\"served with fries\" does not add a side's calories to a burger", () => {
    const plain = estimateMacros({ dishName: "Cheeseburger", description: "Beef patty, cheddar, lettuce" });
    const withFries = estimateMacros({
      dishName: "Cheeseburger",
      description: "Beef patty, cheddar, lettuce, served with fries"
    });
    assert.equal(withFries.estimatedMacros.calories, plain.estimatedMacros.calories);

    const fries = withFries.detectedIngredients.find((i) => i.normalizedName === "fries");
    assert.equal(fries.countedInMacros, false, "fries should be reported but not costed");
    assert.ok(withFries.assumptions.some((a) => /did not count french fries/i.test(a)));
  });
});

describe("macroEstimator: a burrito is heavier than a wrap", () => {
  const burrito = estimateMacros({
    dishName: "Carne Asada Burrito",
    description: "Steak, rice, black beans, cheese, pico de gallo, guacamole"
  });

  test("classifies burritos as their own dish type, not a wrap", () => {
    assert.equal(burrito.dishType, "burrito");
  });

  test("a burrito lands in the range real burritos occupy", () => {
    // Spec §38 sanity check: burritos run 700–1,400 cal. A wrap template would
    // have costed a thin tortilla and no rice, landing this far too low.
    const m = burrito.estimatedMacros;
    assert.ok(m.calories >= 700 && m.calories <= 1400, `calories ${m.calories}`);
    assert.ok(m.carbs_g >= 60, `carbs ${m.carbs_g}`);
  });

  test("a burrito costs more than the same filling in a wrap", () => {
    const wrap = estimateMacros({
      dishName: "Carne Asada Wrap",
      description: "Steak, rice, black beans, cheese, pico de gallo, guacamole"
    });
    assert.ok(
      burrito.estimatedMacros.calories > wrap.estimatedMacros.calories,
      `burrito ${burrito.estimatedMacros.calories} should beat wrap ${wrap.estimatedMacros.calories}`
    );
  });

  test("rice and beans are assumed for a bare burrito, the way a bun is for a burger", () => {
    const bare = estimateMacros({ dishName: "Chicken Burrito" });
    assert.equal(bare.dishType, "burrito");
    assert.ok(bare.assumptions.some((a) => /rice/i.test(a)));
    assert.ok(bare.assumptions.some((a) => /beans/i.test(a)));
  });
});

describe("macroEstimator: a bacon add-on does not eat the sauce portion", () => {
  // Bacon sits in the "sauce" slot so it is never read as the dish's protein.
  // As a bulk item it SPLIT that slot with the real sauce, halving a club
  // sandwich's spicy mayo to 0.5 tbsp and costing it ~10g of fat.
  test("bacon is costed at one serving and leaves the spread whole", () => {
    const withBacon = estimateMacros({
      dishName: "Grilled Chicken Club",
      description: "grilled chicken, spicy mayo, aged cheddar, smoky bacon"
    });
    const withoutBacon = estimateMacros({
      dishName: "Grilled Chicken Sandwich",
      description: "grilled chicken, spicy mayo, aged cheddar"
    });

    // The mayo portion is identical either way — bacon does not dilute it.
    assert.ok(withBacon.assumptions.some((a) => /2 tbsp of mayo/i.test(a)));
    assert.ok(withoutBacon.assumptions.some((a) => /2 tbsp of mayo/i.test(a)));

    // Adding bacon can only ADD fat, never remove it.
    assert.ok(
      withBacon.estimatedMacros.fat_g > withoutBacon.estimatedMacros.fat_g,
      `bacon should add fat: ${withBacon.estimatedMacros.fat_g} vs ${withoutBacon.estimatedMacros.fat_g}`
    );
  });
});

describe("macroEstimator: sushi is rice-forward, not a plated fillet", () => {
  test("a sushi roll estimates low calories and modest protein", () => {
    const r = estimateMacros({
      section: "Sushi",
      dishName: "Tuna & Avocado Roll",
      description: "marinated ahi tuna, avocado, spicy mayo, rice"
    });
    assert.equal(r.dishType, "sushi");
    // A roll is ~250-500 cal with a couple ounces of fish — nowhere near the
    // 6 oz-protein plate it used to be costed as.
    assert.ok(r.estimatedMacros.calories <= 650, `calories ${r.estimatedMacros.calories}`);
    assert.ok(r.estimatedMacros.protein_g <= 25, `protein ${r.estimatedMacros.protein_g}`);
  });

  test("\"Seared Salmon Sushi\" is sushi, not a salmon plate", () => {
    const r = estimateMacros({ section: "Sushi", dishName: "Seared Salmon Sushi", description: "fire torched salmon, rice" });
    assert.equal(r.dishType, "sushi");
  });
});

describe("macroEstimator: a stated steak weight sizes the protein", () => {
  test("a 14 oz steak carries far more protein than a default plate", () => {
    const big = estimateMacros({
      section: "Steaks",
      dishName: "Prime New York Strip",
      description: "14 oz prime new york strip, mashed potatoes, seasonal vegetables"
    });
    const plain = estimateMacros({
      section: "Steaks",
      dishName: "Sirloin Steak",
      description: "top sirloin, mashed potatoes, seasonal vegetables"
    });
    assert.ok(big.estimatedMacros.protein_g > plain.estimatedMacros.protein_g + 30,
      `14oz ${big.estimatedMacros.protein_g} vs default ${plain.estimatedMacros.protein_g}`);
    assert.ok(big.assumptions.some((a) => /14 oz/.test(a)));
  });

  test("a \"6 oz Fries\" side does not scale the protein portion", () => {
    const signals = detectPreparationSignals("Chicken Tenders", "5 pcs, 6 oz fries");
    assert.equal(signals.statedProteinOz, null);
  });

  // A steakhouse names the cut in the TITLE and leaves the weight standing alone
  // in the description — the two are never adjacent. This is JOEY's real markup.
  test("a bare weight is read when the dish name is already a steak cut", () => {
    const signals = detectPreparationSignals(
      "Prime New York Strip",
      "14 oz, our famous fully loaded crispy mashed potatoes, seasonal vegetables"
    );
    assert.equal(signals.statedProteinOz, 14);

    const strip = estimateMacros({
      section: "Steaks",
      dishName: "Prime New York Strip",
      description: "14 oz, our famous fully loaded crispy mashed potatoes, seasonal vegetables"
    });
    assert.ok(strip.estimatedMacros.protein_g >= 75, `protein ${strip.estimatedMacros.protein_g}`);
  });
});

describe("macroEstimator: fajitas keep their tortillas", () => {
  test("a fajita is carb-heavy from the tortilla stack, not a bare plate", () => {
    const r = estimateMacros({
      section: "Mains",
      dishName: "Chicken Fajitas",
      description: "blackened chicken, sauteed peppers and onions, guacamole, flour tortillas"
    });
    assert.equal(r.dishType, "fajita");
    assert.ok(r.estimatedMacros.carbs_g >= 90, `carbs ${r.estimatedMacros.carbs_g}`);
    assert.ok(r.estimatedMacros.calories >= 950, `calories ${r.estimatedMacros.calories}`);
  });
});

describe("preparationAdjustments", () => {
  const base = { calories: 400, protein_g: 40, carbs_g: 30, fat_g: 10 };

  test("fried/crispy adds calories, fat and carbs", () => {
    const signals = detectPreparationSignals("Crispy Chicken Salad", "chicken, romaine");
    assert.equal(signals.fried, true);

    const { macros, applied } = applyMacroAdjustments(base, signals, new Set(["chicken_breast"]));
    assert.ok(applied.includes("fried"));
    assert.ok(macros.calories > base.calories);
    assert.ok(macros.fat_g > base.fat_g);
    assert.ok(macros.carbs_g > base.carbs_g);
  });

  test("the fried delta is suppressed when fried chicken was already costed", () => {
    const signals = detectPreparationSignals("Crispy Chicken Sandwich", "fried chicken, bun");
    const { macros, applied, assumptions } = applyMacroAdjustments(
      base,
      signals,
      new Set(["fried_chicken"])
    );
    assert.ok(!applied.includes("fried"), "must not charge for the breading twice");
    assert.equal(macros.calories, base.calories);
    assert.ok(assumptions.some((a) => /already included in the fried chicken/i.test(a)));
  });

  test("glazed/honey/teriyaki/bbq adds calories and carbs but not fat", () => {
    const signals = detectPreparationSignals("Teriyaki Chicken Bowl", "");
    const { macros } = applyMacroAdjustments(base, signals, new Set());
    assert.ok(macros.carbs_g > base.carbs_g);
    assert.equal(macros.fat_g, base.fat_g);
  });

  test("a lean grilled protein gets a hidden restaurant cooking-fat allowance", () => {
    const signals = detectPreparationSignals("Grilled Chicken Plate", "grilled chicken, rice");
    const { macros, applied, assumptions } = applyMacroAdjustments(
      base,
      signals,
      new Set(["chicken_breast"])
    );
    assert.ok(applied.includes("cookingFat"), "grilled lean protein is not cooked dry");
    assert.ok(macros.fat_g > base.fat_g);
    assert.ok(macros.calories > base.calories);
    assert.equal(macros.protein_g, base.protein_g, "cooking oil adds no protein");
    assert.ok(assumptions.some((a) => /cooking oil/i.test(a)));
  });

  test("cooking fat is not added on top of a fried protein or an explicit oil", () => {
    const friedSignals = detectPreparationSignals("Crispy Chicken", "fried chicken");
    const fried = applyMacroAdjustments(base, friedSignals, new Set(["fried_chicken"]));
    assert.ok(!fried.applied.includes("cookingFat"), "fried entry already carries its oil");

    const plainSignals = detectPreparationSignals("Chicken with Olive Oil", "chicken, olive oil");
    const explicit = applyMacroAdjustments(
      base,
      plainSignals,
      new Set(["chicken_breast", "olive_oil"])
    );
    assert.ok(!explicit.applied.includes("cookingFat"), "named oil is the cooking fat");
  });

  test("a bare vegetable dish gets no cooking-fat allowance", () => {
    const signals = detectPreparationSignals("Roasted Vegetables", "vegetables, quinoa");
    const { applied } = applyMacroAdjustments(base, signals, new Set(["vegetables", "quinoa"]));
    assert.ok(!applied.includes("cookingFat"), "the allowance is protein-gated");
  });

  test("\"smothered\" and \"au gratin\" read as a creamy preparation", () => {
    assert.equal(detectPreparationSignals("Smothered Chicken", "").creamy, true);
    assert.equal(detectPreparationSignals("Potatoes au Gratin", "").creamy, true);
  });

  test("double protein doubles the protein portion before costing", () => {
    const slots = [{ slot: "protein", amount: 5, unit: "oz", assumeWhenAbsent: false }];
    const signals = detectPreparationSignals("Double Protein Bowl", "");
    const { slots: adjusted } = applyPortionAdjustments(slots, signals);
    assert.equal(adjusted[0].amount, 10);
  });

  test("a lettuce wrap drops the bread assumption", () => {
    const bunless = estimateMacros({
      dishName: "Cheeseburger",
      description: "Beef patty, cheddar, lettuce wrapped, no bun"
    });
    const normal = estimateMacros({ dishName: "Cheeseburger", description: "Beef patty, cheddar" });

    assert.ok(bunless.estimatedMacros.carbs_g < normal.estimatedMacros.carbs_g);
    assert.ok(bunless.assumptions.some((a) => /removed the bread portion/i.test(a)));
  });
});

describe("macroEstimator: anchoring to whichever macros are published", () => {
  // The reported bug: two different sandwiches (actual 440 and 460 cal per
  // Chick-fil-A's own site) both landed on an identical, generic 350 because
  // the estimator never looked at the calorie number the page printed.
  test("a published calorie count overrides the estimate", () => {
    const withoutAnchor = estimateMacros({
      dishName: "Chicken Sandwich",
      description: "Fried chicken, brioche bun, pickles"
    });
    const withAnchor = estimateMacros(
      { dishName: "Chicken Sandwich", description: "Fried chicken, brioche bun, pickles" },
      { publishedMacros: { calories: 440 } }
    );

    assert.equal(withAnchor.estimatedMacros.calories, 440);
    assert.notEqual(withAnchor.estimatedMacros.calories, withoutAnchor.estimatedMacros.calories);
  });

  test("carbs and fat are still estimates when only calories is published", () => {
    const withoutAnchor = estimateMacros({ dishName: "Chicken Sandwich" });
    const withAnchor = estimateMacros(
      { dishName: "Chicken Sandwich" },
      { publishedMacros: { calories: 440 } }
    );

    assert.equal(withAnchor.estimatedMacros.protein_g, withoutAnchor.estimatedMacros.protein_g);
    assert.equal(withAnchor.macroSource, MACRO_SOURCE_ESTIMATED, "still an estimate, not published");
  });

  test("two different sandwiches get two different calorie counts, not one generic guess", () => {
    const chicken = estimateMacros(
      { dishName: "Chick-fil-A Chicken Sandwich", description: "Fried chicken, bun, pickles" },
      { publishedMacros: { calories: 440 } }
    );
    const spicy = estimateMacros(
      { dishName: "Spicy Chicken Sandwich", description: "Fried chicken, bun, pickles" },
      { publishedMacros: { calories: 460 } }
    );

    assert.equal(chicken.estimatedMacros.calories, 440);
    assert.equal(spicy.estimatedMacros.calories, 460);
  });

  // True Food Kitchen's actual pattern: "(11g protein | 600 cal)" — protein
  // and calories stated, carbs and fat never printed anywhere on the page.
  test("protein is anchored independently of calories, carbs stay estimated", () => {
    const withoutAnchor = estimateMacros({
      dishName: "Seasonal Market Salad",
      description: "honey roasted carrots, roasted cauliflower, organic mixed greens, pistachios, feta, medjool dates"
    });
    const withAnchor = estimateMacros(
      {
        dishName: "Seasonal Market Salad",
        description: "honey roasted carrots, roasted cauliflower, organic mixed greens, pistachios, feta, medjool dates"
      },
      { publishedMacros: { calories: 600, protein_g: 11 } }
    );

    assert.equal(withAnchor.estimatedMacros.calories, 600);
    assert.equal(withAnchor.estimatedMacros.protein_g, 11);
    // carbs_g and fat_g were never published for this dish, so they must stay
    // whatever the template/ingredient estimate produced.
    assert.equal(withAnchor.estimatedMacros.carbs_g, withoutAnchor.estimatedMacros.carbs_g);
    assert.equal(withAnchor.estimatedMacros.fat_g, withoutAnchor.estimatedMacros.fat_g);
  });

  test("protein alone can be published with no calorie anchor at all", () => {
    const result = estimateMacros(
      { dishName: "Chicken Sandwich" },
      { publishedMacros: { protein_g: 32 } }
    );
    assert.equal(result.estimatedMacros.protein_g, 32);
  });

  test("every published macro is disclosed in assumptions, by name", () => {
    const result = estimateMacros(
      { dishName: "Seasonal Market Salad" },
      { publishedMacros: { calories: 600, protein_g: 11 } }
    );
    assert.ok(result.assumptions.some((a) => /600/.test(a) && /menu/i.test(a)));
    assert.ok(result.assumptions.some((a) => /11g/.test(a) && /menu/i.test(a)));
  });

  test("no publishedMacros means no change in behavior", () => {
    const a = estimateMacros({ dishName: "Chicken Sandwich" });
    const b = estimateMacros({ dishName: "Chicken Sandwich" }, {});
    assert.deepEqual(a.estimatedMacros, b.estimatedMacros);
  });
});

describe("macroEstimator: vague items", () => {
  test("\"Chef's Special\" returns low confidence", () => {
    const result = estimateMacros({ dishName: "Chef's Special", section: "Entrees" });
    assert.equal(result.dishType, "unknown");
    assert.ok(result.macroConfidence < 0.35, `expected low confidence, got ${result.macroConfidence}`);
  });

  test("the curly apostrophe form is just as vague", () => {
    const straight = estimateMacros({ dishName: "Chef's Special", section: "Entrees" });
    const curly = estimateMacros({ dishName: "Chef’s Special", section: "Entrees" });
    assert.equal(curly.macroConfidence, straight.macroConfidence);
  });

  test("a described item beats a bare name, which beats a vague name", () => {
    const described = estimateMacros(CHICKEN_BOWL).macroConfidence;
    const bare = estimateMacros({ dishName: "Chicken Bowl", section: "Bowls" }).macroConfidence;
    const vague = estimateMacros({ dishName: "Chef's Special", section: "Bowls" }).macroConfidence;
    assert.ok(described > bare, `${described} should beat ${bare}`);
    assert.ok(bare > vague, `${bare} should beat ${vague}`);
  });

  test("confidence is always clamped to 0..1", () => {
    for (const item of [CHICKEN_BOWL, CRISPY_SANDWICH, { dishName: "Chef's Special" }, { dishName: "X" }]) {
      const c = estimateMacros(item).macroConfidence;
      assert.ok(c >= 0 && c <= 1, `confidence ${c} out of range`);
    }
  });
});
