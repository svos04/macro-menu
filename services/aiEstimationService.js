// services/aiEstimationService.js
// PLACEHOLDER SERVICE — not used in V1.
//
// Future role: when neither the menu page nor a nutrition database gives us
// macros for an item, this service would estimate them (e.g. via an AI model
// the user opts into). Estimated items would be flagged so the UI can label
// them clearly and show lower confidence.
//
// IMPORTANT: no API keys, endpoints, or secrets are stored here. Any model
// access in the future must be configured by the user at runtime.

/**
 * Estimate macros for a menu item from its name/description.
 * @param {{name: string, description?: string}} _item
 * @returns {Promise<null>} Always null in V1 (feature not implemented).
 */
export async function estimateMacros(_item) {
  // Not implemented in the prototype.
  return null;
}
