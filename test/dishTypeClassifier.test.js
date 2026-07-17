// test/dishTypeClassifier.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyDishType } from "../services/nutrition/dishTypeClassifier.js";

const typeOf = (dishName, extra = {}) => classifyDishType({ dishName, ...extra }).dishType;

describe("dishTypeClassifier", () => {
  test("classifies the canonical examples", () => {
    const cases = [
      ["Chicken Bowl", "bowl"],
      ["Salmon Caesar Salad", "salad_with_protein"],
      ["Turkey Club", "sandwich"],
      ["Vegan Banh Mi", "sandwich"],
      ["Cheeseburger", "burger"],
      ["Chicken Wrap", "wrap"],
      ["Chicken Alfredo", "pasta"],
      ["Steak Plate", "plate"],
      ["Alaskan Halibut", "plate"],
      ["Pan Seared Scottish Salmon", "plate"],
      ["Baby Back Pork Ribs", "plate"],
      ["Tacos", "taco"]
    ];
    for (const [name, expected] of cases) {
      assert.equal(typeOf(name), expected, `${name} should be ${expected}`);
    }
  });

  test("\"cheeseburger\" is a burger even though \\b hides the word", () => {
    assert.equal(typeOf("Classic Cheeseburger"), "burger");
    assert.equal(typeOf("Bacon Burger"), "burger");
  });

  test("rule order resolves dishes that match two keywords", () => {
    // Burger outranks bowl; pasta outranks the generic plate rule.
    assert.equal(typeOf("Burger Bowl"), "burger");
    assert.equal(typeOf("Chicken Alfredo Plate"), "pasta");
    // A salad is a salad even when it is served in a bowl.
    assert.equal(typeOf("Caesar Salad Bowl"), "salad_with_protein");
  });

  test("falls back to the description, then the section", () => {
    assert.equal(
      classifyDishType({ dishName: "The Baja", description: "A rice bowl with chicken" }).matchedOn,
      "description"
    );
    const bySection = classifyDishType({ dishName: "The Baja", section: "Bowls" });
    assert.equal(bySection.dishType, "bowl");
    assert.equal(bySection.matchedOn, "section");
  });

  test("returns unknown when no rule matches", () => {
    assert.equal(typeOf("Chef's Special"), "unknown");
    assert.equal(typeOf("The Usual"), "unknown");
  });

  test("sectionSupportsDishType only counts when the name decided the type", () => {
    const agreeing = classifyDishType({ dishName: "Baja Chicken Bowl", section: "Bowls" });
    assert.equal(agreeing.sectionSupportsDishType, true);

    // The section alone cannot corroborate itself.
    const sectionOnly = classifyDishType({ dishName: "The Baja", section: "Bowls" });
    assert.equal(sectionOnly.sectionSupportsDishType, false);

    const disagreeing = classifyDishType({ dishName: "Turkey Club", section: "Bowls" });
    assert.equal(disagreeing.sectionSupportsDishType, false);
  });
});
