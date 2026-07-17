// test/publishedMacros.test.js
//
// A wrong number here is worse than a missing one: it ships with a "From the
// restaurant" label and high confidence, so nothing invites the user to doubt
// it. These tests lean on that — most of them assert that a plausible-looking
// misread returns null rather than a number.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parsePublishedCalories,
  parsePublishedMacros,
  parsePublishedMacrosPartial,
  macrosAreSelfConsistent,
  ATWATER_TOLERANCE
} from "../services/ingestion/publishedMacros.js";

describe("parsePublishedMacros: real menu text", () => {
  // Copied from sweetgreen.com/menu, which is where this module came from.
  test("reads value-first macros, the chain-restaurant convention", () => {
    assert.deepEqual(
      parsePublishedMacros(
        "Picnic Bowl Antibiotic-free blackened chicken, golden quinoa, corn salsa " +
          "Contains meat, milk, eggs, wheat 580 Calories 29G Protein 39G Carbs 32G Fat"
      ),
      { calories: 580, protein_g: 29, carbs_g: 39, fat_g: 32 }
    );
  });

  test("reads label-first macros, the nutrition-panel convention", () => {
    assert.deepEqual(
      parsePublishedMacros("Calories: 620 Protein: 41 g Total Carbohydrate: 45 g Total Fat: 28 g"),
      { calories: 620, protein_g: 41, carbs_g: 45, fat_g: 28 }
    );
  });

  test("accepts grams spelled out", () => {
    assert.deepEqual(
      parsePublishedMacros("500 calories 30 grams protein 40 grams carbs 20 grams fat"),
      { calories: 500, protein_g: 30, carbs_g: 40, fat_g: 20 }
    );
  });

  test("a price on the card does not become a macro", () => {
    assert.deepEqual(
      parsePublishedMacros("Steak Frites $28.00 810 Calories 52G Protein 41G Carbs 48G Fat"),
      { calories: 810, protein_g: 52, carbs_g: 41, fat_g: 48 }
    );
  });
});

describe("parsePublishedMacros: adjacency", () => {
  /**
   * The number 41 sits directly after the protein label AND directly before the
   * carbohydrate label. Nothing local disambiguates it — only reading the whole
   * run under one orientation does. This is the case a per-nutrient regex gets
   * wrong, silently, by reporting protein's grams as the carb count.
   */
  test("a number between two labels belongs to only one of them", () => {
    const macros = parsePublishedMacros(
      "Calories: 620 Protein: 41 g Total Carbohydrate: 45 g Total Fat: 28 g"
    );
    assert.equal(macros.protein_g, 41);
    assert.equal(macros.carbs_g, 45, "45 belongs to carbohydrate, not 41");
  });

  test("sub-lines of a nutrition panel never answer for their totals", () => {
    const macros = parsePublishedMacros(
      "Calories 620 Protein 41g Carbs 45g Total Fat 28g Saturated Fat 9g Trans Fat 0g"
    );
    assert.equal(macros.fat_g, 28, "saturated fat must not be read as total fat");
  });

  test("fiber and sugar rows do not displace the carb count", () => {
    const macros = parsePublishedMacros(
      "700 cal 50g protein 60g carbs 25g fat Dietary Fiber 8g Total Sugars 12g"
    );
    assert.equal(macros.carbs_g, 60);
  });
});

describe("parsePublishedMacros: refuses to guess", () => {
  test("a partial set is no set at all", () => {
    // Chipotle publishes calories alone. Mixing a published calorie count with
    // three estimated macros would produce an item no label describes honestly.
    assert.equal(parsePublishedMacros("Burrito Bowl 630 Cal"), null);
    assert.equal(parsePublishedMacros("Bowl 500 Calories 30G Protein"), null);
  });

  test("protein, carbs and fat must state their grams", () => {
    // Without this, "$14.95 Protein Bowl" reports 14.95 grams of protein.
    assert.equal(parsePublishedMacros("Bowl 500 Calories 30 Protein 40 Carbs 20 Fat"), null);
    assert.equal(parsePublishedMacros("$14.95 Protein Bowl Grilled chicken, rice"), null);
  });

  test("numbers that contradict each other are a misparse, not a meal", () => {
    // 90/90/90 is 1,530 calories by any accounting. Something was read wrong.
    assert.equal(parsePublishedMacros("Salad 100 Calories 90G Protein 90G Carbs 90G Fat"), null);
  });

  test("a menu that publishes nothing yields nothing", () => {
    assert.equal(parsePublishedMacros("Picnic Bowl Antibiotic-free chicken, quinoa"), null);
    assert.equal(parsePublishedMacros(""), null);
    assert.equal(parsePublishedMacros(null), null);
    assert.equal(parsePublishedMacros(undefined), null);
  });

  test("implausible magnitudes are rejected", () => {
    assert.equal(parsePublishedMacros("Bowl 9 Calories 1G Protein 1G Carbs 0G Fat"), null);
  });
});

describe("parsePublishedMacrosPartial: whichever macros are actually printed", () => {
  // True Food Kitchen's real pattern: "(11g protein | 600 cal)" — protein and
  // calories stated, carbs and fat never printed anywhere on the page.
  // parsePublishedMacros correctly refuses this as a set; estimation should
  // still stop guessing at the two numbers the page actually gives it.
  test("reads protein and calories, and leaves out carbs/fat that were never stated", () => {
    assert.deepEqual(
      parsePublishedMacrosPartial("Seasonal Market Salad honey roasted carrots (11g protein | 600 cal) VEG GF"),
      { protein_g: 11, calories: 600 }
    );
  });

  test("reads a bare calorie count with nothing else stated", () => {
    assert.deepEqual(parsePublishedMacrosPartial("Chicken Sandwich 440 Cal per Sandwich"), {
      calories: 440
    });
  });

  test("reads all four when the full set is present, same as parsePublishedMacros would accept", () => {
    assert.deepEqual(
      parsePublishedMacrosPartial("580 Calories 29G Protein 39G Carbs 32G Fat"),
      { calories: 580, protein_g: 29, carbs_g: 39, fat_g: 32 }
    );
  });

  test("protein without its grams unit is not read as protein", () => {
    // Same rule 2 as parsePublishedMacros: "$14.95 Protein Bowl" must not
    // report 14.95 grams of protein.
    assert.deepEqual(parsePublishedMacrosPartial("$14.95 Protein Bowl"), {});
  });

  test("a price is never mistaken for a calorie count", () => {
    assert.deepEqual(parsePublishedMacrosPartial("Steak Frites $28.00"), {});
  });

  test("nothing published yields an empty object, not null", () => {
    assert.deepEqual(parsePublishedMacrosPartial("Picnic Bowl Antibiotic-free chicken, quinoa"), {});
    assert.deepEqual(parsePublishedMacrosPartial(""), {});
    assert.deepEqual(parsePublishedMacrosPartial(null), {});
  });
});

describe("parsePublishedCalories: a calorie-only fallback", () => {
  // Chick-fil-A prints "440 Cal per Sandwich" next to each item, with no
  // protein/carbs/fat on the same card (those live on a separate nutrition
  // page). parsePublishedMacros correctly refuses this — it's not a full set —
  // but the calorie number itself is real and should not be thrown away.
  test("reads a bare calorie count with no other macros present", () => {
    assert.equal(
      parsePublishedCalories("Chick-fil-A Chicken Sandwich 440 Cal per Sandwich"),
      440
    );
    assert.equal(
      parsePublishedCalories("Spicy Chicken Sandwich 460 Cal per Sandwich"),
      460
    );
  });

  test("still finds calories when the full macro set IS present", () => {
    assert.equal(
      parsePublishedCalories("580 Calories 29G Protein 39G Carbs 32G Fat"),
      580
    );
  });

  test("a price is never mistaken for a calorie count", () => {
    assert.equal(parsePublishedCalories("Steak Frites $28.00"), null);
  });

  test("implausible magnitudes are rejected, same as the full parser", () => {
    assert.equal(parsePublishedCalories("Bowl 9 Cal"), null);
  });

  test("no calories printed at all yields null", () => {
    assert.equal(parsePublishedCalories("Picnic Bowl Antibiotic-free chicken, quinoa"), null);
    assert.equal(parsePublishedCalories(""), null);
    assert.equal(parsePublishedCalories(null), null);
  });
});

describe("macrosAreSelfConsistent", () => {
  test("accepts real menu items whose Atwater sum drifts", () => {
    // sweetgreen's Classic Chicken Caesar: 4*47 + 4*64 + 9*60 = 984 vs 830 (19%).
    assert.ok(macrosAreSelfConsistent({ calories: 830, protein_g: 47, carbs_g: 64, fat_g: 60 }));
    // ...and its peach salad, which lands within 3%.
    assert.ok(macrosAreSelfConsistent({ calories: 445, protein_g: 17, carbs_g: 22, fat_g: 31 }));
  });

  test("rejects a set that cannot describe one dish", () => {
    assert.equal(
      macrosAreSelfConsistent({ calories: 100, protein_g: 90, carbs_g: 90, fat_g: 90 }),
      false
    );
  });

  test("zero calories can never be consistent", () => {
    assert.equal(macrosAreSelfConsistent({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), false);
  });

  test("the tolerance is a sanity check, not an audit", () => {
    assert.ok(ATWATER_TOLERANCE >= 0.2 && ATWATER_TOLERANCE <= 0.5);
  });
});
