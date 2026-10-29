// A right swipe on a smooth-scrolling board list goes back like Back (#53),
// the same way an article list does (#32): the list follows the finger over
// the page below, and only a committed release sends PTT's Back. Real touch
// input on the recorded folder route (scn-stack-boardlist-folder.json):
// 分類看板 → 市民廣場, a group row opened.
const { test, expect } = require('@playwright/test');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { touchDrag, nextFrames } = require('../helpers/real_input');
const { waitRectStable } = require('../helpers/layout');
const ptt = require('../helpers/ptt');
const { bootScenario, loadCassette, waitFed } = require('../helpers/replay');
const { MAIN, boardListEngaged, holdLeaves, heldLeaves, releaseLeave, recordHints, recordedHints } = require('../helpers/stack_routes');

const folder = loadCassette('scn-stack-boardlist-folder.json');
const BOARD_LAYER = '[data-stack-layer="boardList"]';
const UNDERLAY = '[data-article-exit-underlay]';
// The handoff's bound (page_stack.js#HANDOFF_TIMEOUT_MS).
const HANDOFF_TIMEOUT_MS = 5000;

// The board names on the engaged board list in `root`.
const boardsIn = (page, root) => page.locator(`${root} .listCard[data-list-board]`).evaluateAll(
  cards => cards.map(card => card.dataset.listBoard));

// The engaged list shows `board` among its entries.
const listShows = (page, board) => expect.poll(() => boardsIn(page, MAIN)).toContain(board);

// The group's board list opened over the class list, with PTT's reply to any
// leave held.
async function groupOverClassList(page) {
  await bootScenario(page, ptt, folder);
  await ptt.applyPrefs(page, { ...folder.meta.prefs, articleHorizontalGestures: true });
  await boardListEngaged(page);
  await listShows(page, 'OtherBBS');
  await ptt.sendKey(page, 'Enter');
  await listShows(page, 'FPGinPTT');
  await boardListEngaged(page);
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0, { timeout: 10000 });
  await holdLeaves(page);
  const main = await waitRectStable(page, MAIN);
  return { main, y: main.top + main.height / 2 };
}

test('a right swipe past half the screen slides the board list over the list below and goes back on release', async ({ page }) => {
  const { main, y } = await groupOverClassList(page);
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 140, y });
  expect((await waitRectStable(page, MAIN)).left - main.left).toBeCloseTo(120, 0);
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'layer');
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  expect(await boardsIn(page, BOARD_LAYER)).toContain('OtherBBS');
  await contact.move({ x: page.viewportSize().width - 20, y });
  expect(await heldLeaves(page)).toBe(0);
  await contact.release();
  await expect.poll(() => heldLeaves(page)).toBe(1);
  await releaseLeave(page);
  await listShows(page, 'OtherBBS');
  await boardListEngaged(page);
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
});

test('with no page below, the board list slides over the dark fallback and PTT\'s list replaces it at once', async ({ page }) => {
  const { y } = await groupOverClassList(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await expect.poll(() => heldLeaves(page)).toBe(1);
  await releaseLeave(page);
  await listShows(page, 'OtherBBS');
  await boardListEngaged(page);
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  // The class list itself was opened from 分類看板, which is no stacked page.
  await recordHints(page);
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 140, y });
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'fallback');
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.release();
  await expect.poll(() => heldLeaves(page)).toBe(1);
  const released = Date.now();
  await releaseLeave(page);
  // 分類看板 itself shows natively.
  await waitFed(page, folder.steps.length);
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  expect(Date.now() - released).toBeLessThan(HANDOFF_TIMEOUT_MS);
  expect(await page.evaluate(() => window.__app.articleGestures.stack.handingOff)).toBe(false);
  expect(await recordedHints(page)).toEqual([]);
});

const sentCount = page => page.evaluate(() => window.__replay.sent.length);
const sentSince = (page, n) => page.evaluate(n => window.__replay.sent.slice(n), n);

// The list is back in place with nothing revealed.
async function snappedBack(page, main) {
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
  expect((await waitRectStable(page, MAIN)).left).toBeCloseTo(main.left, 0);
}

test('a vertical drag, a swipe to half, a left swipe or the preference turned off never go back', async ({ page }) => {
  const { main, y } = await groupOverClassList(page);
  const width = page.viewportSize().width;
  const x = main.left + main.width / 2;
  const before = await sentCount(page);
  // The group's few boards fit on screen: a vertical drag swipes nothing.
  await touchDrag(page, { x, y: main.top + main.height - 40 }, { x, y: main.top + 60 }, 10);
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
  expect((await waitRectStable(page, MAIN)).left).toBeCloseTo(main.left, 0);

  let contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 20 + width / 2, y });
  await contact.release();
  await snappedBack(page, main);
  // Board lists have no shortcut drawer.
  contact = await beginArticleTouch(page, { x: width - 20, y });
  await contact.move({ x: 20, y });
  await expect(page.locator('[data-article-drawer]')).toHaveCount(0);
  await contact.release();
  await snappedBack(page, main);

  await ptt.applyPrefs(page, { articleHorizontalGestures: false });
  await expect(page.locator(MAIN)).not.toHaveClass(/articleHorizontalGestures/);
  contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: width - 20, y });
  await contact.release();
  await snappedBack(page, main);
  await nextFrames(page, 10);
  expect(await heldLeaves(page)).toBe(0);
  expect(await sentSince(page, before)).toEqual([]);
});
