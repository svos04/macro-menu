// types/menu.js
// Shared type definitions for the menu extraction + macro estimation pipeline.
//
// The project has no build step, so "types" here are JSDoc typedefs. Editors
// and `tsc --checkJs` understand them; the runtime cost is zero. The only
// runtime exports are the two strings the pipeline actually stamps onto output.

/**
 * Where a block of menu text came from, and how much we trust it.
 *
 * "pdf_ocr_needed" is not an error — it means we extracted a PDF but the text
 * layer was missing or unusable, so the item list will be empty until an OCR
 * pass exists. It is a clearly flagged fallback state, never a silent failure.
 *
 * "dom" is the rendered page as Chrome drew it, read through the side panel.
 * It is distinct from "html" — which is markup fetched over the network and
 * never executed — because a menu built by JavaScript exists only in the DOM.
 *
 * @typedef {"dom"|"html"|"pdf_text"|"pdf_ocr_needed"|"raw_text"} SourceType
 */

/**
 * @typedef {"bowl"|"salad_with_protein"|"sandwich"|"burger"|"wrap"|"burrito"|"taco"
 *          |"fajita"|"pasta"|"parmigiana"|"pizza"|"sushi"|"plate"|"soup"|"unknown"} DishType
 */

/**
 * Nutritional role of an ingredient, used for reporting.
 *
 * Deliberately distinct from an ingredient's *slot* (see portionTemplates.js).
 * Mayo is a "fat" by category but occupies the "sauce" slot volumetrically;
 * black beans are a "carb" by category but occupy the "beans" slot. Collapsing
 * the two concepts is what makes naive estimators double-count.
 *
 * @typedef {"protein"|"carb"|"fat"|"vegetable"|"sauce"|"other"} IngredientCategory
 */

/**
 * @typedef {object} ParsedMenuItem
 * @property {string} [section]        Heading the item appeared under.
 * @property {string} dishName
 * @property {string} [description]
 * @property {number} [price]
 * @property {SourceType} sourceType
 * @property {boolean} includedInV1    False for drinks, sides, desserts, etc.
 * @property {string} [exclusionReason] Human-readable, present iff excluded.
 * @property {number} parseConfidence  0..1
 */

/**
 * @typedef {object} DetectedIngredient
 * @property {string} rawText          Exact substring that matched.
 * @property {string} normalizedName
 * @property {IngredientCategory} category
 * @property {number} confidence       0..1
 * @property {boolean} countedInMacros False when the dish template has no slot
 *                                     for it (likely a side or garnish).
 */

/**
 * Macros use the project-wide `_g` suffix so that estimated items drop straight
 * into scoringService.rankMeals() without a translation layer.
 *
 * @typedef {object} EstimatedMacros
 * @property {number} calories
 * @property {number} protein_g
 * @property {number} carbs_g
 * @property {number} fat_g
 */

/**
 * @typedef {ParsedMenuItem} MacroMenuItemBase
 *
 * @typedef {object} MacroMenuItemExtras
 * @property {DishType} dishType
 * @property {DetectedIngredient[]} detectedIngredients
 * @property {EstimatedMacros} estimatedMacros
 * @property {"estimated_common_assumptions"|"restaurant_published"} macroSource
 * @property {number} macroConfidence  0..1
 * @property {string[]} assumptions    Every guess we made, in plain English.
 *                                     Empty when macroSource is published —
 *                                     there was nothing to guess.
 *
 * @typedef {MacroMenuItemBase & MacroMenuItemExtras} MacroMenuItem
 */

/**
 * @typedef {object} MenuExtractionResult
 * @property {string} [restaurantName]
 * @property {string} [sourceUrl]
 * @property {SourceType} sourceType
 * @property {MacroMenuItem[]} items
 * @property {ParsedMenuItem[]} excludedItems
 * @property {string[]} warnings
 */

/**
 * Attached to any result containing at least one estimated item. The product's
 * credibility rests on never letting a user mistake an assumption for a
 * restaurant-published number — and, just as importantly, on not disclaiming
 * numbers the restaurant did publish. A result whose every item came off the
 * page carries no estimation warning, because nothing in it was estimated.
 */
export const ESTIMATION_WARNING =
  "Macros are estimated from common assumptions and are not restaurant-provided.";

/** Marks estimated macros wherever they surface. */
export const MACRO_SOURCE_ESTIMATED = "estimated_common_assumptions";

/** Marks macros the restaurant printed on its own page. */
export const MACRO_SOURCE_PUBLISHED = "restaurant_published";

/**
 * Confidence for a published macro.
 *
 * Above MAX_MACRO_CONFIDENCE (0.85) on purpose: that ceiling exists because an
 * estimate is a guess about a dish nobody weighed. This number is not a guess.
 * It is short of 1.0 only because we read it off a stranger's HTML, and because
 * restaurants round their own figures.
 */
export const PUBLISHED_MACRO_CONFIDENCE = 0.95;
