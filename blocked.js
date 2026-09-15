const params = new URLSearchParams(window.location.search);
const existingUrl = params.get("existingUrl");
const existingTabId = Number(params.get("existingTabId"));
const requestedUrl = params.get("requestedUrl");
const existingContainer = document.getElementById("existing-url");
const requestedContainer = document.getElementById("requested-url");
const replaceBtn = document.getElementById("replace-btn");

async function switchToExistingTab(e) {
  e.preventDefault();
  try {
    const tab = await chrome.tabs.get(existingTabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(existingTabId, { active: true });

    const current = await chrome.tabs.getCurrent();
    if (current) chrome.tabs.remove(current.id);
  } catch {
    // The other tab is gone (closed since this page loaded) — just go there instead.
    const current = await chrome.tabs.getCurrent();
    if (current) chrome.tabs.update(current.id, { url: existingUrl });
  }
}

async function replaceExistingTab() {
  try {
    const tab = await chrome.tabs.get(existingTabId);
    await chrome.tabs.update(existingTabId, { url: requestedUrl });
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(existingTabId, { active: true });

    const current = await chrome.tabs.getCurrent();
    if (current) chrome.tabs.remove(current.id);
  } catch {
    // The other tab is gone (closed since this page loaded) — the domain is
    // free again, so just load the requested URL in this tab instead.
    const current = await chrome.tabs.getCurrent();
    if (current) chrome.tabs.update(current.id, { url: requestedUrl });
  }
}

if (existingUrl) {
  let isHttp = false;
  try {
    isHttp = ["http:", "https:"].includes(new URL(existingUrl).protocol);
  } catch {}

  if (isHttp) {
    const link = document.createElement("a");
    link.href = existingUrl;
    link.textContent = existingUrl;
    if (!Number.isNaN(existingTabId)) {
      link.addEventListener("click", switchToExistingTab);
    }
    existingContainer.appendChild(link);
  } else {
    existingContainer.textContent = existingUrl;
  }
}

if (requestedUrl) {
  // Shown as plain text only — it's the blocked destination, not something
  // this page can navigate to.
  requestedContainer.textContent = requestedUrl;

  if (!Number.isNaN(existingTabId)) {
    replaceBtn.hidden = false;
    replaceBtn.addEventListener("click", replaceExistingTab);
  }
}
