// config.js
// Central configuration for MacroMenu.
// Keep this file free of secrets, API keys, and anything environment-specific.
// It is safe to commit to GitHub.

export const CONFIG = {
  // Product-facing metadata.
  APP_NAME: "MacroMenu",
  VERSION: "0.1.0",

  // How many ranked meals to show in the side panel.
  TOP_N_RESULTS: 5,

  // Local storage key for the user's selected goal.
  STORAGE_KEY_GOAL: "macromenu.selectedGoal",

  // Default goal used on first run.
  DEFAULT_GOAL: "maintain",

  // Data source flags, so behavior can change without rewriting the panel.
  //
  // USE_MENU_EXTRACTION reads the rendered DOM of the active tab.
  // USE_MOCK_DATA falls back to data/sampleMenu.js when extraction throws —
  // useful for working on the UI without a restaurant page open. It is off by
  // default because silently ranking a fictional restaurant's meals as if they
  // were the page's is worse than saying the page could not be read.
  DATA_SOURCE: {
    USE_MOCK_DATA: false,
    USE_MENU_EXTRACTION: true,
    USE_NUTRITION_LOOKUP: false,
    USE_AI_ESTIMATION: false
  }
};
