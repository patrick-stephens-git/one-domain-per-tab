const params = new URLSearchParams(window.location.search);
const existingUrl = params.get("existingUrl");
const existingTabId = Number(params.get("existingTabId"));
const container = document.getElementById("existing-url");

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
    container.appendChild(link);
  } else {
    container.textContent = existingUrl;
  }
}
