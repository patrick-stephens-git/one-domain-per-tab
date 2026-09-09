const siteList = document.getElementById("site-list");
const emptyState = document.getElementById("empty-state");
const addForm = document.getElementById("add-form");
const siteInput = document.getElementById("site-input");
const errorMsg = document.getElementById("error-msg");

function normalizeDomain(input) {
  // Strip protocol and path, lowercase. Deliberately keeps subdomains
  // (e.g. "www." or "mail.") intact since they're distinct domains here.
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = "block";
  setTimeout(() => (errorMsg.style.display = "none"), 2500);
}

function render(domains) {
  siteList.innerHTML = "";

  if (domains.length === 0) {
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  domains.forEach((domain) => {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.textContent = domain;

    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.title = "Remove override";
    btn.textContent = "×";
    btn.addEventListener("click", () => removeDomain(domain));

    li.appendChild(span);
    li.appendChild(btn);
    siteList.appendChild(li);
  });
}

async function loadDomains() {
  const { overrideDomains = [] } = await chrome.storage.sync.get("overrideDomains");
  render(overrideDomains);
}

async function addDomain(raw) {
  const domain = normalizeDomain(raw);

  if (!domain || /\s/.test(domain)) {
    showError("Enter a valid domain (e.g. mail.google.com or localhost:3000)");
    return;
  }

  const { overrideDomains = [] } = await chrome.storage.sync.get("overrideDomains");

  if (overrideDomains.includes(domain)) {
    showError(`${domain} is already an override`);
    return;
  }

  const updated = [...overrideDomains, domain];
  await chrome.storage.sync.set({ overrideDomains: updated });
  render(updated);
}

async function removeDomain(domain) {
  const { overrideDomains = [] } = await chrome.storage.sync.get("overrideDomains");
  const updated = overrideDomains.filter((d) => d !== domain);
  await chrome.storage.sync.set({ overrideDomains: updated });
  render(updated);
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = siteInput.value;
  if (!value.trim()) return;
  siteInput.value = "";
  addDomain(value);
});

loadDomains();
