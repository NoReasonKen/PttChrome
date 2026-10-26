// Search results stack like any article list (#33): leaving an article opened
// from results reveals the results at once, with the same handoff. Back from
// the results still follows search return history, and results reconstructed
// after a reconnect start a new stack. The controlled PTT board is
// helpers/article_shortcut_search.js; the app, touch input and Back are real.
const { test, expect } = require('@playwright/test');
const {
  bootNestedShortcutSearch, nativeBack, waitArticle, waitList, readToMiddle, topLine, tapShortcut, tapCard,
  disconnectAndReconnect
} = require('../helpers/article_shortcut_search');

const LAYER = '[data-stack-layer="articleList"]';
const RESULTS = { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] };

// Hold the board's reply to the next leave until the returned `release()`.
async function holdBackReply(page) {
  await page.evaluate(() => {
    const send = window.__stubWSSent;
    window.__heldBack = null;
    window.__stubWSSent = (data) => {
      if (data.indexOf('\x1b[D') < 0 || window.__heldBack) return send(data);
      window.__heldBack = () => send(data);
    };
  });
  return () => page.evaluate(() => window.__heldBack());
}

// Note whether any page is revealed from now on.
const watchReveals = page => page.evaluate(() => {
  window.__revealed = false;
  new MutationObserver(() => {
    if (document.querySelector('[data-stack-layer], [data-article-exit-underlay]')) window.__revealed = true;
  }).observe(document.body, { childList: true, subtree: true });
});

// The author results of Alpha, then Beta opened from them.
async function openFromAuthorResults(page, options) {
  await bootNestedShortcutSearch(page, { easyList: true, ...options });
  const position = await readToMiddle(page);
  await tapShortcut(page, 'author');
  await waitList(page, RESULTS);
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  return position;
}

test('Back from an article opened from search results reveals the results at once, at the same entry after the swap', async ({ page }) => {
  await openFromAuthorResults(page);
  const release = await holdBackReply(page);
  await nativeBack(page);
  await expect.poll(() => page.evaluate(() => !!window.__heldBack)).toBe(true);
  const layer = page.locator(LAYER);
  await expect(layer).toBeVisible();
  await expect(layer).toContainText('Alpha topic');
  await expect(layer).toContainText('Beta topic');
  await expect(layer).not.toContainText('Delta topic');
  const card = title => page.evaluate(([root, title]) => {
    const view = document.querySelector(root);
    const el = [...view.querySelectorAll('.listCard')].find(c => c.textContent.includes(title));
    return el.getBoundingClientRect().top - view.getBoundingClientRect().top;
  }, title);
  const before = await card([LAYER, 'Beta topic']);
  await release();
  await expect(layer).toHaveCount(0, { timeout: 10000 });
  await waitList(page, RESULTS);
  expect(Math.abs(await card(['.main:not([data-stack-layer]) .listBodyView', 'Beta topic']) - before)).toBeLessThanOrEqual(1);
});

test('Back from the revealed results still returns to the article the search started from', async ({ page }) => {
  const position = await openFromAuthorResults(page);
  await nativeBack(page);
  await waitList(page, RESULTS);
  await watchReveals(page);
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
  expect(await page.evaluate(() => window.__revealed)).toBe(false);
});

test('results reconstructed after a reconnect stack the articles opened from them', async ({ page }) => {
  await openFromAuthorResults(page, { loggedIn: true });
  await nativeBack(page);
  await waitList(page, RESULTS);
  await disconnectAndReconnect(page);
  await waitList(page, RESULTS);
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  // The reconstructed results are a new base for what is opened from them.
  const release = await holdBackReply(page);
  await nativeBack(page);
  await expect.poll(() => page.evaluate(() => !!window.__heldBack)).toBe(true);
  await expect(page.locator(LAYER)).toHaveCount(1);
  await release();
  await expect(page.locator(LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitList(page, RESULTS);
});

test('results reconstructed by search return after a reconnect reveal nothing from before it', async ({ page }) => {
  const position = await openFromAuthorResults(page, { loggedIn: true });
  // A result article has no free identity: recovery returns to the full board
  // list, and Back rebuilds the results from search return history.
  await disconnectAndReconnect(page);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await watchReveals(page);
  await nativeBack(page);
  await waitList(page, RESULTS);
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
  expect(await page.evaluate(() => window.__revealed)).toBe(false);
});
