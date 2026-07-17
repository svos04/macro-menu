// test/menuParser.test.js
// Run with: npm test   (node --test, no dependencies)
//
// Like test/scoring.test.js, these lean on invariants. Exact numbers appear
// only where the number IS the requirement (a price is 15.95 or the parse is
// wrong) — never for confidence, which is a tuning decision.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseMenuText } from "../services/ingestion/menuParser.js";
import {
  isPriceOnly,
  normalizeMenuText,
  splitTrailingPrice
} from "../services/ingestion/textNormalizer.js";
import { FIXTURE_MENU_TEXT } from "./fixtures/pdfFixtures.js";

const byName = (items, name) => items.find((i) => i.dishName === name);

describe("textNormalizer", () => {
  test("preserves blank lines as item separators", () => {
    const { lines } = normalizeMenuText("A\n\n\n\nB");
    assert.deepEqual(lines, ["A", "", "B"]);
  });

  test("collapses dot leaders and normalizes price spacing", () => {
    const { lines } = normalizeMenuText("Baja Chicken Bowl.......$ 15.95");
    assert.equal(lines[0], "Baja Chicken Bowl $15.95");
  });

  test("collapses spaced PDF dot leaders before a trailing price", () => {
    const { lines } = normalizeMenuText("Alaskan Halibut . . . . . . . . 45");
    assert.equal(lines[0], "Alaskan Halibut 45");
  });

  test("drops legal boilerplate", () => {
    const { lines } = normalizeMenuText(
      "Steak Plate 22.00\nConsuming raw or undercooked meats may increase your risk."
    );
    assert.deepEqual(lines, ["Steak Plate 22.00"]);
  });

  test("a bare integer is a price only when it is plausibly one", () => {
    assert.equal(splitTrailingPrice("Steak $28").price, 28);
    assert.equal(splitTrailingPrice("Chicken Bowl 15.95").price, 15.95);
    // A piece count, not a price.
    assert.equal(splitTrailingPrice("Tacos 3").price, null);
    // A weight in the middle of a name.
    assert.equal(splitTrailingPrice("6 oz Sirloin").price, null);
  });

  test("a two-price line takes the first (lunch) price", () => {
    assert.equal(splitTrailingPrice("Salad 12.95 / 16.95").price, 12.95);
  });

  test("isPriceOnly recognizes a standalone price line", () => {
    assert.ok(isPriceOnly("$15.95"));
    assert.ok(isPriceOnly("15.95"));
    assert.ok(!isPriceOnly("Baja Chicken Bowl 15.95"));
  });
});

describe("menuParser: sections, names, descriptions, prices", () => {
  test("parses the fixture menu block", () => {
    const items = parseMenuText(FIXTURE_MENU_TEXT);
    assert.equal(items.length, 4);

    const bowl = byName(items, "Baja Chicken Bowl");
    assert.equal(bowl.section, "BOWLS");
    assert.equal(bowl.price, 15.95);
    assert.match(bowl.description, /^Grilled chicken, brown rice/);

    assert.equal(byName(items, "French Fries").section, "SIDES");
    assert.equal(byName(items, "House Lemonade").section, "DRINKS");
  });

  test("handles a price on the line below the dish name", () => {
    const items = parseMenuText(
      "Bowls\n\nBaja Chicken Bowl\n$15.95\nGrilled chicken, brown rice, black beans"
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].dishName, "Baja Chicken Bowl");
    assert.equal(items[0].price, 15.95);
    assert.match(items[0].description, /brown rice/);
  });

  test("an all-caps dish name above a price line is not read as a section", () => {
    const items = parseMenuText("BAJA CHICKEN BOWL\n$15.95\nGrilled chicken, brown rice");
    assert.equal(items.length, 1);
    assert.equal(items[0].dishName, "BAJA CHICKEN BOWL");
    assert.equal(items[0].section, undefined);
  });

  test("an all-caps dish name above a priced description is not read as a section", () => {
    const items = parseMenuText(
      [
        "ALASKAN HALIBUT",
        "macadamia crust, pineapple beurre blanc, sautéed spinach, whipped potatoes . . . . 45"
      ].join("\n")
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].dishName, "ALASKAN HALIBUT");
    assert.equal(items[0].price, 45);
    assert.match(items[0].description, /macadamia crust/);
  });

  test("in an all-caps document only known section names are headings", () => {
    const items = parseMenuText(
      ["BOWLS", "BAJA CHICKEN BOWL 15.95", "GRILLED CHICKEN, BROWN RICE, BLACK BEANS", "STEAK PLATE 22.00", "SEARED STEAK, WHITE RICE, BROCCOLI"].join("\n")
    );
    assert.equal(items.length, 2);
    assert.equal(items[0].section, "BOWLS");
    assert.equal(items[1].section, "BOWLS");
  });

  test("a following dish name is not swallowed as a description", () => {
    const items = parseMenuText("Turkey Club\nSliced turkey, bacon, lettuce\nCheeseburger\nBeef patty, cheddar");
    assert.equal(items.length, 2);
    assert.equal(items[0].description, "Sliced turkey, bacon, lettuce");
    assert.equal(items[1].dishName, "Cheeseburger");
  });

  test("no description and no price still parses a dish name", () => {
    const items = parseMenuText("Entrees\n\nSteak Plate");
    assert.equal(items.length, 1);
    assert.equal(items[0].dishName, "Steak Plate");
    assert.equal(items[0].description, undefined);
    assert.equal(items[0].price, undefined);
  });
});

// Found by running the parser over real restaurant PDFs, where descriptions
// wrap across lines and the price sits at the end of the last one.
describe("menuParser: lessons from real menus", () => {
  test("a wrapped description ending in a price is not a second dish", () => {
    const items = parseMenuText(
      [
        "Salads",
        "Small Garden Salad",
        "Crisp iceberg lettuce, provolone cheese, pepperoni, black olives,",
        "tomato, carrots, pepperoncini, and croutons. $5.75"
      ].join("\n")
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].dishName, "Small Garden Salad");
    assert.equal(items[0].price, 5.75);
    assert.match(items[0].description, /croutons/);
  });

  test("title case separates dish names from prose", () => {
    const items = parseMenuText(
      ["Salads", "All salads include garlic bread and choice of dressing.", "Caesar Salad 10.00"].join("\n")
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].dishName, "Caesar Salad");
  });

  test("a size row is not a dish", () => {
    const items = parseMenuText(['Pizza', 'Small 10"  Medium 12"  Extra Large 16"', "Margherita 26.75"].join("\n"));
    assert.deepEqual(items.map((i) => i.dishName), ["Margherita"]);
  });

  test("a parenthetical price annotation attaches to the dish above it", () => {
    const items = parseMenuText(["Appetizers", "Mozzarella Sticks", "(8) $9.85"].join("\n"));
    assert.equal(items.length, 1);
    assert.equal(items[0].dishName, "Mozzarella Sticks");
    assert.equal(items[0].price, 9.85);
  });

  test("marketing copy never becomes a dish", () => {
    // "Join our Rewards Club" is title-cased, four words, and reads as a
    // sandwich to the dish classifier because of \bclub\b.
    const items = parseMenuText(
      [
        "Join our Rewards Club",
        "Get 10% off your bill",
        "Scan the QR code to join.",
        "@fratellinos_Italian",
        "WWW.FRATELLINOS.COM",
        "Bowls",
        "Baja Chicken Bowl 15.95"
      ].join("\n")
    );
    assert.deepEqual(items.map((i) => i.dishName), ["Baja Chicken Bowl"]);
  });

  test("menu category labels are headings, not meals", () => {
    const items = parseMenuText(
      [
        "Limited Time",
        "Hot Honey Peach & Prosciutto Sandwich",
        "prosciutto, peach chutney, mozzarella, arugula, hot honey",
        "Deli Sides & Soups",
        "Tomato Basil Soup",
        "tomatoes, basil, cream"
      ].join("\n")
    );

    assert.deepEqual(items.map((i) => i.dishName), [
      "Hot Honey Peach & Prosciutto Sandwich",
      "Tomato Basil Soup"
    ]);
    assert.equal(items[0].section, "Limited Time");
    assert.equal(items[1].section, "Deli Sides & Soups");
  });

  test("consecutive product-name lines are separate meal titles", () => {
    const items = parseMenuText(
      [
        "Chicken Pesto Caprese",
        "",
        "Not So Fried Chicken Sandwich",
        "",
        "Vegan Banh Mi"
      ].join("\n")
    );

    assert.deepEqual(items.map((i) => i.dishName), [
      "Chicken Pesto Caprese",
      "Not So Fried Chicken Sandwich",
      "Vegan Banh Mi"
    ]);
  });
});

describe("menuParser: parse confidence", () => {
  test("a fully structured item scores higher than a bare name", () => {
    const [full] = parseMenuText("Bowls\n\nBaja Chicken Bowl 15.95\nGrilled chicken, brown rice, beans");
    const [bare] = parseMenuText("Baja Chicken Bowl");
    assert.ok(full.parseConfidence > bare.parseConfidence);
  });

  test("confidence never claims certainty, even with every signal present", () => {
    const [full] = parseMenuText("Bowls\n\nBaja Chicken Bowl 15.95\nGrilled chicken, brown rice, beans");
    assert.ok(full.parseConfidence >= 0.8, `expected >= 0.8, got ${full.parseConfidence}`);
    assert.ok(full.parseConfidence < 1, "a regex over a stranger's page is never certain");
  });

  test("every parsed item's confidence sits in 0..1", () => {
    for (const item of parseMenuText(FIXTURE_MENU_TEXT)) {
      assert.ok(item.parseConfidence >= 0 && item.parseConfidence <= 1);
    }
  });
});
