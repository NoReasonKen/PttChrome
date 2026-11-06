// Acting on a page shown again from its live layer before PTT has caught up
// (#124). Back reveals the article list's layer while PTT's answer is held
// back: a long press opens the context menu at once, a tap or a menu action is
// remembered (the last one wins) with the progress bar and run once the real
// list takes over, a handoff that times out drops it with a notice, and a
// refresh takes over from it.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootThreadBoard, listActive } = require('../helpers/thread_jump');
const { holdBackReply, heldBack } = require('../helpers/stack_routes');
const { touchDrag } = require('../helpers/real_input');

const MAIN = '.main:not([data-stack-layer])';
const LAYER = '[data-stack-layer]:not([data-stack-parked])';
const UNDERLAY = '[data-article-exit-underlay]';
const SHEET = '[data-sheet="context"]';
const PROGRESS = '.ListLoadingHint';
const OPEN = 600;

// Read article OPEN, opened from its list, then go back with PTT's answer held.
async function backWithHeldAnswer(page) {
  await bootThreadBoard(page, { open: OPEN, size: 620, fromList: true });
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await expect(page.locator(LAYER)).toBeVisible();
  return release;
}

// The layer's card of article `num`.
const layerCard = (page, num) => page.locator(`${LAYER} .listCard`)
  .filter({ has: page.locator('.listCardNum', { hasText: new RegExp(`^${num}$`) }) });

// A touch long press on a card: desktop Chromium's own touch hold sends no
// contextmenu (see mobile_list_cards), so the event the phone sends is made.
const longPress = (page, num) => layerCard(page, num).locator('.listCardBody').evaluate(el => {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('contextmenu', {
    bubbles: true, cancelable: true, pointerType: 'touch', clientX: r.left + 20, clientY: r.top + r.height / 2
  }));
});

const menuItem = (page, key) => page.locator(`${SHEET} [data-cmenu="${key}"]`);
const sentSince = (page, n) => page.evaluate(n => window.__threadSent.slice(n), n);
const sentCount = page => page.evaluate(() => window.__threadSent.length);

test('a long press on a row of the revealed list opens the context menu at once', async ({ page }) => {
  await backWithHeldAnswer(page);
  const before = await sentCount(page);
  await longPress(page, 598);
  await expect(menuItem(page, 'markReadUnread')).toBeVisible();
  await expect(menuItem(page, 'addAuthorBlacklist')).toContainText('filler');
  // A paste would go to the article PTT still shows.
  await expect(menuItem(page, 'paste')).toHaveCount(0);
  expect(await sentSince(page, before)).toEqual([]);
});

const realCard = (page, num) => page.locator(`${MAIN} .listCard`)
  .filter({ has: page.locator('.listCardNum', { hasText: new RegExp(`^${num}$`) }) });

test('a menu action waits with the progress bar and runs on the real list once PTT is ready', async ({ page }) => {
  const release = await backWithHeldAnswer(page);
  await longPress(page, 598);
  await menuItem(page, 'addAuthorBlacklist').click();
  await expect(page.locator(PROGRESS)).toBeVisible();
  await expect(layerCard(page, 598)).toBeVisible();
  await release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await listActive(page);
  await expect(page.locator(PROGRESS)).toBeHidden();
  // The real list hides the blacklisted author's articles.
  await expect(realCard(page, 598)).toHaveCount(0);
  await expect(realCard(page, OPEN)).toHaveCount(1);
});

test('the last action wins: a menu action after a tap replaces it', async ({ page }) => {
  const release = await backWithHeldAnswer(page);
  await layerCard(page, OPEN).locator('.listCardBody').click();
  await longPress(page, 598);
  await menuItem(page, 'addAuthorBlacklist').click();
  await release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await listActive(page);
  await expect(realCard(page, 598)).toHaveCount(0);
  await page.waitForTimeout(500); // sleep-ok: proves the replaced tap opens nothing
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(2);
  await expect(realCard(page, OPEN)).toBeVisible();
});

test('a remembered action is dropped with a notice when PTT is not ready in time', async ({ page }) => {
  await backWithHeldAnswer(page);
  await longPress(page, 598);
  await menuItem(page, 'addAuthorBlacklist').click();
  await expect(page.locator(PROGRESS)).toBeVisible();
  await expect(page.locator('.ListHint')).toContainText('the action was not run', { timeout: 10000 });
  await expect(page.locator(PROGRESS)).toBeHidden();
  await expect(page.locator(LAYER)).toHaveCount(0);
});

// A refresh made while the answer is held, through `refresh`: it waits with
// the progress bar, then refreshes the real list, which shows what PTT changed
// meanwhile instead of the layer's rows.
async function refreshesOnceReady(page, refresh) {
  const release = await backWithHeldAnswer(page);
  await page.evaluate(() => { window.__threadServer.articles[597].score = 55; });
  const before = await sentCount(page);
  await refresh();
  await expect(page.locator(PROGRESS)).toBeVisible();
  expect(await sentSince(page, before)).toEqual([]);
  await release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  // The list's own refresh: `s`, then the board's name at PTT's prompt.
  await expect.poll(async () => (await sentSince(page, before)).join('')).toMatch(/s[^]*Test\r/);
  await expect(realCard(page, 598)).toContainText('55');
  await expect(page.locator(PROGRESS)).toBeHidden();
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(2);
}

test('the toolbar refresh on the revealed list refreshes it once PTT is ready', async ({ page }) => {
  await refreshesOnceReady(page, async () => {
    const button = page.locator('#mobileToolbar [data-key="__refresh"]');
    await expect(button).toBeEnabled();
    await button.tap();
  });
});

test('F5 on the revealed list refreshes it once PTT is ready', async ({ page }) => {
  await refreshesOnceReady(page, async () => {
    await page.evaluate(() => { window.__notReloaded = true; });
    await page.keyboard.press('F5');
  });
  expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
});

test('a pull on the revealed list refreshes it once PTT is ready', async ({ page }) => {
  await refreshesOnceReady(page, async () => {
    const view = page.locator(`${LAYER} .listBodyView`);
    await view.evaluate(el => { el.scrollTop = 0; });
    const r = await view.boundingBox();
    const x = r.x + r.width / 2;
    const y = r.y + 40;
    await touchDrag(page, { x, y }, { x, y: y + 260 });
  });
});

test('a refresh replaces a remembered menu action', async ({ page }) => {
  await refreshesOnceReady(page, async () => {
    await longPress(page, 598);
    await menuItem(page, 'addAuthorBlacklist').click();
    await page.locator('#mobileToolbar [data-key="__refresh"]').tap();
  });
  // The author was not blacklisted: the list still shows the article.
  await expect(realCard(page, 598)).toHaveCount(1);
});
