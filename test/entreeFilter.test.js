// test/entreeFilter.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyInclusion, isKnownSectionName } from "../services/ingestion/entreeFilter.js";
import { classifyDishType } from "../services/nutrition/dishTypeClassifier.js";

/** Mirrors how menuExtractionService wires the two modules together. */
function decide(item) {
  const { dishType } = classifyDishType(item);
  return classifyInclusion({ ...item, dishType });
}

describe("entreeFilter: inclusion", () => {
  test("includes entree sections and recognizable dish types", () => {
    const included = [
      { dishName: "Baja Chicken Bowl", section: "BOWLS" },
      { dishName: "Crispy Chicken Sandwich", section: "BOWLS" },
      { dishName: "Classic Cheeseburger", section: "Burgers" },
      { dishName: "Salmon Caesar Salad", section: "Salads" },
      { dishName: "Chicken Alfredo", section: "Pasta" },
      { dishName: "Carne Asada Tacos" },
      { dishName: "Steak Plate", section: "Entrees" }
    ];
    for (const item of included) {
      assert.equal(decide(item).includedInV1, true, `${item.dishName} should be included`);
    }
  });
});

describe("entreeFilter: exclusion", () => {
  test("excludes drinks, sides, desserts and kids items with a reason", () => {
    const excluded = [
      { dishName: "French Fries", section: "SIDES" },
      { dishName: "House Lemonade", section: "DRINKS" },
      { dishName: "Chocolate Cake", section: "Desserts" },
      { dishName: "Kids Cheeseburger", section: "Kids" },
      { dishName: "IPA Draft", section: "Beer" },
      { dishName: "Mozzarella Sticks", section: "Appetizers" },
      { dishName: "Ranch", section: "Sauces" },
      { dishName: "Add Grilled Chicken", section: "Extras" }
    ];
    for (const item of excluded) {
      const result = decide(item);
      assert.equal(result.includedInV1, false, `${item.dishName} should be excluded`);
      assert.ok(result.exclusionReason, `${item.dishName} needs an exclusionReason`);
    }
  });

  test("an excluded section outranks a recognizable dish type", () => {
    // A cheeseburger is a burger. Under "Kids" it is still a kids item.
    const result = decide({ dishName: "Kids Cheeseburger", section: "Kids" });
    assert.equal(result.includedInV1, false);
    assert.match(result.exclusionReason, /kids/i);
  });

  test("an excluded item outranks an included section", () => {
    const result = decide({ dishName: "House Lemonade", section: "Entrees" });
    assert.equal(result.includedInV1, false);
    assert.match(result.exclusionReason, /drink/i);
  });

  test("unrecognizable items are excluded rather than guessed at", () => {
    const result = decide({ dishName: "Chef's Special" });
    assert.equal(result.includedInV1, false);
    assert.match(result.exclusionReason, /could not identify/i);
  });

  test("a vague name under an entree section is still included", () => {
    // The section vouches for it; macro confidence is where the doubt shows up.
    assert.equal(decide({ dishName: "Chef's Special", section: "Entrees" }).includedInV1, true);
  });
});

describe("entreeFilter: the patterns that are easy to get wrong", () => {
  test("does not exclude entrees that merely contain a side's name", () => {
    // A bare /fries/ or /chips/ rule would have killed both of these.
    assert.equal(decide({ dishName: "Fish and Chips", section: "Entrees" }).includedInV1, true);
    assert.equal(decide({ dishName: "Steak Frites", section: "Entrees" }).includedInV1, true);
    // A bare /cake$/ or /pie$/ rule would have killed these.
    assert.equal(decide({ dishName: "Crab Cakes", section: "Entrees" }).includedInV1, true);
    assert.equal(decide({ dishName: "Shepherd's Pie", section: "Entrees" }).includedInV1, true);
  });

  test("does not treat coffee-crusted entrees as drinks", () => {
    assert.equal(decide({ dishName: "Coffee Crusted Prime NY Strip" }).includedInV1, true);
    assert.equal(decide({ dishName: "Coffee", section: "Drinks" }).includedInV1, false);
  });

  test("\"Small Plates\" is an appetizer section, not a plates section", () => {
    assert.equal(decide({ dishName: "Steak Plate", section: "Small Plates" }).includedInV1, false);
    assert.equal(decide({ dishName: "Steak Plate", section: "Plates" }).includedInV1, true);
  });

  test("\"Side Salads\" is a sides section, not a salads section", () => {
    assert.equal(decide({ dishName: "Garden Salad", section: "Side Salads" }).includedInV1, false);
  });

  test("family portions are excluded, individual entrees in catering are not", () => {
    const shared = decide({ dishName: "Chicken Bowl Family Pack", section: "Catering" });
    assert.equal(shared.includedInV1, false);
    assert.match(shared.exclusionReason, /shared or family/i);

    const single = decide({ dishName: "Chicken Bowl", section: "Catering" });
    assert.equal(single.includedInV1, true);
  });

  // Real headings are rarely a bare category word.
  test("a category word anywhere in the heading classifies the section", () => {
    // Celebration Restaurant's actual heading. Exact-equality matching dropped
    // every entree under it.
    const heading = "DINNER & SUNDAY LUNCH ENTREES";
    assert.equal(decide({ dishName: "Pot Roast", section: heading }).includedInV1, true);
    assert.equal(decide({ dishName: "Fried Catfish", section: heading }).includedInV1, true);
    assert.equal(decide({ dishName: "Meat Loaf", section: "SALADS AND SOUPS" }).includedInV1, true);
  });

  test("a heading naming both an entree and an excluded category is excluded", () => {
    // Conservative on purpose: ranking a side as a meal is the worse error.
    const result = decide({ dishName: "Turkey Club", section: "SANDWICHES & SIDES" });
    assert.equal(result.includedInV1, false);
    assert.match(result.exclusionReason, /sides/i);
  });

  test("sauce options and modifiers are not entrees", () => {
    const excluded = [
      { dishName: "Marinara Sauce", section: "Pasta" },
      { dishName: "Pesto", section: "Pasta" },
      { dishName: "Meat Sauce  Alfredo Sauce", section: "Pasta" },
      { dishName: "(Beef or Chicken)", section: "Pasta" },
      { dishName: "Choice of Pasta and Topping", section: "Pasta" },
      { dishName: "Create Your Own Pizza", section: "Pizza" }
    ];
    for (const item of excluded) {
      assert.equal(decide(item).includedInV1, false, `${item.dishName} should be excluded`);
    }
  });

  test("an entree that merely ends in \"sauce\" survives", () => {
    assert.equal(decide({ dishName: "Spaghetti with Meat Sauce", section: "Pasta" }).includedInV1, true);
  });

  test("an add-on under \"Elevate Your Plate\" is kept, but flagged as a side", () => {
    // "Elevate Your Plate" contains PLATE, so the plates rule includes it — that
    // is how a $27 lobster-tail add-on ranked #1 on JOEY. It should still be
    // kept (a lean lobster tail has good macros) but marked a side, not a meal.
    const lobster = decide({ dishName: "Lobster Tail", section: "ELEVATE YOUR PLATE" });
    assert.equal(lobster.includedInV1, true);
    assert.equal(lobster.isSide, true);

    const shrimp = decide({ dishName: "Garlic Lemon Shrimp", section: "Elevate Your Plate" });
    assert.equal(shrimp.isSide, true);
  });

  test("a real entree mis-sectioned under an add-on heading stays a meal", () => {
    // JOEY's steaks land under "Elevate Your Plate" once the menu is flattened
    // to text. Their dish type keeps them meals, not sides.
    const steak = decide({ dishName: "JOEY Classic Steak", section: "ELEVATE YOUR PLATE" });
    assert.equal(steak.includedInV1, true);
    assert.equal(steak.isSide, false);

    const frites = decide({ dishName: "Steak Frites", section: "Elevate Your Plate" });
    assert.equal(frites.isSide, false);
  });

  test("an ordinary entree is not a side", () => {
    assert.equal(decide({ dishName: "Baja Chicken Bowl", section: "Bowls" }).isSide, false);
    assert.equal(decide({ dishName: "Steak Plate", section: "Plates" }).isSide, false);
  });

  test("isKnownSectionName recognizes both included and excluded headings", () => {
    for (const heading of ["BOWLS", "Drinks", "Sides", "Entrees", "Kids Menu"]) {
      assert.ok(isKnownSectionName(heading), `${heading} should be a known section`);
    }
    assert.ok(!isKnownSectionName("Baja Chicken Bowl"));
  });
});
