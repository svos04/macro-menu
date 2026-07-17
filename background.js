// background.js
// Service worker. Two jobs:
//   1. Open the side panel when the toolbar icon is clicked.
//   2. Scope the panel to the page it was opened on — hide it when you navigate
//      away or switch tabs, bring it back when you return.
//
// Why this file has to exist: a Manifest V3 action can have a popup OR trigger
// the side panel, not both. With `action.default_popup` removed, the toolbar
// icon stays inert until the extension tells Chrome what a click means, and
// that can only be done from an extension context.
//
// No network access. Reads tab URLs locally to decide where the panel belongs.

const PANEL_PATH = "sidepanel.html";

// Where the panel "lives": the tab it was opened in, plus that tab's origin.
// Kept in session storage rather than a module variable because the service
// worker is evicted when idle and would otherwise forget the anchor.
const ANCHOR_KEY = "macromenu.anchor";

// ---------------------------------------------------------------------------
// Anchor state
// ---------------------------------------------------------------------------
async function getAnchor() {
  const stored = await chrome.storage.session.get(ANCHOR_KEY);
  return stored[ANCHOR_KEY] ?? null;
}

async function setAnchor(anchor) {
  await chrome.storage.session.set({ [ANCHOR_KEY]: anchor });
}

async function clearAnchor() {
  await chrome.storage.session.remove(ANCHOR_KEY);
}

// Origin, or null for pages we can't anchor to (chrome://, about:blank, a tab
// whose URL we can't read). Anchoring to those would hide the panel instantly.
function originOf(url) {
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

// Never swallow a sidePanel error. An earlier version wrapped these in a bare
// `catch {}` to tolerate closed-tab races, which silently hid the API rejection
// that was breaking the whole feature.
function warn(context, err) {
  // A tab that closed mid-flight is expected and uninteresting.
  if (String(err?.message || err).includes("No tab with id")) return;
  console.warn(`MacroMenu: ${context}`, err);
}

// ---------------------------------------------------------------------------
// Panel visibility
// ---------------------------------------------------------------------------
// Chrome has no "close the side panel" API. Disabling it for a tab is what
// closes it; re-enabling is what brings it back.
//
// Two Chrome quirks drive the exact shape of this code:
//
//  1. `setOptions({ tabId, enabled: false })` must NOT carry a `path`. That is
//     the form Chrome's own site-specific sample uses.
//
//  2. A GLOBAL panel (manifest `side_panel.default_path`) is window-scoped, and
//     a window-scoped panel ignores per-tab `enabled: false` — it just stays up
//     on every tab. `open({ tabId })` can fall back to opening that global panel
//     if the tab has no options of its own yet (crbug 377330001). So we disable
//     the panel globally at startup and only ever enable it per tab. Without
//     this, none of the hiding below has any effect.
async function showOn(tabId) {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  } catch (err) {
    warn("setOptions(enable) failed", err);
  }
}

async function hideOn(tabId) {
  try {
    // No `path` here — see quirk (1).
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
  } catch (err) {
    warn("setOptions(disable) failed", err);
  }
}

// Should the panel be available on this tab?
//
// With no anchor, every tab is enabled. That looks odd until you remember the
// panel is closed at that point, so "enabled" shows nothing — and it means a
// toolbar click always finds its tab already enabled, which is what lets
// `open()` run synchronously inside the user gesture. See onClicked.
function shouldShow(anchor, tabId, url) {
  if (!anchor) return true;
  return tabId === anchor.tabId && originOf(url) === anchor.origin;
}

async function syncTab(tabId, url) {
  const anchor = await getAnchor();
  if (shouldShow(anchor, tabId, url)) await showOn(tabId);
  else await hideOn(tabId);
}

async function syncTabById(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncTab(tabId, tab.url);
  } catch {
    // Tab vanished between the event and the lookup.
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
// Both of these settings persist across extension reloads, so they must be
// re-asserted rather than assumed. An earlier version set
// openPanelOnActionClick: true, and that value would otherwise stick.
async function initPanelDefaults() {
  try {
    // We open the panel ourselves, so Chrome must not also try to.
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (err) {
    warn("setPanelBehavior failed", err);
  }
  try {
    // Kill the global/window-scoped panel — see quirk (2). Everything after
    // this point is strictly per-tab.
    await chrome.sidePanel.setOptions({ enabled: false });
  } catch (err) {
    warn("global setOptions(disable) failed", err);
  }
  // A stale anchor from a previous browser session points at a dead tab id.
  await clearAnchor();
}

chrome.runtime.onInstalled.addListener(initPanelDefaults);
chrome.runtime.onStartup.addListener(initPanelDefaults);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// Toolbar click: (re-)anchor to this tab and open the panel here.
//
// `sidePanel.open()` only works while the user gesture is live. Awaiting
// anything first — storage, tabs.get, even setOptions — consumes the gesture and
// makes open() throw. So open() is fired synchronously and every await happens
// after it.
//
// Fast path: the tab is already enabled (unanchored tabs are, and so is the
// anchored one), so open() succeeds immediately.
//
// Slow path: the tab was disabled because another tab held the anchor. The
// enable below is asynchronous, so open() can lose the race and reject with
// "No active side panel". There is no global panel to fall back on any more —
// that fallback was the original bug — so we wait for the enable to land and
// retry. The retry happens outside the gesture, which Chrome may reject; if so
// we say as much rather than failing silently.
chrome.action.onClicked.addListener((tab) => {
  // Pages without a usable origin (chrome://, about:blank) stay unanchored:
  // the panel opens and simply doesn't follow navigation.
  const origin = originOf(tab.url);
  if (origin) setAnchor({ tabId: tab.id, origin });
  else clearAnchor();

  const enabling = chrome.sidePanel
    .setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true })
    .catch((err) => warn("setOptions(enable on click) failed", err));

  chrome.sidePanel.open({ tabId: tab.id }).catch(async (err) => {
    warn("sidePanel.open lost the race with setOptions; retrying", err);
    try {
      await enabling;
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (retryErr) {
      warn("retry failed — click the icon again to open the panel", retryErr);
    }
  });
});

// Navigating the anchored tab away from its origin hides the panel; navigating
// back re-enables it. Only real URL changes matter — ignore the load/complete
// churn that onUpdated also emits.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  syncTab(tabId, changeInfo.url);
});

// Switching tabs hides the panel unless the new tab is the anchored one.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  syncTabById(tabId);
});

// If the anchored tab closes, the anchor is meaningless — drop it so the panel
// isn't permanently bound to a tab id Chrome may later reuse.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const anchor = await getAnchor();
  if (anchor && anchor.tabId === tabId) await clearAnchor();
});
