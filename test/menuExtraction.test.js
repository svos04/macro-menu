// test/menuExtraction.test.js
// End-to-end tests for the four accepted inputs, plus the handoff to the
// existing ranking engine.
//
// No test touches the network. `fetch` is injected, which is the whole reason
// menuExtractionService takes it as a parameter.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  extractMenu,
  toRankableMeals,
  ESTIMATED_SOURCE_LABEL,
  PUBLISHED_SOURCE_LABEL
} from "../services/menuExtractionService.js";
import { extractHtml, isLikelyMenuPage } from "../services/ingestion/htmlExtractor.js";
import { rankMeals } from "../services/scoringService.js";
import { MIN_MACRO_CONFIDENCE } from "../services/confidenceScoring.js";
import { ESTIMATION_WARNING, PUBLISHED_MACRO_CONFIDENCE } from "../types/menu.js";
import {
  buildImageOnlyPdf,
  buildTextPdf,
  FIXTURE_MENU_TEXT,
  FIXTURE_MENU_LINES_LONG
} from "./fixtures/pdfFixtures.js";

const MENU_LINES = FIXTURE_MENU_LINES_LONG;

const MENU_HTML = `<!doctype html><html><head><title>The Corner Kitchen | Menu</title>
<style>.x{color:red}</style><script>var s = "</div>";</script></head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <div class="cookie-consent">We use cookies.</div>
  <main>
    <h2>Bowls</h2>
    <div class="item"><span class="name">Baja Chicken Bowl</span><span class="price">$15.95</span>
      <p>Grilled chicken, brown rice, black beans, avocado, pico de gallo, chipotle crema</p></div>
    <div class="item"><h3>Crispy Chicken Sandwich</h3><span>$14.50</span>
      <p>Fried chicken, brioche bun, slaw, pickles &amp; spicy aioli</p></div>
    <h2>Drinks</h2>
    <div class="item"><span>House Lemonade</span><span>$4.00</span></div>
  </main>
  <footer>© 2024 Corner Kitchen. All rights reserved.</footer>
</body></html>`;

/** A page that shows nothing but a link to its real, PDF menu. */
const PDF_LINK_HTML = `<!doctype html><html><head><title>Corner Kitchen</title></head>
<body><main><h1>Menu</h1><a href="/files/dinner.pdf">Download Menu</a></main></body></html>`;

/**
 * The shape Fratellino's "printable menus" page actually takes: plenty of prose,
 * zero dishes, and the real menu behind a PDF link. A "page has little text"
 * heuristic never fires here; "the page produced no entrees" does.
 */
const WORDY_PDF_LINK_HTML = `<!doctype html><html><head><title>Fratellino's</title></head>
<body><main>
  <h1>Printable Menus</h1>
  <p>Welcome to our family restaurant, serving the neighborhood since 2000. We are
  proud to offer authentic Italian cooking made from recipes handed down through
  three generations, using only the freshest ingredients available each morning.</p>
  <p>Our dining room seats ninety guests and is available for private events,
  rehearsal dinners, and birthday celebrations of every size. Call ahead to reserve.</p>
  <a href="/uploads/Dinner2026.pdf">Download</a>
</main></body></html>`;

function stubFetch(routes) {
  return async (url) => {
    const body = routes[url];
    if (!body) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return {
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
  };
}

const names = (items) => items.map((i) => i.dishName);

describe("extractMenu: raw text", () => {
  test("produces the expected included and excluded items", async () => {
    const result = await extractMenu({ text: FIXTURE_MENU_TEXT });

    assert.equal(result.sourceType, "raw_text");
    assert.deepEqual(names(result.items), ["Baja Chicken Bowl", "Crispy Chicken Sandwich"]);
    assert.deepEqual(names(result.excludedItems), ["French Fries", "House Lemonade"]);
  });

  test("every excluded item explains why", () => {
    return extractMenu({ text: FIXTURE_MENU_TEXT }).then((result) => {
      for (const item of result.excludedItems) {
        assert.equal(item.includedInV1, false);
        assert.ok(item.exclusionReason, `${item.dishName} needs a reason`);
      }
    });
  });

  test("all macros are marked estimated, never verified", async () => {
    const result = await extractMenu({ text: FIXTURE_MENU_TEXT });
    assert.ok(result.warnings.includes(ESTIMATION_WARNING));
    for (const item of result.items) {
      assert.equal(item.macroSource, "estimated_common_assumptions");
      assert.ok(item.assumptions.length > 0);
    }
  });

  test("the grilled bowl is a higher-quality protein source than the fried sandwich", async () => {
    const [bowl, sandwich] = (await extractMenu({ text: FIXTURE_MENU_TEXT })).items;
    const density = (i) => i.estimatedMacros.protein_g / i.estimatedMacros.calories;
    assert.ok(density(bowl) > density(sandwich));
  });

  test("carries the restaurant name through when given one", async () => {
    const result = await extractMenu({ text: FIXTURE_MENU_TEXT, restaurantName: "Example Restaurant" });
    assert.equal(result.restaurantName, "Example Restaurant");
  });
});

describe("extractMenu: HTML", () => {
  test("extracts items from a page and ignores nav, footer and cookie banners", async () => {
    const result = await extractMenu({ html: MENU_HTML, url: "https://corner.example/menu" });

    assert.equal(result.sourceType, "html");
    assert.deepEqual(names(result.items), ["Baja Chicken Bowl", "Crispy Chicken Sandwich"]);
    assert.deepEqual(names(result.excludedItems), ["House Lemonade"]);
    assert.equal(result.sourceUrl, "https://corner.example/menu");
  });

  test("preserves the section, description and price relationships", async () => {
    const result = await extractMenu({ html: MENU_HTML });
    const bowl = result.items[0];
    assert.equal(bowl.section, "Bowls");
    assert.equal(bowl.price, 15.95);
    assert.match(bowl.description, /brown rice/);
    assert.equal(bowl.dishType, "bowl");
  });

  test("guesses the restaurant name from the page title", async () => {
    const result = await extractMenu({ html: MENU_HTML });
    assert.equal(result.restaurantName, "The Corner Kitchen");
  });

  test("adjacent inline spans do not glue the name to the price", () => {
    const { text } = extractHtml(MENU_HTML);
    assert.match(text, /Baja Chicken Bowl \$15\.95/);
    assert.ok(!text.includes("<!doctype"));
  });

  test("script and style content never reaches the parser", () => {
    const { text } = extractHtml(MENU_HTML);
    assert.ok(!text.includes("var s"));
    assert.ok(!text.includes("color:red"));
    assert.ok(!text.includes("We use cookies"));
    assert.ok(!text.includes("All rights reserved"));
  });

  test("isLikelyMenuPage recognizes a menu page", () => {
    assert.ok(isLikelyMenuPage(MENU_HTML));
    assert.ok(!isLikelyMenuPage("<html><body><p>About us</p></body></html>"));
  });
});

describe("extractMenu: linked and direct PDFs", () => {
  test("follows a linked PDF when the page itself has no menu text", async () => {
    const pdf = await buildTextPdf(MENU_LINES);
    const result = await extractMenu({
      html: PDF_LINK_HTML,
      url: "https://corner.example/",
      fetch: stubFetch({ "https://corner.example/files/dinner.pdf": pdf })
    });

    assert.equal(result.sourceType, "pdf_text");
    assert.equal(result.sourceUrl, "https://corner.example/files/dinner.pdf");
    assert.ok(names(result.items).includes("Baja Chicken Bowl"));
  });

  test("follows a linked PDF when a text-rich page yields no entrees", async () => {
    const pdf = await buildTextPdf(MENU_LINES);
    const result = await extractMenu({
      html: WORDY_PDF_LINK_HTML,
      url: "https://fratellinos.example/printable-menus/",
      fetch: stubFetch({ "https://fratellinos.example/uploads/Dinner2026.pdf": pdf })
    });

    assert.equal(result.sourceType, "pdf_text");
    assert.equal(result.sourceUrl, "https://fratellinos.example/uploads/Dinner2026.pdf");
    assert.ok(names(result.items).includes("Baja Chicken Bowl"));
  });

  test("a page that already has entrees does not chase its PDF links", async () => {
    let fetched = false;
    await extractMenu({
      html: MENU_HTML.replace("</main>", '<a href="/menu.pdf">Download Menu</a></main>'),
      url: "https://corner.example/menu",
      fetch: async () => {
        fetched = true;
        return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
      }
    });
    assert.equal(fetched, false, "must not fetch a PDF when the page parsed fine");
  });

  test("warns instead of guessing when a linked PDF cannot be fetched", async () => {
    const result = await extractMenu({ html: PDF_LINK_HTML, url: "https://corner.example/" });
    assert.ok(result.warnings.some((w) => /links to a PDF menu/i.test(w)));
    assert.equal(result.items.length, 0);
  });

  test("reads a direct PDF URL", async () => {
    const pdf = await buildTextPdf(MENU_LINES);
    const result = await extractMenu({
      url: "https://corner.example/menu.pdf",
      fetch: stubFetch({ "https://corner.example/menu.pdf": pdf })
    });

    assert.equal(result.sourceType, "pdf_text");
    assert.ok(names(result.items).includes("Baja Chicken Bowl"));
    assert.ok(names(result.excludedItems).includes("French Fries"));
  });

  test("trusts magic bytes over the URL extension", async () => {
    // Served at a .pdf URL, but actually HTML.
    const result = await extractMenu({
      url: "https://corner.example/menu.pdf",
      fetch: stubFetch({ "https://corner.example/menu.pdf": MENU_HTML })
    });
    assert.equal(result.sourceType, "html");
    assert.ok(names(result.items).includes("Baja Chicken Bowl"));
  });

  test("extracts from PDF bytes handed in directly", async () => {
    const result = await extractMenu({ pdfBytes: await buildTextPdf(MENU_LINES) });
    assert.equal(result.sourceType, "pdf_text");
    assert.ok(names(result.items).includes("Steak Plate"));
  });

  test("does not parse garbage when a PDF needs OCR", async () => {
    const result = await extractMenu({ pdfBytes: buildImageOnlyPdf() });
    assert.equal(result.sourceType, "pdf_ocr_needed");
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.excludedItems, []);
  });

  test("a URL without a fetch implementation is a programming error, not a silent empty menu", async () => {
    await assert.rejects(() => extractMenu({ url: "https://corner.example/menu" }), /requires a `fetch`/);
  });
});

describe("extractMenu: a line's section is the heading above it", () => {
  test("an entree listed under DRINKS is excluded as a drink", async () => {
    // Sections carry forward until the next heading. This is what makes a menu
    // parseable at all, and it means heading order is load-bearing.
    const result = await extractMenu({
      text: "DRINKS\n\nHouse Lemonade 4.00\n\nSteak Plate 22.00\nGrilled sirloin, roasted potatoes"
    });
    assert.deepEqual(names(result.items), []);
    const steak = result.excludedItems.find((i) => i.dishName === "Steak Plate");
    assert.match(steak.exclusionReason, /drinks section/i);
  });

  test("the same entree above the DRINKS heading is included", async () => {
    const result = await extractMenu({
      text: "ENTREES\n\nSteak Plate 22.00\nGrilled sirloin, roasted potatoes\n\nDRINKS\n\nHouse Lemonade 4.00"
    });
    assert.deepEqual(names(result.items), ["Steak Plate"]);
  });
});

describe("extractMenu: the macro-confidence floor", () => {
  // A dish name with no description, no known dish type and no ingredients.
  // The generic plate template still yields macros; they describe the template,
  // not the dish.
  const OPAQUE_MENU = "Entrees\n\nSkate Grenobloise\n\nChef's Special\n\nBaja Chicken Bowl 15.95\nGrilled chicken, brown rice, black beans, avocado";

  test("items we cannot estimate are left out of the ranking", async () => {
    const result = await extractMenu({ text: OPAQUE_MENU });
    assert.deepEqual(names(result.items), ["Baja Chicken Bowl"]);
  });

  test("they are reported in excludedItems, never dropped silently", async () => {
    const result = await extractMenu({ text: OPAQUE_MENU });

    const skate = result.excludedItems.find((i) => i.dishName === "Skate Grenobloise");
    assert.ok(skate, "the suppressed item must still be reported");
    assert.equal(skate.includedInV1, false);
    assert.match(skate.exclusionReason, /not enough information to estimate macros/i);
    assert.match(skate.exclusionReason, /confidence 0\.\d\d/);

    assert.ok(result.warnings.some((w) => /too little information/i.test(w)));
  });

  test("every ranked item clears the floor", async () => {
    const result = await extractMenu({ text: OPAQUE_MENU });
    for (const item of result.items) {
      assert.ok(
        item.macroConfidence >= MIN_MACRO_CONFIDENCE,
        `${item.dishName} at ${item.macroConfidence}`
      );
    }
  });

  test("the floor is configurable, and 0 keeps every estimate", async () => {
    const kept = await extractMenu({ text: OPAQUE_MENU, minMacroConfidence: 0 });
    assert.ok(names(kept.items).includes("Skate Grenobloise"));
    assert.ok(!kept.warnings.some((w) => /too little information/i.test(w)));

    const strict = await extractMenu({ text: OPAQUE_MENU, minMacroConfidence: 0.9 });
    assert.deepEqual(strict.items, [], "nothing clears a floor above the ceiling");
  });

  test("the floor does not suppress a well-described dish", async () => {
    const result = await extractMenu({ text: FIXTURE_MENU_TEXT });
    assert.equal(result.items.length, 2);
    assert.ok(!result.warnings.some((w) => /too little information/i.test(w)));
  });
});

describe("extractMenu: degenerate input", () => {
  test("no source at all returns an empty result with a warning", async () => {
    const result = await extractMenu({});
    assert.deepEqual(result.items, []);
    assert.ok(result.warnings.some((w) => /no menu source/i.test(w)));
  });

  test("a page with no menu says so rather than inventing items", async () => {
    const result = await extractMenu({ html: "<html><body><p>Coming soon.</p></body></html>" });
    assert.deepEqual(result.items, []);
    assert.ok(result.warnings.some((w) => /no entree-like menu items/i.test(w)));
  });
});

describe("toRankableMeals: handoff to the ranking engine", () => {
  test("produces meals the existing scoringService can rank", async () => {
    const result = await extractMenu({ text: FIXTURE_MENU_TEXT });
    const meals = toRankableMeals(result);

    assert.equal(meals.length, 2);
    for (const meal of meals) {
      assert.equal(meal.category, "entree");
      assert.equal(meal.estimated, true);
      assert.match(meal.source, /estimated/i);
      assert.ok(["low", "medium", "high"].includes(meal.confidence));
      for (const key of ["calories", "protein_g", "carbs_g", "fat_g"]) {
        assert.equal(typeof meal[key], "number", `${meal.name}.${key}`);
      }
    }

    const ranked = rankMeals(meals, "cut");
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].name, "Baja Chicken Bowl");
    assert.ok(ranked[0].score > ranked[1].score);
    assert.ok(ranked[0].explanation.length > 0);
  });
});

// ---------------------------------------------------------------------------
// The rendered-DOM path
// ---------------------------------------------------------------------------
// These blocks are what content/pageSnapshot.js returned from sweetgreen.com.
// The macros in them are the restaurant's own, printed on its own page.

const DOM_ITEM_PUBLISHED = {
  name: "Picnic Bowl",
  description: "Antibiotic-free blackened chicken, golden quinoa, corn salsa",
  section: "Summer Menu",
  text:
    "Picnic Bowl Antibiotic-free blackened chicken, golden quinoa, corn salsa " +
    "580 Calories 29G Protein 39G Carbs 32G Fat"
};

const DOM_ITEM_ESTIMATED = {
  name: "Baja Chicken Bowl",
  description: "Grilled chicken, brown rice, black beans, pico de gallo",
  section: "Bowls",
  text: "Baja Chicken Bowl Grilled chicken, brown rice, black beans, pico de gallo $15.95"
};

describe("extractMenu: rendered DOM", () => {
  test("the DOM outranks the page's flat text", async () => {
    // The side panel sends both. The flat text is a fallback for when the
    // walker recognized nothing, never a competitor: re-inferring structure the
    // DOM already gave us is how "Picnic Bowl" became a section heading.
    const result = await extractMenu({
      domItems: [DOM_ITEM_PUBLISHED],
      text: "Summer Menu\nPICNIC BOWL\n\nAntibiotic-free blackened chicken\n\n580\nCALORIES"
    });

    assert.equal(result.sourceType, "dom");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].dishName, "Picnic Bowl");
  });

  test("published macros are used verbatim, not estimated", async () => {
    const result = await extractMenu({ domItems: [DOM_ITEM_PUBLISHED] });
    const [item] = result.items;

    assert.equal(item.macroSource, "restaurant_published");
    assert.deepEqual(item.estimatedMacros, {
      calories: 580,
      protein_g: 29,
      carbs_g: 39,
      fat_g: 32
    });
    assert.deepEqual(item.assumptions, [], "nothing was assumed, so nothing is claimed");
  });

  test("a result with nothing estimated carries no estimation warning", async () => {
    // Disclaiming the restaurant's own numbers would tell the user to distrust
    // the most trustworthy figures the product has.
    const result = await extractMenu({ domItems: [DOM_ITEM_PUBLISHED] });
    assert.ok(!result.warnings.includes(ESTIMATION_WARNING));
  });

  test("one estimated item is enough to warn about the whole result", async () => {
    const result = await extractMenu({
      domItems: [DOM_ITEM_PUBLISHED, DOM_ITEM_ESTIMATED]
    });

    assert.equal(result.items.length, 2);
    assert.ok(result.warnings.includes(ESTIMATION_WARNING));

    const sources = result.items.map((item) => item.macroSource);
    assert.deepEqual(sources, ["restaurant_published", "estimated_common_assumptions"]);
  });

  test("the confidence floor never suppresses a published item", async () => {
    // The floor exists to drop items we had too little information to GUESS at.
    // A bare name with no description and no ingredients would fall through it —
    // but there is nothing to guess when the restaurant printed the answer.
    const result = await extractMenu({
      domItems: [
        {
          name: "Skate Grenobloise",
          section: "Entrees",
          text: "Skate Grenobloise 610 Calories 44G Protein 12G Carbs 41G Fat"
        }
      ]
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.excludedItems.length, 0);
    assert.equal(result.items[0].macroConfidence, PUBLISHED_MACRO_CONFIDENCE);
  });

  test("the same item without published macros IS suppressed", async () => {
    // The mirror of the test above: it is the macros, not the DOM path, that
    // earn an item its place.
    const result = await extractMenu({
      domItems: [{ name: "Skate Grenobloise", section: "Entrees", text: "Skate Grenobloise" }]
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.excludedItems.length, 1);
    assert.match(result.excludedItems[0].exclusionReason, /not enough information/i);
  });

  test("section rules still exclude drinks and kids items", async () => {
    const result = await extractMenu({
      domItems: [
        DOM_ITEM_PUBLISHED,
        { name: "Olipop Lemon Lime Soda", section: "Drinks", text: "Olipop Lemon Lime Soda" },
        { name: "Ranchy Chicken + Rice", section: "Kids' Meals", text: "Ranchy Chicken + Rice" }
      ]
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].dishName, "Picnic Bowl");
    assert.equal(result.excludedItems.length, 2);
  });

  test("an item's own macros never leak into its output shape", async () => {
    const result = await extractMenu({ domItems: [DOM_ITEM_PUBLISHED] });
    assert.equal("publishedMacros" in result.items[0], false);
  });
});

describe("extractMenu: a published calorie count with no other macros", () => {
  // Chick-fil-A's menu page: "440 Cal per Sandwich" next to each item, with
  // protein/carbs/fat only on a separate nutrition page. Reported bug: the
  // Chicken Sandwich (actually 440 cal) and Spicy Chicken Sandwich (actually
  // 460 cal) both rendered at an identical, generic 350 calories.
  const CHICKEN_SANDWICH = {
    name: "Chick-fil-A Chicken Sandwich",
    description: "A boneless breast of chicken, pickles, on a toasted bun",
    section: "Sandwiches",
    text: "Chick-fil-A Chicken Sandwich A boneless breast of chicken, pickles, on a toasted bun 440 Cal per Sandwich"
  };
  const SPICY_CHICKEN_SANDWICH = {
    name: "Spicy Chicken Sandwich",
    description: "A spicy breast of chicken, pickles, on a toasted bun",
    section: "Sandwiches",
    text: "Spicy Chicken Sandwich A spicy breast of chicken, pickles, on a toasted bun 460 Cal per Sandwich"
  };

  test("the printed calorie count is used, not a generic estimate", async () => {
    const result = await extractMenu({ domItems: [CHICKEN_SANDWICH, SPICY_CHICKEN_SANDWICH] });
    const [chicken, spicy] = result.items;

    assert.equal(chicken.estimatedMacros.calories, 440);
    assert.equal(spicy.estimatedMacros.calories, 460);
  });

  test("two different sandwiches no longer collapse onto the same calorie count", async () => {
    const result = await extractMenu({ domItems: [CHICKEN_SANDWICH, SPICY_CHICKEN_SANDWICH] });
    const [chicken, spicy] = result.items;
    assert.notEqual(chicken.estimatedMacros.calories, spicy.estimatedMacros.calories);
  });

  test("the item is still labeled estimated, not restaurant-published", async () => {
    // Only calories is a known fact here; protein/carbs/fat are still guesses,
    // so this must not wear the "From the restaurant" label.
    const result = await extractMenu({ domItems: [CHICKEN_SANDWICH] });
    const [meal] = toRankableMeals(result);

    assert.equal(meal.source, ESTIMATED_SOURCE_LABEL);
    assert.equal(meal.estimated, true);
    assert.equal(result.items[0].calories === undefined, true, "calories lives on estimatedMacros");
  });

  test("publishedPartialMacros never leaks into the item's own shape", async () => {
    const result = await extractMenu({ domItems: [CHICKEN_SANDWICH] });
    assert.equal("publishedPartialMacros" in result.items[0], false);
  });
});

describe("extractMenu: a published protein count with no carbs or fat", () => {
  // True Food Kitchen's actual pattern: "(11g protein | 600 cal)" under each
  // salad, with no carbs or fat printed anywhere on the page. Reported bug:
  // the calorie anchor worked, but protein still came out as a generic guess
  // instead of the 11g the page actually states.
  const SEASONAL_MARKET_SALAD = {
    name: "Seasonal Market Salad",
    description:
      "honey roasted carrots, roasted cauliflower, organic mixed greens, pistachios, feta, medjool dates, creamy tahini apple cider vinaigrette",
    section: "Featured Salads",
    text:
      "Seasonal Market Salad honey roasted carrots, roasted cauliflower, organic mixed greens, " +
      "pistachios, feta, medjool dates, creamy tahini apple cider vinaigrette (11g protein | 600 cal) VEG GF"
  };

  test("both the calorie count and the protein count are used, not estimated", async () => {
    const result = await extractMenu({ domItems: [SEASONAL_MARKET_SALAD] });
    const [item] = result.items;

    assert.equal(item.estimatedMacros.calories, 600);
    assert.equal(item.estimatedMacros.protein_g, 11);
  });

  test("carbs and fat are still estimated, since the page never states them", async () => {
    const result = await extractMenu({ domItems: [SEASONAL_MARKET_SALAD] });
    const [item] = result.items;

    assert.ok(item.assumptions.length > 0, "carbs/fat still came from the template, so something was assumed");
    assert.ok(Number.isFinite(item.estimatedMacros.carbs_g));
    assert.ok(Number.isFinite(item.estimatedMacros.fat_g));
  });

  test("the item stays labeled estimated, not restaurant-published", async () => {
    const result = await extractMenu({ domItems: [SEASONAL_MARKET_SALAD] });
    const [meal] = toRankableMeals(result);
    assert.equal(meal.source, ESTIMATED_SOURCE_LABEL);
  });
});

describe("toRankableMeals: provenance reaches the card", () => {
  test("a published meal is labelled as the restaurant's, and is not an estimate", async () => {
    const result = await extractMenu({ domItems: [DOM_ITEM_PUBLISHED] });
    const [meal] = toRankableMeals(result);

    assert.equal(meal.source, PUBLISHED_SOURCE_LABEL);
    assert.equal(meal.estimated, false);
    assert.equal(meal.confidence, "high");
  });

  test("an estimated meal still says so", async () => {
    const result = await extractMenu({ domItems: [DOM_ITEM_ESTIMATED] });
    const [meal] = toRankableMeals(result);

    assert.equal(meal.source, ESTIMATED_SOURCE_LABEL);
    assert.equal(meal.estimated, true);
  });

  test("published meals rank on the restaurant's numbers", async () => {
    const result = await extractMenu({ domItems: [DOM_ITEM_PUBLISHED] });
    const [meal] = toRankableMeals(result);
    const [ranked] = rankMeals([meal], "cut");

    assert.equal(ranked.calories, 580);
    assert.equal(ranked.protein_g, 29);
    assert.ok(ranked.score > 0);
  });
});
