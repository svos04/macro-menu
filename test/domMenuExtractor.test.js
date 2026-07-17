// test/domMenuExtractor.test.js
//
// The blocks under test are the ones content/pageSnapshot.js actually returned
// from sweetgreen.com and panerabread.com, pasted verbatim.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { extractDomItems } from "../services/ingestion/domMenuExtractor.js";

/** One raw block, as the page walker emits it. */
const picnicBowl = {
  name: "Picnic Bowl",
  description:
    "Antibiotic-free blackened chicken, golden quinoa, summer vegetable medley, corn salsa",
  section: "Summer Menu",
  text:
    "Picnic Bowl Antibiotic-free blackened chicken, golden quinoa, summer vegetable medley, " +
    "corn salsa Contains meat, milk, eggs, wheat 580 Calories 29G Protein 39G Carbs 32G Fat"
};

describe("extractDomItems: a footnote marker is punctuation, not a name", () => {
  // Menus hang an asterisk off any dish carrying the raw/undercooked disclaimer.
  // joeyrestaurants.com renders the dish as "Grilled Chicken Club*".
  test("strips a trailing asterisk from the dish name", () => {
    const [item] = extractDomItems([
      {
        name: "Grilled Chicken Club*",
        description: "spicy mayo, aged cheddar, smoky bacon",
        section: "handhelds",
        text: "Grilled Chicken Club* spicy mayo, aged cheddar, smoky bacon 26.75"
      }
    ]);
    assert.equal(item.dishName, "Grilled Chicken Club");
    assert.equal(item.description, "spicy mayo, aged cheddar, smoky bacon");
  });
});

describe("extractDomItems: the fields the DOM already knows", () => {
  test("keeps name, description and section without inferring them", () => {
    const [item] = extractDomItems([picnicBowl]);
    assert.equal(item.dishName, "Picnic Bowl");
    assert.equal(item.section, "Summer Menu");
    assert.match(item.description, /^Antibiotic-free blackened chicken/);
  });

  test("attaches the restaurant's own macros when the card publishes them", () => {
    const [item] = extractDomItems([picnicBowl]);
    assert.deepEqual(item.publishedMacros, {
      calories: 580,
      protein_g: 29,
      carbs_g: 39,
      fat_g: 32
    });
  });

  test("leaves publishedMacros off a card that publishes none", () => {
    const [item] = extractDomItems([
      { name: "Steak Frites", description: "Hanger steak, fries", section: "Mains", text: "Steak Frites Hanger steak, fries $28" }
    ]);
    assert.equal("publishedMacros" in item, false);
    assert.equal(item.price, 28);
  });

  test("scores parse confidence, so the DOM path speaks the same scale as the parser", () => {
    const [item] = extractDomItems([picnicBowl]);
    assert.ok(item.parseConfidence > 0 && item.parseConfidence <= 1);
  });
});

describe("extractDomItems: prices", () => {
  test("a price trailing the name is split off it", () => {
    const [item] = extractDomItems([{ name: "Baja Chicken Bowl 15.95", text: "Baja Chicken Bowl 15.95" }]);
    assert.equal(item.dishName, "Baja Chicken Bowl");
    assert.equal(item.price, 15.95);
  });

  test("a price elsewhere on the card is still found", () => {
    const [item] = extractDomItems([{ name: "Baja Chicken Bowl", text: "Baja Chicken Bowl Grilled chicken $15.95" }]);
    assert.equal(item.dishName, "Baja Chicken Bowl");
    assert.equal(item.price, 15.95);
  });

  test("a card with no price simply has none", () => {
    const [item] = extractDomItems([picnicBowl]);
    assert.equal("price" in item, false);
  });
});

describe("extractDomItems: rejects what is not a dish", () => {
  test("an allergen line is not a description", () => {
    // "Contains milk, wheat, tree nuts" enumerates like a description and sits
    // exactly where one goes. Handing it to the ingredient detector puts milk
    // and nuts into a dish that contains neither.
    const [item] = extractDomItems([
      {
        name: "Peach Salad",
        description: "Contains milk, wheat, tree nuts, soybeans",
        text: "Peach Salad Contains milk, wheat, tree nuts, soybeans"
      }
    ]);
    assert.equal(item.description, undefined);
  });

  test("a nutrition label is not a dish name", () => {
    assert.deepEqual(extractDomItems([{ name: "Calories", text: "445 Calories 17G Protein" }]), []);
  });

  test("a sentence is not a dish name", () => {
    assert.deepEqual(
      extractDomItems([{ name: "We source the best ingredients from farmers.", text: "..." }]),
      []
    );
  });

  test("an empty or non-string name yields no item", () => {
    assert.deepEqual(extractDomItems([{ name: "", text: "x" }, { name: null, text: "x" }, {}]), []);
  });

  test("the same dish rendered twice is ranked once", () => {
    // A "featured" carousel above the list the dish also appears in, or a
    // mobile layout rendered alongside a desktop one.
    const items = extractDomItems([picnicBowl, { ...picnicBowl }]);
    assert.equal(items.length, 1);
  });

  test("two different dishes are both kept", () => {
    const items = extractDomItems([picnicBowl, { ...picnicBowl, name: "Harvest Bowl" }]);
    assert.equal(items.length, 2);
  });
});

describe("extractDomItems: untrusted input", () => {
  test("a non-array is not an error", () => {
    assert.deepEqual(extractDomItems(undefined), []);
    assert.deepEqual(extractDomItems(null), []);
    assert.deepEqual(extractDomItems("Picnic Bowl"), []);
  });

  test("hostile field types are coerced, never thrown on", () => {
    assert.doesNotThrow(() =>
      extractDomItems([{ name: 42, description: {}, section: [], text: null }])
    );
  });

  test("an absurdly long name is clipped rather than trusted", () => {
    const [item] = extractDomItems([{ name: `Bowl ${"x".repeat(500)}`, text: "Bowl" }]);
    // Clipped to <= 90 chars, and then rejected as a name because it is one
    // enormous word. Either way, nothing 500 characters long reaches the UI.
    assert.ok(item === undefined || item.dishName.length <= 90);
  });
});
