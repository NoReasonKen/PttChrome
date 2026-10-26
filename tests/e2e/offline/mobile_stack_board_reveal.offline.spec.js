// Back from an article list reveals the page the board was opened from (#31):
// the home dashboard or a board list, usable at once while PTT is asked to go
// back, then replaced by the real page at the same reading position.
const { test, expect } = require('@playwright/test');
const { touchDrag, nextFrames } = require('../helpers/real_input');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { waitScrollStable } = require('../helpers/layout');
const ptt = require('../helpers/ptt');
const { loadCassette, bootScenario, waitFed } = require('../helpers/replay');

const homeBoard = loadCassette('scn-stack-home-board');
const HOME_LAYER = '[data-stack-layer="home"]';
const UNDERLAY = '[data-article-exit-underlay]';

const listActive = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 2 && app.listSession.state === 'active' && app.commandQueue.idle && !app.buf._settleTimer;
});

const dashboardVisible = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.homeDashboard.state.visible === true && app.commandQueue.idle && !app.buf._settleTimer;
});

// Enough favorites for the dashboard to scroll; C_Chat is the recorded board.
const FAVORITES = [{ name: 'C_Chat', desc: 'recorded' }].concat(
  Array.from({ length: 40 }, (_, i) => ({ name: 'Fav' + i, desc: 'favorite ' + i })));

// Hold PTT's reply to the leave until the returned `release()`.
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

// Open C_Chat by tapping its favorite card, as the recording did.
async function enterBoardFromDashboard(page) {
  await bootScenario(page, ptt, homeBoard);
  await page.evaluate((boards) => {
    const home = window.__app.homeDashboard;
    home._state.fetchedAt = Date.now();
    home._set({ boards });
  }, FAVORITES);
  await ptt.applyPrefs(page, homeBoard.meta.prefs);
  await page.evaluate(() => window.__app.onData('\x1b[H'));
  await dashboardVisible(page);
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await page.waitForFunction(() => window.__app.buf.isPassScreenNow() || window.__app.buf.pageState === 2);
  if (await page.evaluate(() => window.__app.buf.isPassScreenNow())) await ptt.sendKey(page, 'Space');
  await listActive(page);
}

test('Back from a board entered from the dashboard reveals the dashboard at once, and it holds its position after the swap', async ({ page }) => {
  await enterBoardFromDashboard(page);
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await expect.poll(() => page.evaluate(() => !!window.__heldBack)).toBe(true);
  const layer = page.locator(HOME_LAYER);
  await expect(layer).toBeVisible();
  await expect(layer.locator('[data-home-board="C_Chat"]')).toBeVisible();
  // The revealed dashboard scrolls while PTT has not answered.
  const box = await layer.boundingBox();
  const x = box.x + box.width / 2;
  await touchDrag(page, { x, y: box.y + box.height - 40 }, { x, y: box.y + 60 }, 10);
  expect(await waitScrollStable(page, HOME_LAYER)).toBeGreaterThan(0);
  const anchor = await page.evaluate(sel => {
    const root = document.querySelector(sel);
    const top = root.getBoundingClientRect().top;
    const card = [...root.querySelectorAll('[data-home-board]')].find(c => c.getBoundingClientRect().bottom > top + 1);
    return { name: card.dataset.homeBoard, offset: card.getBoundingClientRect().top - top };
  }, HOME_LAYER);
  expect(await page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(false);
  await release();
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
  const landed = await page.evaluate(name => {
    const root = document.getElementById('homeDashboard');
    const card = root.querySelector(`[data-home-board="${name}"]`);
    return card.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }, anchor.name);
  expect(Math.abs(landed - anchor.offset)).toBeLessThanOrEqual(1);
  await waitFed(page, homeBoard.steps.length);
});

const boardList = loadCassette('scn-stack-boardlist-board');
const BOARD_LAYER = '[data-stack-layer="boardList"]';

const boardListEngaged = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.listRenderOwner === 'board-list' && app.boardListSession.state === 'active' &&
    app.commandQueue.idle && !app.buf._settleTimer;
});

// The first card at the top of `root`'s view: its board and offset.
const topBoard = (page, root) => page.locator(root).evaluate(el => {
  const top = el.getBoundingClientRect().top;
  const card = [...el.querySelectorAll('.listCard[data-list-board]')].find(c => c.getBoundingClientRect().bottom > top + 1);
  return { board: card.dataset.listBoard, offset: card.getBoundingClientRect().top - top };
});

test('Back from a board entered from a board list reveals that board list at once, at the same entry after the swap', async ({ page }) => {
  await bootScenario(page, ptt, boardList);
  await ptt.applyPrefs(page, { enableEasyReadingList: true, enableBoardListSmoothScroll: true });
  await boardListEngaged(page);
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await expect.poll(() => page.evaluate(() => !!window.__heldBack)).toBe(true);
  const layer = page.locator(BOARD_LAYER);
  await expect(layer).toBeVisible();
  const before = await topBoard(page, BOARD_LAYER);
  const box = await layer.boundingBox();
  const x = box.x + box.width / 2;
  await touchDrag(page, { x, y: box.y + box.height - 40 }, { x, y: box.y + 60 }, 10);
  await waitScrollStable(page, `${BOARD_LAYER} .listBodyView`);
  const scrolled = await topBoard(page, BOARD_LAYER);
  expect(scrolled).not.toEqual(before);
  await release();
  await expect(layer).toHaveCount(0, { timeout: 10000 });
  await boardListEngaged(page);
  const after = await topBoard(page, '.main');
  expect(after.board).toBe(scrolled.board);
  expect(Math.abs(after.offset - scrolled.offset)).toBeLessThanOrEqual(1);
  await waitFed(page, boardList.steps.length);
});

const sentSince = (page, n) => page.evaluate(n => window.__replay.sent.slice(n), n);
const sentCount = page => page.evaluate(() => window.__replay.sent.length);

// Leave the dashboard-entered board with PTT's reply held back.
async function revealDashboard(page) {
  await enterBoardFromDashboard(page);
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await expect.poll(() => page.evaluate(() => !!window.__heldBack)).toBe(true);
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  return release;
}

test('a board reached by search reveals no lower page', async ({ page }) => {
  await bootScenario(page, ptt, homeBoard);
  await page.evaluate((boards) => {
    const home = window.__app.homeDashboard;
    home._state.fetchedAt = Date.now();
    home._set({ boards });
  }, FAVORITES);
  await ptt.applyPrefs(page, homeBoard.meta.prefs);
  await page.evaluate(() => window.__app.onData('\x1b[H'));
  await dashboardVisible(page);
  await page.locator('[data-key="__search"]').tap();
  const input = page.locator('input[name="searchKeyword"]');
  await input.fill('C_Chat');
  await input.press('Enter');
  await page.waitForFunction(() => window.__app.buf.isPassScreenNow() || window.__app.buf.pageState === 2);
  if (await page.evaluate(() => window.__app.buf.isPassScreenNow())) await ptt.sendKey(page, 'Space');
  await listActive(page);
  await page.evaluate(() => {
    window.__revealed = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-stack-layer], [data-article-exit-underlay]')) window.__revealed = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await ptt.sendKey(page, 'ArrowLeft');
  await dashboardVisible(page);
  expect(await page.evaluate(() => window.__revealed)).toBe(false);
});

test('a board tapped on the revealed dashboard opens after the swap', async ({ page }) => {
  const release = await revealDashboard(page);
  const before = await sentCount(page);
  await page.locator(`${HOME_LAYER} [data-home-board="Fav2"]`).tap();
  // The leave itself may still sync PTT's screen; no board search starts.
  expect((await sentSince(page, before)).join('')).not.toContain('s');
  await release();
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  // The dashboard's own open: a board search for the tapped board.
  await expect.poll(async () => (await sentSince(page, before)).join('')).toContain('s');
});

test('the real dashboard never covers the revealed one before the swap', async ({ page }) => {
  const release = await revealDashboard(page);
  const box = await page.locator(HOME_LAYER).boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A finger down defers the swap after the real dashboard is shown.
  const contact = await beginArticleTouch(page, center);
  await release();
  await page.waitForFunction(() => window.__app.homeDashboard.state.visible === true);
  await nextFrames(page, 3);
  const top = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-stack-layer="home"]'), center);
  expect(top).toBe(true);
  await contact.release({ cancel: true });
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
});

// Leave the board-list-entered board with PTT's reply held back.
async function revealBoardList(page) {
  await bootScenario(page, ptt, boardList);
  await ptt.applyPrefs(page, { enableEasyReadingList: true, enableBoardListSmoothScroll: true });
  await boardListEngaged(page);
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await expect.poll(() => page.evaluate(() => !!window.__heldBack)).toBe(true);
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  return release;
}

test('a board tapped on the revealed board list opens after the swap', async ({ page }) => {
  const release = await revealBoardList(page);
  const target = await topBoard(page, BOARD_LAYER);
  const before = await sentCount(page);
  await page.locator(`${BOARD_LAYER} .listCard[data-list-board="${target.board}"] .listCardBody`).tap();
  // The leave itself may still sync PTT's screen; no board opens.
  expect((await sentSince(page, before)).join('')).not.toContain('\r');
  await release();
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect.poll(async () => (await sentSince(page, before)).join('')).toContain('\r');
});

test('a board tapped on the revealed board list but gone from the real one gives a notice and opens nothing', async ({ page }) => {
  const release = await revealBoardList(page);
  const target = await topBoard(page, BOARD_LAYER);
  const card = await page.locator(`${BOARD_LAYER} .listCard[data-list-board="${target.board}"]`).elementHandle();
  // Stand-in for a board removed from the list while it was revealed.
  await card.evaluate(el => { el.dataset.listBoard = 'GoneBoard'; });
  await (await card.$('.listCardBody')).tap();
  await release();
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.ListHint')).toBeVisible();
  const before = await sentCount(page);
  await page.waitForTimeout(1000); // sleep-ok: proves no open is sent afterwards
  expect(await sentSince(page, before)).toEqual([]);
});

test('system Back reveals the dashboard the same way as ←', async ({ page }) => {
  await enterBoardFromDashboard(page);
  const release = await holdBackReply(page);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => !!window.__heldBack)).toBe(true);
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  await release();
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
});
