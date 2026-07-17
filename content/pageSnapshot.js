// content/pageSnapshot.js
// The function Chrome injects into the page to read a rendered menu.
//
// ---------------------------------------------------------------------------
// THIS FUNCTION MUST HAVE NO FREE VARIABLES. Read this before editing.
// ---------------------------------------------------------------------------
// chrome.scripting.executeScript({ func }) serializes `func` with toString()
// and rebuilds it inside the page. Nothing else travels with it: not imports,
// not module-scope helpers, not closed-over constants. A single reference to an
// identifier defined outside this function throws ReferenceError in the page,
// executeScript resolves with `result: undefined`, and the caller sees an empty
// snapshot rather than an error — which is exactly how this silently returned
// "I could not read this page" on every site.
//
// So every helper lives nested inside snapshotRenderedPage(), and the only
// identifiers it may reach for are page globals (document, location,
// getComputedStyle) and JS builtins.
//
// It is also DELIBERATELY DUMB. It does not parse macros, prices, or sections
// into numbers — it locates each menu item's element and returns that item's
// raw text. All interpretation happens in services/ingestion/domMenuExtractor.js,
// where it can import, be unit-tested, and be fixed without touching a function
// that can only be debugged through a browser.

/**
 * Walk the rendered DOM and return one raw block per menu item.
 *
 * @returns {{
 *   url: string,
 *   title: string,
 *   items: Array<{name: string, description: string, section: string, text: string}>,
 *   text: string,
 *   inaccessibleIframeCount: number
 * }}
 */
export function snapshotRenderedPage() {
  // A menu item's card. Below MIN it's a nav link; above MAX it's a whole
  // section that happens to carry an "item" class.
  const MIN_ITEM_TEXT = 20;
  const MAX_ITEM_TEXT = 2000;
  const MAX_ITEMS = 400;

  // Some sites (Tailwind-styled ones especially — every class is utility
  // spacing/color, nothing semantic) carry no useful class at all, but keep a
  // `data-testid` naming the component anyway: automated tests need a
  // selector that survives a padding change, so it tends to outlive exactly
  // the kind of restyle that breaks class-based matching.
  const ITEM_SELECTOR = [
    "[class*='menu-item' i]",
    "[class*='menuitem' i]",
    "[class*='item' i]",
    "[class*='product' i]",
    "[class*='dish' i]",
    "[class*='card' i]",
    "[data-testid*='menu-item' i]",
    "[data-testid*='item' i]",
    "[data-testid*='product' i]",
    "[data-testid*='dish' i]",
    "[data-testid*='card' i]",
    "article"
  ].join(",");

  const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";

  // Deliberately NOT `[class*='name' i]`. That matches "menu-item__stat-name",
  // the label on a nutrition figure, and turns "Calories" into a dish.
  //
  // `font-heading` / `heading` are here for Tailwind-built menus, which carry no
  // semantic class at all: joeyrestaurants.com renders a dish as
  //   <p class="flex items-baseline capitalize text-body font-heading">   <- name
  //   <p class="text-body first-letter:capitalize">                        <- description
  // Neither is an <h1>-<h6> and neither says "title", so findName() returned ""
  // for every dish, the whole card was discarded, and the page fell back to the
  // flat-text parser — which drops the description entirely (a blank line is its
  // end-of-item signal). That is how a chicken club lost its mayo, cheddar and
  // bacon and estimated 415 cal instead of 805. A font utility naming "heading"
  // is the page's own statement that this text is the title.
  const TITLE_SELECTOR = [
    "[class*='title' i]",
    "[class*='font-heading' i]",
    "[class*='heading' i]",
    "[class*='item-name' i]",
    "[class*='item_name' i]",
    "[class*='itemname' i]",
    "[class*='product-name' i]",
    "[class*='product_name' i]",
    "[class*='productname' i]",
    "[class*='dish-name' i]",
    "[class*='dish_name' i]",
    "[class*='dishname' i]"
  ].join(",");

  /** Nutrition labels. A dish is never called "Calories". */
  const MACRO_LABEL = /^(?:calories|calorie|kcals?|cals?|cal|protein|carbs?|carbohydrates?|fat|total fat)$/i;

  const DESCRIPTION_SELECTOR = [
    "[class*='description' i]",
    "[class*='ingredient' i]",
    "[class*='summary' i]",
    "[class*='detail' i]",
    "[class*='caption' i]"
  ].join(",");

  const CHROME_SELECTOR =
    "nav,header,footer,aside,[role='navigation'],[role='banner'],[role='contentinfo']";

  // Zero-width characters. `\s` does NOT match these (they are Cf, not Zs), so
  // they must be stripped explicitly: they are invisible in an editor and they
  // break \b word boundaries in every regex downstream.
  const ZERO_WIDTH = /[​‌‍﻿]/g;

  // --- text ---------------------------------------------------------------

  // textContent, NOT innerText.
  //
  // innerText returns text as CSS renders it, and restaurants love
  // `text-transform: uppercase`. On sweetgreen every dish name comes back
  // "PICNIC BOWL" through innerText and "Picnic Bowl" through textContent.
  // The uppercase form is both an ugly display name and a parser trap — a
  // short ALL-CAPS line is exactly what a menu section heading looks like.
  //
  // `\s` already folds NBSP and the en/em/thin-space family, so collapsing
  // whitespace afterwards is enough.
  //
  // NOT a bare `node.textContent` read, even though that's what the comment
  // above this used to justify. textContent concatenates every descendant
  // text node with NO separator, and a flexbox nutrition row built from
  // sibling spans — `<span>Calories</span><span>730</span>` — carries no
  // whitespace text node between them at all; the gap between them is a CSS
  // margin, not a character. Read that way, "Calories" and "730" glue into
  // "Calories730", which is not a number by any regex downstream (justsalad.com
  // does exactly this in its nutrition panel). Walking the tree and inserting
  // a space at every element boundary costs nothing when real whitespace is
  // already there — `\s+` below collapses the duplicate — and recovers the
  // boundary when it isn't.
  function flatText(node) {
    if (!node) return "";
    let out = "";
    const walk = (current) => {
      for (const child of current.childNodes) {
        if (child.nodeType === 3) {
          out += child.nodeValue;
        } else if (child.nodeType === 1) {
          out += " ";
          walk(child);
          out += " ";
        }
      }
    };
    walk(node);
    return out.replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
  }

  // innerText is the right call here: the raw-text fallback is a line-oriented
  // parser, and innerText is what turns block elements into newlines.
  function renderedText(node) {
    if (!node) return "";
    return (node.innerText || node.textContent || "")
      .replace(ZERO_WIDTH, "")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isVisible(node) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isPageChrome(node) {
    return Boolean(node.closest(CHROME_SELECTOR));
  }

  // --- item containers ----------------------------------------------------

  /**
   * An item container HOLDS a name; it is not itself a name.
   *
   * This distinction is the whole ballgame, because BEM class names defeat a
   * substring selector. sweetgreen's card is:
   *
   *   <article class="menu-item__container">      <- the item
   *     <h2  class="menu-item__title">            <- matches [class*='item']
   *     <div class="menu-item__description">      <- matches [class*='item']
   *     <ul  class="menu-item__stat-list">        <- matches [class*='item']
   *
   * Every child matches ITEM_SELECTOR too, so taking the innermost matches
   * alone shreds each dish into three fragments: a name with no macros, a
   * description with no name, and a nutrition list whose "name" is "Calories".
   * Requiring a name DESCENDANT keeps the article and rejects all three.
   */
  function holdsName(element) {
    return findName(element) !== "";
  }

  /**
   * Keep only the INNERMOST qualifying containers.
   *
   * A menu nests: <ul class="menu-list__item-list"> > <li class="menu-item"> >
   * <article class="menu-item__container">. All three hold a name, so a naive
   * querySelectorAll returns each dish three times over — that is where the old
   * snapshot's 32,000 characters of duplicated text came from. An element that
   * contains another qualifying container is a list, not an item.
   */
  function innermost(elements) {
    return elements.filter(
      (el) => !elements.some((other) => other !== el && el.contains(other))
    );
  }

  /**
   * How many distinct dish names live inside this element's subtree. Must
   * agree with findName() on what counts as a name — allowing commas for
   * real heading tags here too — or a comma-bearing dish name (justsalad.com's
   * "Tokyo Supergreens, Tofu") goes uncounted, and widenToOutermostSingleDish
   * happily climbs straight past that dish's own card into its neighbor's.
   */
  function nameCount(element) {
    const names = new Set();
    for (const node of element.querySelectorAll(HEADING_SELECTOR)) {
      const text = flatText(node);
      if (isNameLike(text, { allowComma: true })) names.add(text);
    }
    for (const node of element.querySelectorAll(TITLE_SELECTOR)) {
      const text = flatText(node);
      if (isNameLike(text)) names.add(text);
    }
    return names.size;
  }

  /**
   * `innermost` assumes exactly one ancestor level matches ITEM_SELECTOR per
   * dish. That breaks when a design system prefixes every level of a card
   * with the same word: justsalad.com wraps its heading in
   * `<div class="c-card-title">`, inside `<div class="c-card-bottom">`
   * (badge + description), inside `<div class="c-menu-card">` (those PLUS the
   * hover nutrition panel) — every one of those matches `[class*='card' i]`
   * and independently qualifies as its own raw candidate, holding the same
   * one dish name. Picking "the innermost" among them is picking whichever of
   * those levels happens to be smallest, which throws away whatever content
   * lives one level further out — the macros, most often.
   *
   * There is no threshold of "enough content" that fixes this, because
   * candidates form a staircase (30 chars, then 184, then 374, ...) and
   * `innermost` always keeps whichever one clears the bar first. The only
   * boundary that means anything is content, not size: climb from EVERY raw
   * candidate to the largest ancestor that still names exactly this one dish,
   * bounded by MAX_ITEM_TEXT — the same boundary that stops it from climbing
   * into the list. Multiple candidates for the same dish converge on the same
   * ancestor this way, so `innermost` runs again afterward just to dedupe.
   */
  function widenToOutermostSingleDish(element) {
    let node = element;
    for (let i = 0; i < 8; i += 1) {
      const parent = node.parentElement;
      if (!parent || parent === document.body) break;
      if (isPageChrome(parent)) break;
      if (!isVisible(parent)) break;
      if (flatText(parent).length > MAX_ITEM_TEXT) break;
      if (nameCount(parent) !== 1) break;
      node = parent;
    }
    return node;
  }

  /**
   * @param {string} text
   * @param {{allowComma?: boolean}} [options] justsalad.com names two of its
   *   own dishes "Tokyo Supergreens, Tofu" and "Tokyo Supergreens, Chicken" —
   *   a real name, comma and all. The comma rule below exists to stop a
   *   generic `title`-classed div or a decorative image's alt text from being
   *   mistaken for a name when it's actually a description or a badge; it
   *   should never overrule an actual `<h1>`–`<h6>` tag, which is the page's
   *   own, deliberate claim that this text is a heading. Callers set this
   *   true only for genuine heading elements — see findName() and nameCount().
   */
  function isNameLike(text, options) {
    if (!text || text.length < 3 || text.length > 90) return false;

    // A name contains at least one real word. "29G" and "1.06KG CO2E" are the
    // values inside a nutrition list, and they are otherwise short, capitalized
    // and comma-free — indistinguishable from a dish name without this.
    if (!/[A-Za-z]{3,}/.test(text)) return false;

    // Dish names are labels, not sentences, and they do not enumerate. Without
    // the comma rule, "Roasted chicken, cucumbers, hummus, tortilla chips" is a
    // perfectly good 6-word name.
    if (/[.!?]$/.test(text)) return false;
    if (!options?.allowComma && text.includes(",")) return false;

    if (MACRO_LABEL.test(text)) return false;
    return text.split(/\s+/).length <= 12;
  }

  /**
   * The dish's name, or "" if this element does not name a dish.
   *
   * A real heading outranks a `title`-ish class. Both are searched in document
   * order for the first text that reads like a name, because BEM hands us more
   * than one match: sweetgreen labels each nutrition figure with
   * `menu-item__stat-title`, so the first `[class*='title']` inside a stat list
   * is the word "Calories". Rejecting it here is what stops that list from
   * qualifying as an item in its own right and displacing the article above it.
   *
   * Every branch reads textContent, never innerText, so a dish stays "Picnic
   * Bowl" instead of the "PICNIC BOWL" that `text-transform: uppercase` renders.
   *
   * Last resort: the product photo's alt text. chilis.com styles its dish
   * name as a plain `<div>` with nothing but Tailwind spacing/color classes —
   * no heading tag, no class with "title" in it, nothing the two loops above
   * can find. The `<img>` right next to it still carries the name in `alt`,
   * because that is an accessibility requirement independent of how the text
   * beside it happens to be styled. Tried last, and only within a container
   * that already cleared every other bar, so a decorative icon elsewhere on
   * the page never gets mistaken for a dish.
   */
  function findName(container) {
    for (const node of container.querySelectorAll(HEADING_SELECTOR)) {
      const text = flatText(node);
      if (isNameLike(text, { allowComma: true })) return text;
    }
    for (const node of container.querySelectorAll(TITLE_SELECTOR)) {
      const text = flatText(node);
      if (isNameLike(text)) return text;
    }
    for (const img of container.querySelectorAll("img[alt]")) {
      const text = (img.getAttribute("alt") || "").replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
      if (isNameLike(text)) return text;
    }
    return "";
  }

  function findDescription(container, name) {
    for (const node of container.querySelectorAll(DESCRIPTION_SELECTOR)) {
      const text = flatText(node);
      if (text && text !== name && text.split(/\s+/).length >= 3) return text;
    }

    // Fall back to the longest comma-bearing line: a description enumerates.
    const lines = renderedText(container)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== name && line.includes(","))
      .filter((line) => line.split(/\s+/).length >= 3)
      .sort((a, b) => b.length - a.length);

    return lines[0] || "";
  }

  function isSectionLike(text) {
    return Boolean(text) && text.length <= 60 && text.split(/\s+/).length <= 6;
  }

  function headingTextOf(element) {
    if (/^H[1-6]$/.test(element.tagName)) {
      const text = flatText(element);
      return isSectionLike(text) ? text : "";
    }
    // A wrapper around a heading, e.g. <div class="menu-list__header"><h2>.
    // Only trust it when the wrapper holds nothing but that heading — otherwise
    // the heading belongs to a preceding menu item, not to a section.
    const nested = element.querySelector("h1,h2,h3,h4,h5,h6");
    if (!nested) return "";
    const nestedText = flatText(nested);
    if (flatText(element) !== nestedText) return "";
    return isSectionLike(nestedText) ? nestedText : "";
  }

  /**
   * The heading this item sits under — "Wraps", "Summer Menu".
   *
   * Walks up the tree, scanning backwards through earlier siblings at each
   * level. The first heading found above the item governs it. A sibling whose
   * own text is long is another menu item, not a heading.
   */
  function findSection(container) {
    let node = container;
    while (node && node !== document.body) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        const heading = headingTextOf(sibling);
        if (heading) return heading;
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }

  // --- assembly -----------------------------------------------------------

  const rawMatches = Array.from(document.querySelectorAll(ITEM_SELECTOR)).filter((el) => {
    if (isPageChrome(el)) return false;
    if (!holdsName(el)) return false;
    if (!isVisible(el)) return false;
    const length = flatText(el).length;
    return length >= MIN_ITEM_TEXT && length <= MAX_ITEM_TEXT;
  });

  // Widening sends every raw match for the same dish to the same outermost
  // ancestor — often the literal same DOM node several times over, which a
  // Set collapses but `innermost` alone would not (it only drops an element
  // for CONTAINING another survivor, and a node never contains itself).
  const containers = innermost([...new Set(rawMatches.map(widenToOutermostSingleDish))]);

  const items = [];
  for (const container of containers) {
    if (items.length >= MAX_ITEMS) break;
    const name = findName(container);
    if (!name) continue;

    items.push({
      name,
      description: findDescription(container, name),
      section: findSection(container),
      text: flatText(container)
    });
  }

  const main = document.querySelector("main");
  const bodyText = renderedText(main || document.body);

  const iframes = Array.from(document.querySelectorAll("iframe"));
  const iframeText = iframes
    .map((iframe) => {
      try {
        return renderedText(iframe.contentDocument && iframe.contentDocument.body);
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");

  const inaccessibleIframeCount = iframes.filter((iframe) => {
    try {
      return !iframe.contentDocument;
    } catch {
      return true;
    }
  }).length;

  return {
    url: location.href,
    title: document.title,
    items,
    text: [bodyText, iframeText].filter(Boolean).join("\n\n"),
    inaccessibleIframeCount
  };
}
