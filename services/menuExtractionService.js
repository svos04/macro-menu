// services/menuExtractionService.js
// The public entry point for menu extraction + macro estimation.
//
// Fully rule-based and deterministic: the same input always produces the same
// output. No LLM, no AI API, no external nutrition service. Every number comes
// from data/nutritionTable.js and every guess is listed in `assumptions`.
//
//   extractMenu()      accepts a URL, an HTML string, PDF bytes, or raw text
//   toRankableMeals()  adapts the result for scoringService.rankMeals()
//
// NETWORK ACCESS IS INJECTED, never assumed. Callers pass `fetch`; tests pass a
// stub. Nothing in this module reaches the network on its own, which is what
// keeps the test suite offline and the extension's permissions honest.

import {
  ESTIMATION_WARNING,
  MACRO_SOURCE_ESTIMATED,
  MACRO_SOURCE_PUBLISHED,
  PUBLISHED_MACRO_CONFIDENCE
} from "../types/menu.js";
import { detectSource, looksLikePdfBytes } from "./ingestion/detectSource.js";
import { extractHtml } from "./ingestion/htmlExtractor.js";
import { extractPdfText } from "./ingestion/pdfExtractor.js";
import { normalizeMenuText } from "./ingestion/textNormalizer.js";
import { parseMenuLines } from "./ingestion/menuParser.js";
import { extractDomItems } from "./ingestion/domMenuExtractor.js";
import { classifyInclusion } from "./ingestion/entreeFilter.js";
import { classifyDishType } from "./nutrition/dishTypeClassifier.js";
import { estimateMacros } from "./nutrition/macroEstimator.js";
import { confidenceLabel, MIN_MACRO_CONFIDENCE } from "./confidenceScoring.js";

export { isLikelyMenuPage } from "./ingestion/htmlExtractor.js";

/** Label attached to every estimated meal handed to the ranking engine. */
export const ESTIMATED_SOURCE_LABEL = "Estimated from common assumptions";

/** Label attached to a meal whose macros the restaurant printed itself. */
export const PUBLISHED_SOURCE_LABEL = "From the restaurant";

/**
 * @typedef {object} ExtractMenuInput
 * @property {Array<object>} [domItems] Blocks read off a rendered page by
 *   content/pageSnapshot.js. Preferred over every other source when present:
 *   the DOM knows which element is the dish name, so nothing has to be inferred.
 * @property {string} [url]        Page or PDF URL. Requires `fetch`.
 * @property {string} [html]       HTML string, if you already have it.
 * @property {Uint8Array} [pdfBytes]
 * @property {string} [text]       Raw pasted menu text.
 * @property {string} [restaurantName]
 * @property {typeof globalThis.fetch} [fetch]
 * @property {boolean} [followPdfLinks] Default true.
 * @property {number} [minMacroConfidence] Default MIN_MACRO_CONFIDENCE (0.3).
 *   Items below this are moved to `excludedItems` rather than ranked. Pass 0 to
 *   keep every estimate. Never applied to restaurant-published macros, which
 *   are not estimates.
 */

/**
 * @param {ExtractMenuInput} input
 * @returns {Promise<import("../types/menu.js").MenuExtractionResult>}
 */
export async function extractMenu(input = {}) {
  /** @type {string[]} */
  const warnings = [];
  const floor = input.minMacroConfidence ?? MIN_MACRO_CONFIDENCE;

  let source = await resolveSource(input, warnings);
  let parsed = buildItems(source, floor);

  // Scenario 2 from the spec: a restaurant site whose menu lives in a linked
  // PDF. "The page produced no entrees" is the signal to follow the link —
  // not "the page has little text", which fails on sites like Fratellino's,
  // whose /printable-menus page is full of navigation prose and nothing else.
  if (parsed.items.length === 0) {
    const followed = await followLinkedPdf(source, input, warnings);
    if (followed) {
      source = followed;
      parsed = buildItems(source, floor);
    }
  }

  // Only disclaim what was actually guessed. A page that publishes its own
  // macros for every dish has nothing estimated about it, and stamping the
  // estimation warning on those numbers would tell the user to distrust the
  // most trustworthy figures the product has.
  if (parsed.items.some((item) => item.macroSource === MACRO_SOURCE_ESTIMATED)) {
    warnings.unshift(ESTIMATION_WARNING);
  }

  if (parsed.suppressed > 0) {
    warnings.push(
      `${parsed.suppressed} item(s) were left out because there was too little ` +
        `information to estimate their macros.`
    );
  }

  if (parsed.items.length === 0 && source.sourceType !== "pdf_ocr_needed") {
    warnings.push("No entree-like menu items were found in this source.");
  }

  /** @type {import("../types/menu.js").MenuExtractionResult} */
  const result = {
    sourceType: source.sourceType,
    items: parsed.items,
    excludedItems: parsed.excludedItems,
    warnings
  };
  const name = input.restaurantName ?? source.restaurantName;
  if (name) result.restaurantName = name;
  if (source.sourceUrl) result.sourceUrl = source.sourceUrl;
  return result;
}

/**
 * Parse -> filter -> estimate. Pure; safe to run twice on different sources.
 *
 * Two gates, in order, and they answer different questions:
 *   classifyInclusion  "is this a meal?"        (a lemonade is not)
 *   confidence floor   "do we know what's in it?" (a "Chef's Special" is a meal,
 *                                                  but we cannot estimate it)
 */
function buildItems(source, minMacroConfidence) {
  if (source.sourceType === "pdf_ocr_needed") {
    return { items: [], excludedItems: [], suppressed: 0 };
  }

  const candidates = source.domItems
    ? extractDomItems(source.domItems)
    : parseMenuLines(normalizeMenuText(source.text).lines);

  const items = [];
  const excludedItems = [];
  let suppressed = 0;

  for (const candidate of candidates) {
    // `publishedMacros`/`publishedPartialMacros` ride on the candidate from
    // the DOM path only, and must not reach the output item — their numbers
    // live in `estimatedMacros`.
    const { publishedMacros, publishedPartialMacros, ...parsedCandidate } = candidate;

    const { dishType } = classifyDishType(parsedCandidate);
    const { includedInV1, exclusionReason, isSide } = classifyInclusion({ ...parsedCandidate, dishType });

    const parsed = {
      ...parsedCandidate,
      sourceType: source.sourceType,
      includedInV1,
      isSide: Boolean(isSide)
    };

    if (!includedInV1) {
      excludedItems.push({ ...parsed, exclusionReason });
      continue;
    }

    // The restaurant published its own numbers. Nothing to estimate, nothing to
    // assume, and no confidence floor to clear — that floor exists to suppress
    // items we had too little information to *guess* at.
    if (publishedMacros) {
      items.push({
        ...parsed,
        dishType,
        detectedIngredients: [],
        estimatedMacros: publishedMacros,
        macroSource: MACRO_SOURCE_PUBLISHED,
        macroConfidence: PUBLISHED_MACRO_CONFIDENCE,
        assumptions: []
      });
      continue;
    }

    const estimated = estimateMacros(parsedCandidate, { publishedMacros: publishedPartialMacros });

    if (estimated.macroConfidence < minMacroConfidence) {
      suppressed += 1;
      excludedItems.push({
        ...parsed,
        includedInV1: false,
        exclusionReason:
          `Not enough information to estimate macros ` +
          `(confidence ${estimated.macroConfidence.toFixed(2)}, minimum ${minMacroConfidence})`
      });
      continue;
    }

    items.push({ ...parsed, ...estimated });
  }

  return { items, excludedItems, suppressed };
}

/**
 * Fetch the first confidently-PDF link on the page and use it as the source.
 * @returns {Promise<object|null>} A replacement source, or null to keep the page.
 */
async function followLinkedPdf(source, input, warnings) {
  const link = source.pdfLinks?.find((candidate) => candidate.confident);
  if (!link) return null;

  if (input.followPdfLinks === false || typeof input.fetch !== "function") {
    warnings.push(`This page links to a PDF menu at ${link.href}, which was not fetched.`);
    return null;
  }

  const bytes = await fetchBytes(input.fetch, link.href);
  if (!bytes) {
    warnings.push(`Could not download the linked PDF menu at ${link.href}.`);
    return null;
  }

  const pdf = await extractPdfText(bytes);
  warnings.push(...pdf.warnings);
  return {
    text: pdf.text,
    sourceType: pdf.sourceType,
    sourceUrl: link.href,
    restaurantName: source.restaurantName
  };
}

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

/**
 * Reduce any of the four accepted inputs to `{text, sourceType}`.
 * @returns {Promise<{text: string, sourceType: string, sourceUrl?: string, restaurantName?: string}>}
 */
async function resolveSource(input, warnings) {
  // The rendered DOM outranks everything. When the side panel hands us both
  // structured items and the page's flat text, the flat text is a fallback for
  // the case where the walker recognized nothing — never a competitor.
  if (Array.isArray(input.domItems) && input.domItems.length > 0) {
    return { domItems: input.domItems, text: input.text ?? "", sourceType: "dom" };
  }

  if (typeof input.text === "string" && input.text.trim() !== "") {
    return { text: input.text, sourceType: "raw_text" };
  }

  if (input.pdfBytes) {
    const pdf = await extractPdfText(input.pdfBytes);
    warnings.push(...pdf.warnings);
    return { text: pdf.text, sourceType: pdf.sourceType };
  }

  if (typeof input.html === "string") {
    return fromHtml(input.html, input);
  }

  if (input.url) {
    return fromUrl(input.url, input, warnings);
  }

  warnings.push("No menu source was provided.");
  return { text: "", sourceType: "raw_text" };
}

/**
 * HTML in hand. The linked-PDF candidates ride along on the source so that
 * extractMenu can fall back to them if the page turns out to hold no menu.
 */
function fromHtml(html, input, sourceUrl) {
  const extracted = extractHtml(html, { baseUrl: sourceUrl ?? input.url });

  const result = {
    text: extracted.text,
    sourceType: "html",
    restaurantName: cleanTitle(extracted.title),
    pdfLinks: extracted.pdfLinks
  };
  if (sourceUrl ?? input.url) result.sourceUrl = sourceUrl ?? input.url;
  return result;
}

/** Fetch a URL and decide from the BYTES what it is. */
async function fromUrl(url, input, warnings) {
  if (typeof input.fetch !== "function") {
    throw new TypeError(
      "extractMenu({ url }) requires a `fetch` implementation. Pass one explicitly."
    );
  }

  const detected = detectSource(url);
  const bytes = await fetchBytes(input.fetch, url);
  if (!bytes) {
    warnings.push(`Could not download ${url}.`);
    return { text: "", sourceType: detected.isPdfUrl ? "pdf_ocr_needed" : "html", sourceUrl: url };
  }

  // Magic bytes beat both the file extension and the Content-Type header, which
  // servers get wrong constantly.
  if (looksLikePdfBytes(bytes)) {
    const pdf = await extractPdfText(bytes);
    warnings.push(...pdf.warnings);
    return { text: pdf.text, sourceType: pdf.sourceType, sourceUrl: url };
  }

  const html = new TextDecoder("utf-8").decode(bytes);
  return fromHtml(html, input, url);
}

async function fetchBytes(fetchImpl, url) {
  try {
    const response = await fetchImpl(url);
    if (!response || response.ok === false) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** "The Corner Kitchen | Menu" -> "The Corner Kitchen" */
function cleanTitle(title) {
  if (!title) return undefined;
  const cleaned = title
    .split(/\s+[|–—-]\s+/)[0]
    .replace(/\b(menu|official site|home)\b/gi, "")
    .trim();
  return cleaned || undefined;
}

// ---------------------------------------------------------------------------
// Adapter to the ranking engine
// ---------------------------------------------------------------------------

/**
 * Shape extracted items for scoringService.rankMeals().
 *
 * `estimated` and the confidence label are what let the existing UI show a meal
 * as an estimate rather than a fact — the same contract data/sampleMenu.js
 * satisfies with `estimated: false`. A published item is not an estimate, and
 * says so on its card.
 *
 * @param {import("../types/menu.js").MenuExtractionResult} result
 */
export function toRankableMeals(result) {
  return result.items.map((item) => {
    const published = item.macroSource === MACRO_SOURCE_PUBLISHED;
    return {
      id: slugify(item.dishName),
      name: item.dishName,
      description: item.description ?? "",
      // A side/add-on ("Lobster Tail" under "Elevate Your Plate") is kept and
      // shown, but categorized so the ranker lists it below real meals and the
      // card can label it — never presenting an add-on as the best *meal*.
      category: item.isSide ? "side" : "entree",
      calories: item.estimatedMacros.calories,
      protein_g: item.estimatedMacros.protein_g,
      carbs_g: item.estimatedMacros.carbs_g,
      fat_g: item.estimatedMacros.fat_g,
      source: published ? PUBLISHED_SOURCE_LABEL : ESTIMATED_SOURCE_LABEL,
      confidence: confidenceLabel(item.macroConfidence),
      estimated: !published
    };
  });
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
