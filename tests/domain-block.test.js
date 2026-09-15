'use strict';

// End-to-end check for the "one domain per tab" rule:
//   - a second tab opened on a domain already open elsewhere gets redirected
//     to blocked.html, with links back to the existing tab and the option to
//     load the new URL into it instead
//   - a different domain, or a domain on the override list, is never blocked
//   - closing the tab that "holds" a domain frees it back up
//
// Run: npm test  (spins up a local fixture server + a real headed Chromium
// with the unpacked extension loaded, drives it via real navigations and
// real clicks, and reads the real DOM/tabs the shipped code produces.)

const assert = require('assert');
const http   = require('http');
const path   = require('path');
const { chromium } = require('playwright');

const EXT_PATH = path.join(__dirname, '..');

function startFixtureServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><title>fixture</title><body>fixture site ${req.url}</body>`);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function getTabId(context, extensionId, page) {
  // The extension itself is the only thing that knows tab ids; ask the
  // popup (which shares the same chrome.tabs API) to look it up for us.
  const helper = await context.newPage();
  await helper.goto(`chrome-extension://${extensionId}/popup.html`);
  const id = await helper.evaluate(async url => {
    // Filter client-side (rather than via chrome.tabs.query({ url })) since
    // that filter requires a match-pattern, which "about:blank" isn't.
    const tabs = await chrome.tabs.query({});
    return tabs.find(t => t.url === url || t.pendingUrl === url)?.id;
  }, page.url());
  await helper.close();
  return id;
}

async function main() {
  const { server, port } = await startFixtureServer();
  const userDataDir = path.join(require('os').tmpdir(), `odpt-test-${Date.now()}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  });

  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = sw.url().split('/')[2];

    async function waitForBlockedPage(page) {
      await page.waitForURL(u => u.pathname.endsWith('/blocked.html'), { timeout: 5000 });
    }

    // ── Same domain, second tab gets blocked ──
    const pageA1 = await context.newPage();
    await pageA1.goto(`http://a.localhost:${port}/page1`);

    const pageA2 = await context.newPage();
    await pageA2.goto(`http://a.localhost:${port}/page2`);
    await waitForBlockedPage(pageA2);

    const blockedUrl = new URL(pageA2.url());
    assert.strictEqual(blockedUrl.searchParams.get('existingUrl'), `http://a.localhost:${port}/page1`,
      'blocked page should link back to the tab already holding the domain');
    assert.strictEqual(blockedUrl.searchParams.get('requestedUrl'), `http://a.localhost:${port}/page2`,
      'blocked page should record the URL that got blocked');
    assert.ok(blockedUrl.searchParams.get('existingTabId'), 'blocked page should carry the existing tab id');

    const existingLink = pageA2.locator('#existing-url a');
    assert.strictEqual(await existingLink.textContent(), `http://a.localhost:${port}/page1`,
      'existing-url should render as a clickable link for http(s) URLs');
    assert.strictEqual(await pageA2.locator('#requested-url').textContent(), `http://a.localhost:${port}/page2`,
      'requested-url should show the URL that was blocked, as plain text');
    assert.strictEqual(await pageA2.locator('#replace-btn').isHidden(), false,
      'replace button should be shown when we know which tab to replace');

    console.log('✓ second tab on an already-open domain is redirected to blocked.html with both URLs');

    // ── Different domain: never blocked ──
    const pageB = await context.newPage();
    await pageB.goto(`http://b.localhost:${port}/`);
    await pageB.waitForLoadState();
    assert.ok(!pageB.url().includes('blocked.html'), 'a different domain must never be blocked');
    assert.strictEqual(await pageB.title(), 'fixture');

    console.log('✓ a different domain is left alone');

    // ── "Go there instead" — clicking the existing-url link switches tabs ──
    const pagesBeforeSwitch = context.pages().length;
    await existingLink.click();
    await pageA2.waitForEvent('close', { timeout: 5000 });
    assert.strictEqual(context.pages().length, pagesBeforeSwitch - 1, 'the blocked tab should close itself');
    assert.strictEqual(pageA1.url(), `http://a.localhost:${port}/page1`, 'the original tab should be untouched');

    console.log('✓ clicking the existing-url link closes the blocked tab and leaves the original in place');

    // ── "Go there and load this URL instead" — replaces the existing tab ──
    const pageC1 = await context.newPage();
    await pageC1.goto(`http://c.localhost:${port}/page1`);

    const pageC2 = await context.newPage();
    await pageC2.goto(`http://c.localhost:${port}/page2`);
    await waitForBlockedPage(pageC2);

    await pageC2.locator('#replace-btn').click();
    await pageC2.waitForEvent('close', { timeout: 5000 });
    await pageC1.waitForURL(`http://c.localhost:${port}/page2`, { timeout: 5000 });

    console.log('✓ the replace button loads the blocked URL into the existing tab and closes the blocked one');

    // ── Closing the tab that holds a domain frees it back up ──
    const pageD1 = await context.newPage();
    await pageD1.goto(`http://d.localhost:${port}/page1`);
    await pageD1.close();

    const pageD2 = await context.newPage();
    await pageD2.goto(`http://d.localhost:${port}/page2`);
    await pageD2.waitForLoadState();
    assert.ok(!pageD2.url().includes('blocked.html'), 'closing the holding tab must free the domain for the next one');

    console.log('✓ closing the tab that held a domain frees it up for a new tab');

    // ── Override list: a domain on it is never blocked ──
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForSelector('#add-form');
    await popupPage.fill('#site-input', `e.localhost:${port}`);
    await popupPage.locator('#add-form button[type="submit"]').click();
    await popupPage.waitForFunction(
      port => document.getElementById('site-list').textContent.includes(`e.localhost:${port}`),
      port,
    );

    const pageE1 = await context.newPage();
    await pageE1.goto(`http://e.localhost:${port}/page1`);
    const pageE2 = await context.newPage();
    await pageE2.goto(`http://e.localhost:${port}/page2`);
    await pageE2.waitForLoadState();
    assert.ok(!pageE2.url().includes('blocked.html'), 'a domain on the override list must never be blocked');

    console.log('✓ a domain on the override list is exempt from blocking');

    // Removing it from the override list restores the normal blocking behavior.
    await popupPage.locator('#site-list li', { hasText: `e.localhost:${port}` }).locator('.remove-btn').click();
    await popupPage.waitForFunction(
      port => !document.getElementById('site-list').textContent.includes(`e.localhost:${port}`),
      port,
    );

    const pageE3 = await context.newPage();
    await pageE3.goto(`http://e.localhost:${port}/page3`);
    await waitForBlockedPage(pageE3);

    console.log('✓ removing a domain from the override list restores blocking');

    // ── Regression: a tab whose opening navigation hadn't resolved to a real
    // domain yet when ensureInitialized() took its chrome.tabs.query()
    // snapshot must NOT be marked "settled" by that snapshot — otherwise its
    // real opening navigation looks like a no-op update and skips the
    // duplicate-domain check entirely (the bug fixed alongside this test). ──
    const pageF1 = await context.newPage();
    await pageF1.goto(`http://f.localhost:${port}/page1`);
    const fTabId = await getTabId(context, extensionId, pageF1);

    const pageF2 = await context.newPage(); // about:blank — no resolved domain yet
    const f2TabId = await getTabId(context, extensionId, pageF2);

    await sw.evaluate(({ tabId }) => {
      // Reproduce exactly what a racing chrome.tabs.query() snapshot would
      // have handed ensureInitialized(): this tab, present, with no
      // resolved URL yet.
      settledTabs.delete(tabId);
      tabUrls.delete(tabId);
      const url = ''; // unresolved, like a brand-new about:blank tab
      if (domainKeyOf(url)) trackWithoutChecking(tabId, url);
    }, { tabId: f2TabId });

    await pageF2.goto(`http://f.localhost:${port}/page2`); // this tab's real opening navigation
    await waitForBlockedPage(pageF2);
    assert.strictEqual(new URL(pageF2.url()).searchParams.get('existingTabId'), String(fTabId),
      'the tab must still be evaluated against the already-open domain despite the unresolved-domain snapshot');

    console.log('✓ a tab with no resolved domain at init time is still checked on its real opening navigation');

    console.log('\nALL TESTS PASSED');
  } finally {
    await context.close();
    server.close();
  }
}

main().catch(err => {
  console.error('TEST FAILED:', err);
  process.exitCode = 1;
});
