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
const { beginArticleTouch } = require('../helpers/article_gestures');
const { waitRectStable } = require('../helpers/layout');
const {
  MAIN, holdBackReply, heldBack, sampleFrames, framesBringingBackArticle, watchReveals, revealedSinceWatch
} = require('../helpers/stack_routes');

const LAYER = '[data-stack-layer="articleList"]';
const UNDERLAY = '[data-article-exit-underlay]';
const RESULTS = { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] };

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
  await heldBack(page);
  const layer = page.locator(LAYER);
  await expect(layer).toBeVisible();
  await expect(layer).toContainText('Alpha topic');
  await expect(layer).toContainText('Beta topic');
  await expect(layer).not.toContainText('Delta topic');
  const cardOffset = (root, title) => page.evaluate(([root, title]) => {
    const view = document.querySelector(root);
    const card = [...view.querySelectorAll('.listCard')].find(c => c.textContent.includes(title));
    return card.getBoundingClientRect().top - view.getBoundingClientRect().top;
  }, [root, title]);
  const before = await cardOffset(LAYER, 'Beta topic');
  await release();
  await expect(layer).toHaveCount(0, { timeout: 10000 });
  await waitList(page, RESULTS);
  expect(Math.abs(await cardOffset(`${MAIN} .listBodyView`, 'Beta topic') - before)).toBeLessThanOrEqual(1);
});

test('swiping out of an article opened from search results never shows the article again before the results take over', async ({ page }) => {
  await openFromAuthorResults(page);
  const release = await holdBackReply(page);
  const main = await waitRectStable(page, MAIN);
  const y = main.top + 100;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'layer');
  await sampleFrames(page);
  await contact.release();
  await heldBack(page);
  await release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await waitList(page, RESULTS);
  const frames = await page.evaluate(() => window.__frames);
  expect(frames.length).toBeGreaterThan(10);
  expect(framesBringingBackArticle(frames)).toEqual([]);
  expect(frames.some(f => f.underlay && f.left >= page.viewportSize().width - 5)).toBe(true);
});

test('Back from the revealed results still returns to the article the search started from', async ({ page }) => {
  const position = await openFromAuthorResults(page);
  await nativeBack(page);
  await waitList(page, RESULTS);
  await watchReveals(page);
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
  expect(await revealedSinceWatch(page)).toBe(false);
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
  await heldBack(page);
  await expect(page.locator(LAYER)).toHaveCount(1);
  await release();
  await expect(page.locator(LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitList(page, RESULTS);
  // Back from the rebuilt results follows search return history alone.
  await watchReveals(page);
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  expect(await revealedSinceWatch(page)).toBe(false);
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
  expect(await revealedSinceWatch(page)).toBe(false);
});
