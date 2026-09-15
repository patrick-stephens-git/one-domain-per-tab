// tabId -> full URL currently open in that tab (only for tabs actively "holding" a domain)
const tabUrls = new Map();
// tabIds whose opening navigation has already been evaluated (or is exempt from evaluation)
const settledTabs = new Set();

let initPromise = null;

// How long after browser startup to skip enforcement, so cascading session-restore
// tabs don't get blocked against each other.
const STARTUP_GRACE_MS = 5000;

// "Domain" here means host+port (e.g. localhost:3000 and localhost:8000 count
// as different domains), not just hostname.
function domainKeyOf(urlString) {
  if (!urlString) return null;
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

// Records a tab's current URL without ever blocking it — used for tabs whose
// opening navigation shouldn't be (or already was) evaluated.
function trackWithoutChecking(tabId, url) {
  settledTabs.add(tabId);
  if (domainKeyOf(url)) tabUrls.set(tabId, url);
}

function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        const url = tab.url || tab.pendingUrl;
        // Skip tabs with no resolved domain yet (e.g. a brand-new tab whose
        // onCreated is what's racing us into this lazy init): marking them
        // settled here would make their real onUpdated navigation look
        // already-evaluated and skip the duplicate check entirely.
        if (!domainKeyOf(url)) continue;
        trackWithoutChecking(tab.id, url);
      }
    })();
  }
  return initPromise;
}

async function isInStartupGrace() {
  const { graceUntil } = await chrome.storage.session.get("graceUntil");
  return typeof graceUntil === "number" && Date.now() < graceUntil;
}

async function checkAndMaybeBlock(tabId, url, domainKey) {
  const { overrideDomains = [] } = await chrome.storage.sync.get("overrideDomains");
  if (overrideDomains.includes(domainKey)) {
    tabUrls.set(tabId, url);
    return;
  }

  for (const [otherTabId, otherUrl] of tabUrls) {
    if (otherTabId === tabId) continue;
    if (domainKeyOf(otherUrl) === domainKey) {
      const blockedUrl =
        chrome.runtime.getURL("blocked.html") +
        `?existingTabId=${otherTabId}` +
        `&existingUrl=${encodeURIComponent(otherUrl)}` +
        `&requestedUrl=${encodeURIComponent(url)}`;
      chrome.tabs.update(tabId, { url: blockedUrl });
      return;
    }
  }

  tabUrls.set(tabId, url);
}

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.set({ graceUntil: Date.now() + STARTUP_GRACE_MS });
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await ensureInitialized();

  const url = tab.url || tab.pendingUrl;

  if (await isInStartupGrace()) {
    trackWithoutChecking(tab.id, url);
    return;
  }

  const domainKey = domainKeyOf(url);
  if (!domainKey) return; // no real destination yet; wait for onUpdated

  settledTabs.add(tab.id);
  await checkAndMaybeBlock(tab.id, url, domainKey);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  await ensureInitialized();

  const domainKey = domainKeyOf(changeInfo.url);

  if (settledTabs.has(tabId)) {
    // Not this tab's opening navigation — just keep the map accurate, never block.
    if (domainKey) tabUrls.set(tabId, changeInfo.url);
    else tabUrls.delete(tabId);
    return;
  }

  if (!domainKey) return; // still no real destination (e.g. chrome://newtab) — wait for it, don't settle yet

  settledTabs.add(tabId);
  await checkAndMaybeBlock(tabId, changeInfo.url, domainKey);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrls.delete(tabId);
  settledTabs.delete(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (tabUrls.has(removedTabId)) tabUrls.set(addedTabId, tabUrls.get(removedTabId));
  tabUrls.delete(removedTabId);

  settledTabs.add(addedTabId);
  settledTabs.delete(removedTabId);
});
