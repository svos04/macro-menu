// test/pageSnapshot.test.js
//
// One job: prove the injected snapshot function survives being torn out of its
// module. Everything else about it needs a real DOM and is verified in a
// browser; this needs no DOM at all, and it is the test that would have caught
// the bug that made the extension unable to read a single page.
//
// chrome.scripting.executeScript({ func }) does exactly this: takes the
// function's source, and rebuilds it somewhere its module scope does not exist.
// `new Function` reproduces that faithfully — its body is compiled in global
// scope, so a reference to any module-level helper throws ReferenceError, just
// as it did in the page. Chrome then resolves with `result: undefined` and the
// failure surfaces as "no menu found" rather than as an error.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { snapshotRenderedPage } from "../content/pageSnapshot.js";

/** The three page globals the function is allowed to reach for. */
function pageGlobals() {
  return {
    document: {
      title: "Test Restaurant",
      body: {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    location: { href: "https://example.com/menu" },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" })
  };
}

/**
 * Run the function the way Chrome runs it: source only, no closure, no imports.
 * The body is compiled in global scope, so the only names in scope are the
 * parameters below and the JS builtins.
 */
function runDetached(globals) {
  const call = new Function(
    "document",
    "location",
    "getComputedStyle",
    `return (${snapshotRenderedPage.toString()})();`
  );
  return call(globals.document, globals.location, globals.getComputedStyle);
}

describe("snapshotRenderedPage: survives serialization", () => {
  test("references no identifier outside itself", () => {
    // A ReferenceError here means a helper leaked into module scope. In Chrome
    // that is silent: the injection resolves with `result: undefined`, and the
    // side panel reports "I could not read this page" on every site.
    assert.doesNotThrow(() => runDetached(pageGlobals()));
  });

  test("returns the snapshot contract on an empty page", () => {
    const snapshot = runDetached(pageGlobals());

    assert.deepEqual(snapshot.items, []);
    assert.equal(snapshot.text, "");
    assert.equal(snapshot.url, "https://example.com/menu");
    assert.equal(snapshot.title, "Test Restaurant");
    assert.equal(snapshot.inaccessibleIframeCount, 0);
  });

  test("reaches for no page global beyond document, location and getComputedStyle", () => {
    // Anything else — `window`, `chrome`, `fetch` — is either unavailable in an
    // isolated world or a permission we have not asked for.
    const call = new Function(
      "document",
      "location",
      "getComputedStyle",
      `"use strict"; return (${snapshotRenderedPage.toString()})();`
    );
    const globals = pageGlobals();
    assert.doesNotThrow(() => call(globals.document, globals.location, globals.getComputedStyle));
  });

  test("the source carries no import or export statement", () => {
    // Either one would be a syntax error once the function is re-parsed alone.
    const source = snapshotRenderedPage.toString();
    assert.ok(!/\bimport\b/.test(source));
    assert.ok(!/\bexport\b/.test(source));
  });
});
