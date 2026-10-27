// A right swipe on an easy-reading article list goes back like Back (#32): the
// list follows the finger over the page below, and only a committed release
// sends PTT's Back. Real touch input on the recorded C_Chat board.
const { test, expect } = require('@playwright/test');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { cdp, touchDrag, nextFrames } = require('../helpers/real_input');
const { waitRectStable, waitScrollStable } = require('../helpers/layout');
const ptt = require('../helpers/ptt');
const {
  MAIN, bootDashboard, boardOpened, dashboardVisible, holdLeaves, heldLeaves, releaseLeave, recordHints, recordedHints,
  bootBoardList, listActive, boardListEngaged
} = require('../helpers/stack_routes');

// The handoff's bound (page_stack.js#HANDOFF_TIMEOUT_MS).
const HANDOFF_TIMEOUT_MS = 5000;

const HOME_LAYER = '[data-stack-layer="home"]';
const UNDERLAY = '[data-article-exit-underlay]';

// C_Chat opened from the dashboard, with PTT's reply to any leave held.
async function listOverDashboard(page) {
  await bootDashboard(page);
  // Offline boots turn the article gestures off.
  await ptt.applyPrefs(page, { articleHorizontalGestures: true });
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
  await holdLeaves(page);
  const main = await waitRectStable(page, MAIN);
  return { main, y: main.top + main.height / 2 };
}

// A contact through `xs` at `y`, 20 ms per point, released without a pause.
// The contact's times are given at the input boundary, so driver latency
// cannot turn a quick fling into a slow drag.
async function timedSwipe(page, xs, y) {
  const session = await cdp(page);
  const timestamp = Date.now() / 1000;
  const at = (i, type, x) => session.send('Input.dispatchTouchEvent', {
    type, timestamp: timestamp + i * 0.02, touchPoints: x == null ? [] : [{ id: 0, x, y }]
  });
  await at(0, 'touchStart', xs[0]);
  for (let i = 1; i < xs.length; i++) await at(i, 'touchMove', xs[i]);
  await at(xs.length, 'touchEnd');
}

// The list is back in place with nothing revealed.
async function snappedBack(page, main) {
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
  expect((await waitRectStable(page, MAIN)).left).toBeCloseTo(main.left, 0);
}

test('a right swipe past half the screen slides the list over the dashboard and goes back on release', async ({ page }) => {
  const { main, y } = await listOverDashboard(page);
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 140, y });
  expect((await waitRectStable(page, MAIN)).left - main.left).toBeCloseTo(120, 0);
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'layer');
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  await contact.move({ x: page.viewportSize().width - 20, y });
  expect(await heldLeaves(page)).toBe(0);
  await contact.release();
  await expect.poll(() => heldLeaves(page)).toBe(1);
  await releaseLeave(page);
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
});

test('a slow swipe to exactly half the screen snaps back and sends nothing; just past half goes back', async ({ page }) => {
  const { main, y } = await listOverDashboard(page);
  const half = page.viewportSize().width / 2;
  let contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 20 + half, y });
  await contact.release();
  await snappedBack(page, main);
  expect(await heldLeaves(page)).toBe(0);
  contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 22 + half, y });
  await contact.release();
  await expect.poll(() => heldLeaves(page)).toBe(1);
});

test('a quick right fling goes back from a short swipe, and a final left fling cancels a long one', async ({ page }) => {
  const { main, y } = await listOverDashboard(page);
  const width = page.viewportSize().width;
  await timedSwipe(page, [20, 30, 50, width * 0.8, width * 0.8, width * 0.8, width * 0.6, width * 0.4], y);
  await snappedBack(page, main);
  expect(await heldLeaves(page)).toBe(0);
  await timedSwipe(page, [20, 30, 50, 80, 110], y);
  await expect.poll(() => heldLeaves(page)).toBe(1);
});

test('with no page below, the list slides over the dark fallback and PTT\'s page replaces it at once', async ({ page }) => {
  const { y } = await listOverDashboard(page);
  // As for a board reached by a search.
  await page.evaluate(() => window.__app.articleGestures.stack.clear());
  await recordHints(page);
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 140, y });
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'fallback');
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.release();
  await expect.poll(() => heldLeaves(page)).toBe(1);
  const released = Date.now();
  await releaseLeave(page);
  await dashboardVisible(page);
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
  expect(Date.now() - released).toBeLessThan(HANDOFF_TIMEOUT_MS);
  expect(await recordedHints(page)).toEqual([]);
});

test('with no page below a list opened from a board list, the board list replaces the fallback at once', async ({ page }) => {
  await bootBoardList(page);
  await ptt.applyPrefs(page, { articleHorizontalGestures: true });
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  await page.evaluate(() => window.__app.articleGestures.stack.clear());
  await holdLeaves(page);
  await recordHints(page);
  const main = await waitRectStable(page, MAIN);
  const y = main.top + main.height / 2;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.release();
  await expect.poll(() => heldLeaves(page)).toBe(1);
  const released = Date.now();
  await releaseLeave(page);
  await boardListEngaged(page);
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
  expect(Date.now() - released).toBeLessThan(HANDOFF_TIMEOUT_MS);
  expect(await recordedHints(page)).toEqual([]);
});

const sentCount = page => page.evaluate(() => window.__replay.sent.length);
const sentSince = (page, n) => page.evaluate(n => window.__replay.sent.slice(n), n);

// The middle of a card wholly inside the list's viewport.
const visibleCardY = page => page.evaluate(main => {
  const view = document.querySelector(`${main} .listBodyView`).getBoundingClientRect();
  const card = [...document.querySelectorAll(`${main} .listCard .listCardBody`)].map(c => c.getBoundingClientRect())
    .find(r => r.top >= view.top && r.bottom <= view.bottom && r.height > 0);
  return card.top + card.height / 2;
}, MAIN);

test('vertical scrolling and taps keep working; a held contact and a tap ending a horizontal drag swipe and open nothing', async ({ page }) => {
  const { main } = await listOverDashboard(page);
  const x = main.left + main.width / 2;
  await touchDrag(page, { x, y: main.top + main.height - 40 }, { x, y: main.top + 60 }, 10);
  expect(await waitScrollStable(page, `${MAIN} .listBodyView`)).toBeGreaterThan(0);
  await expect(page.locator(UNDERLAY)).toHaveCount(0);

  // A held contact is a long press (its menu: mobile_list_cards): moving on
  // swipes nothing.
  const y = await visibleCardY(page);
  let before = await sentCount(page);
  let contact = await beginArticleTouch(page, { x: 30, y });
  await page.waitForTimeout(500); // sleep-ok: holds the contact past the long-press time
  await contact.move({ x: 250, y });
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
  await contact.release({ cancel: true });

  // A drag that ends on a card opens nothing.
  contact = await beginArticleTouch(page, { x: 30, y });
  await contact.move({ x: 130, y });
  await contact.release();
  await snappedBack(page, main);
  await nextFrames(page, 10);
  expect(await sentSince(page, before)).toEqual([]);

  // An ordinary tap still opens the article.
  await page.touchscreen.tap(x, y);
  await expect.poll(async () => (await sentSince(page, before)).join('')).toContain('\r');
});

test('a left swipe, a second contact and the preference turned off never go back', async ({ page }) => {
  const { main, y } = await listOverDashboard(page);
  const width = page.viewportSize().width;
  const before = await sentCount(page);
  // Lists have no shortcut drawer.
  let contact = await beginArticleTouch(page, { x: width - 20, y });
  await contact.move({ x: 20, y });
  await expect(page.locator('[data-article-drawer]')).toHaveCount(0);
  await contact.release();
  await snappedBack(page, main);
  contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: width - 20, y });
  await contact.second({ x: width - 20, y });
  await contact.release();
  await snappedBack(page, main);
  await ptt.applyPrefs(page, { articleHorizontalGestures: false });
  await expect(page.locator(MAIN)).not.toHaveClass(/articleHorizontalGestures/);
  await timedSwipe(page, [20, 60, 120, width - 20], y);
  await snappedBack(page, main);
  await nextFrames(page, 10);
  expect(await heldLeaves(page)).toBe(0);
  expect(await sentSince(page, before)).toEqual([]);
});
