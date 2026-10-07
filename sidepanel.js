// sidepanel.js
// Wires the side panel UI to the scoring engine and current-tab menu extraction.
//
// Data flow:
//   active tab DOM -> extractMenu() -> rankMeals(goal) -> render top N cards
// Goal selection is persisted to chrome.storage.local so it sticks between
// sessions. Everything runs locally; there are no network calls.
//
// Note: unlike a popup, a side panel stays open across tab switches and page
// navigations, so this script can be long-lived. Keep it free of per-page
// assumptions.

import { CONFIG } from "./config.js";
import { SAMPLE_MENU } from "./data/sampleMenu.js";
import { snapshotRenderedPage } from "./content/pageSnapshot.js";
import { extractMenu, toRankableMeals } from "./services/menuExtractionService.js";
import { rankMeals, BADGES } from "./services/scoringService.js";
import { grams, calories, scoreOutOf100 } from "./utils/formatters.js";

// Current UI state.
let currentGoal = CONFIG.DEFAULT_GOAL;
let currentRanked = [];
let currentMeals = [];
let currentStatus = "Reading this page…";
let currentSourceNote = "Prototype · Ranked from the current page";

// ---------------------------------------------------------------------------
// Storage helpers (graceful if chrome.storage isn't available, e.g. when the
// file is opened directly in a browser tab for quick testing).
// ---------------------------------------------------------------------------
async function loadGoal() {
  try {
    const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY_GOAL);
    return result[CONFIG.STORAGE_KEY_GOAL] || CONFIG.DEFAULT_GOAL;
  } catch {
    return CONFIG.DEFAULT_GOAL;
  }
}

async function saveGoal(goal) {
  try {
    await chrome.storage.local.set({ [CONFIG.STORAGE_KEY_GOAL]: goal });
  } catch {
    // Storage unavailable — fine for the prototype, selection just won't persist.
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderGoalButtons() {
  document.querySelectorAll(".goal-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.goal === currentGoal);
  });
}

function renderResults() {
  const list = document.getElementById("results");
  const status = document.getElementById("status");
  const sourceNote = document.getElementById("source-note");

  status.textContent = currentStatus;
  sourceNote.textContent = currentSourceNote;
  list.innerHTML = "";

  if (currentMeals.length === 0) {
    currentRanked = [];
    list.appendChild(buildEmptyState());
    return;
  }

  currentRanked = rankMeals(currentMeals, currentGoal).slice(
    0,
    CONFIG.TOP_N_RESULTS
  );

  currentRanked.forEach((meal) => {
    const li = document.createElement("li");
    li.className = "card";
    li.appendChild(buildCard(meal));
    list.appendChild(li);
  });

  // Jump back to the top pick after a re-rank — the list is its own scroll
  // container, so switching goals would otherwise leave you parked mid-list.
  // Reset after the cards are in place: doing it while the list is empty would
  // depend on how the browser clamps the offset when content is re-added.
  list.scrollTop = 0;
}

// Build one result card via DOM APIs (no innerHTML with data — safer and clean).
function buildCard(meal) {
  const frag = document.createDocumentFragment();

  const top = el("div", "card-top");
  top.appendChild(el("h3", "card-name", meal.name));
  top.appendChild(el("span", "card-score", scoreOutOf100(meal.score)));
  frag.appendChild(top);

  // Badges sit directly under the name — they're the fastest thing to scan.
  if (meal.badges?.length) {
    const badges = el("div", "badges");
    meal.badges.forEach((text) => {
      const badge = el("span", "badge", text);
      // The top result's badge is the one that earns visual emphasis.
      if (text === BADGES.BEST_MATCH) badge.classList.add("badge-best");
      // A side/add-on is called out so it's never mistaken for a full meal.
      if (text === BADGES.SIDE) badge.classList.add("badge-side");
      badges.appendChild(badge);
    });
    frag.appendChild(badges);
  }

  const macros = el("div", "macros");
  macros.appendChild(macroChip("Calories", calories(meal.calories)));
  macros.appendChild(macroChip("Protein", grams(meal.protein_g)));
  macros.appendChild(macroChip("Carbs", grams(meal.carbs_g)));
  macros.appendChild(macroChip("Fat", grams(meal.fat_g)));
  frag.appendChild(macros);

  frag.appendChild(el("p", "explanation", meal.explanation));

  const labels = el("div", "labels");
  labels.appendChild(el("span", "label label-source", meal.source));
  labels.appendChild(el("span", "label label-confidence", confidenceText(meal.confidence)));
  frag.appendChild(labels);

  return frag;
}

function buildEmptyState() {
  const li = document.createElement("li");
  li.className = "card empty-card";
  li.appendChild(el("h3", "card-name", "No meals found"));
  li.appendChild(
    el(
      "p",
      "explanation",
      "Open a restaurant menu page, then click the MacroMenu icon again so I can read the page Chrome rendered."
    )
  );
  return li;
}

function macroChip(label, value) {
  const chip = el("span", "macro");
  const strong = document.createElement("strong");
  strong.textContent = value;
  chip.append(`${label} `, strong);
  return chip;
}

// Tiny element helper.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function confidenceText(confidence) {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Medium confidence";
  if (confidence === "low") return "Low confidence";
  return "Estimated";
}

// ---------------------------------------------------------------------------
// Current-tab extraction
// ---------------------------------------------------------------------------
async function loadMealsFromCurrentTab() {
  if (!CONFIG.DATA_SOURCE.USE_MENU_EXTRACTION) {
    useMockMeals("Mock data");
    return;
  }

  try {
    const snapshot = await readRenderedTab();
    const result = await extractMenu({
      domItems: snapshot.items,
      text: snapshot.text,
      url: snapshot.url,
      restaurantName: snapshot.title
    });

    currentMeals = toRankableMeals(result);
    if (currentMeals.length > 0) {
      currentStatus = `${currentMeals.length} meals found on this page.`;
      currentSourceNote = result.restaurantName
        ? `Prototype · ${result.restaurantName}`
        : "Prototype · Ranked from the current page";
      return;
    }

    currentStatus = noMealsMessage(snapshot, result);
    currentSourceNote = "Prototype · Current page";
  } catch (err) {
    if (CONFIG.DATA_SOURCE.USE_MOCK_DATA) {
      useMockMeals("Mock data fallback");
      return;
    }

    currentMeals = [];
    currentStatus = userFacingExtractionError(err);
    currentSourceNote = "Prototype · Current page";
  }
}

function useMockMeals(label) {
  currentMeals = SAMPLE_MENU;
  currentStatus = "Using sample meals.";
  currentSourceNote = `Prototype · ${label}`;
}

async function readRenderedTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("NO_ACTIVE_TAB");
  if (!isReadablePage(tab.url)) throw new Error("UNREADABLE_PAGE");

  // `func` is serialized with toString() and rebuilt inside the page, so it
  // must reach for nothing outside itself. See content/pageSnapshot.js — an
  // earlier version referenced its module-scope helpers, threw ReferenceError
  // in every page it touched, and reported "I could not read this page".
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: snapshotRenderedPage
  });

  if (!injection?.result) throw new Error("EMPTY_PAGE_SNAPSHOT");
  return injection.result;
}

function isReadablePage(url) {
  return /^https?:\/\//i.test(url ?? "");
}

function userFacingExtractionError(err) {
  const message = String(err?.message ?? err);
  if (message.includes("NO_ACTIVE_TAB")) return "I could not find an active tab to read.";
  if (message.includes("UNREADABLE_PAGE")) return "This kind of page cannot be read by the extension.";
  if (message.includes("Cannot access")) return "Chrome did not allow access to this page.";
  return "I could not read this page.";
}

function noMealsMessage(snapshot, result) {
  // The walker recognized item-shaped blocks but the filter rejected every one:
  // the page has content, it just isn't a menu of entrees.
  if (snapshot.items.length > 0) {
    return result.warnings.find((w) => /no entree-like/i.test(w))
      ?? "I found items on this page, but none look like meals.";
  }
  if (snapshot.inaccessibleIframeCount > 0) {
    return "This page may render the ordering menu in a protected frame I cannot read.";
  }
  return "No menu items were found on this page.";
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function wireGoalButtons() {
  document.querySelectorAll(".goal-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      currentGoal = btn.dataset.goal;
      renderGoalButtons();
      renderResults();
      await saveGoal(currentGoal);
    });
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
// The panel is scoped to a page by background.js, not from here. Its only
// persistent state is the selected goal, restored below — which is what makes
// the panel come back "as it was" after you navigate away and return.
async function init() {
  currentGoal = await loadGoal();
  renderGoalButtons();
  wireGoalButtons();
  renderResults();
  await loadMealsFromCurrentTab();
  renderResults();
}

init();
