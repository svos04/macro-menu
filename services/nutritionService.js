// services/nutritionService.js
// PLACEHOLDER SERVICE — not used in V1.
//
// In a future version this module will look up nutrition facts for a menu
// item that we could not read directly from the page — for example via a
// free USDA FoodData Central lookup. For now it does nothing but define the
// intended shape so the rest of the app can be wired against a stable API.
//
// IMPORTANT: no API keys or secrets belong in this file. When real lookups
// are added, any credentials must come from user-provided settings at runtime,
// never be committed to the repo.

/**
 * Look up nutrition for a menu item by name.
 * @param {string} _itemName
 * @returns {Promise<null>} Always null in V1 (feature not implemented).
 */
export async function lookupNutrition(_itemName) {
  // Not implemented in the prototype. Returning null signals "no external
  // data available" so callers fall back to mock/estimated values.
  return null;
}
