// Back from an article list reveals the page the board was opened from (#31):
// the home dashboard or a board list, usable at once while PTT is asked to go
// back, then replaced by the real page at the same reading position.
const { test, expect } = require('@playwright/test');
const { touchDrag, nextFrames } = require('../helpers/real_input');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { waitScrollStable, installPaintedFrameProbe } = require('../helpers/layout');
const ptt = require('../helpers/ptt');
const { loadCassette, waitFed } = require('../helpers/replay');
const {
  fedBefore, openNextArticle, holdBackReply, heldBack, homeBoard, boardList, listActive, dashboardVisible, bootDashboard, boardOpened,
  boardListEngaged, bootBoardList
} = require('../helpers/stack_routes');

const HOME_LAYER = '[data-stack-layer="home"]';
const UNDERLAY = '[data-article-exit-underlay]';

// Open C_Chat by tapping its favorite card, as the recording did.
async function enterBoardFromDashboard(page, cassette = homeBoard) {
  await bootDashboard(page, cassette);
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
}

// Leave the dashboard-entered board with PTT's reply held back.
async function revealDashboard(page, leave = () => ptt.sendKey(page, 'ArrowLeft')) {
  await enterBoardFromDashboard(page);
  const release = await holdBackReply(page);
  await leave();
  await heldBack(page);
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  return release;
}

test('Back from a board entered from the dashboard reveals the dashboard at once, and it holds its position after the swap', async ({ page }) => {
  const release = await revealDashboard(page);
  const layer = page.locator(HOME_LAYER);
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

const BOARD_LAYER = '[data-stack-layer="boardList"]';

// The first card at the top of `root`'s view: its board and offset.
const topBoard = (page, root) => page.locator(root).evaluate(el => {
  const top = el.getBoundingClientRect().top;
  const card = [...el.querySelectorAll('.listCard[data-list-board]')].find(c => c.getBoundingClientRect().bottom > top + 1);
  return { board: card.dataset.listBoard, offset: card.getBoundingClientRect().top - top };
});

// Leave the board-list-entered board with PTT's reply held back.
async function revealBoardList(page) {
  await bootBoardList(page);
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  return release;
}

test('Back from a board entered from a board list reveals that board list at once, at the same entry after the swap', async ({ page }) => {
  const release = await revealBoardList(page);
  const layer = page.locator(BOARD_LAYER);
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

test('a board reached by search reveals no lower page', async ({ page }) => {
  await bootDashboard(page);
  await page.locator('[data-key="__search"]').tap();
  const input = page.locator('input[name="searchKeyword"]');
  await input.fill('C_Chat');
  await input.press('Enter');
  await boardOpened(page);
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

// Tap Fav2 on the revealed dashboard; once the real one is shown (a finger
// holds the swap), change it with `alter`, then swap.
async function tapRevealedThen(page, alter) {
  const release = await revealDashboard(page);
  const fav = page.locator(`${HOME_LAYER} [data-home-board="Fav2"]`);
  await fav.tap();
  const box = await fav.boundingBox();
  const contact = await beginArticleTouch(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await release();
  await page.waitForFunction(() => window.__app.homeDashboard.state.visible === true);
  await page.evaluate(alter);
  const before = await sentCount(page);
  await contact.release({ cancel: true });
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  return before;
}

test('a board tapped on the revealed dashboard but gone from the real one gives a notice and opens nothing', async ({ page }) => {
  const before = await tapRevealedThen(page, () => {
    const home = window.__app.homeDashboard;
    home._set({ boards: home.state.boards.filter(b => b.name !== 'Fav2') });
  });
  await expect(page.locator('.ListHint')).toHaveText('That board is no longer in the list');
  await page.waitForTimeout(1000); // sleep-ok: proves no board search is sent afterwards
  expect((await sentSince(page, before)).join('')).not.toContain('s');
});

test('a board tapped on the revealed dashboard while the real one is updating says so and opens nothing', async ({ page }) => {
  const before = await tapRevealedThen(page, () => window.__app.homeDashboard._set({ fetching: true }));
  await expect(page.locator('.ListHint')).toHaveText('Updating…');
  await page.waitForTimeout(1000); // sleep-ok: proves no board search is sent afterwards
  expect((await sentSince(page, before)).join('')).not.toContain('s');
});

test('the real dashboard never covers the revealed one before the swap', async ({ page }) => {
  const release = await revealDashboard(page);
  const box = await page.locator(HOME_LAYER).boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A finger down defers the swap after the real dashboard is shown.
  const contact = await beginArticleTouch(page, center);
  // Every painted frame until the copy is gone shows the copy on top.
  await installPaintedFrameProbe(page);
  await page.evaluate(({ x, y }) => {
    window.__covered = 0;
    window.__realFrames = 0;
    const sample = () => {
      if (!document.querySelector('[data-stack-layer="home"]')) return window.__paintedFrame.remove(sample);
      if (!window.__app.homeDashboard.state.visible) return;
      window.__realFrames += 1;
      if (!document.elementFromPoint(x, y)?.closest('[data-stack-layer="home"]')) window.__covered += 1;
    };
    window.__paintedFrame.add(sample);
  }, center);
  await release();
  await page.waitForFunction(() => window.__app.homeDashboard.state.visible === true);
  await nextFrames(page, 3);
  await contact.release({ cancel: true });
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  expect(await page.evaluate(() => window.__realFrames)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__covered)).toBe(0);
});

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
  await expect(page.locator('.ListHint')).toHaveText('That board is no longer in the list');
  const before = await sentCount(page);
  await page.waitForTimeout(1000); // sleep-ok: proves no open is sent afterwards
  expect(await sentSince(page, before)).toEqual([]);
});

test('system Back reveals the dashboard the same way as ←', async ({ page }) => {
  const release = await revealDashboard(page, () => page.goBack());
  await release();
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
});

const homeNext = loadCassette('scn-stack-home-next');

const articleRead = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.easyReading.easyReadingReachedPageEnd && app.commandQueue.idle && !app.buf._settleTimer;
});

// Back from the full list reveals the dashboard, which takes over after the swap.
async function backRevealsDashboard(page, cassette) {
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  await release();
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitFed(page, cassette.steps.length);
}

test('after switching to the next article, its list still reveals the dashboard', async ({ page }) => {
  await enterBoardFromDashboard(page, homeNext);
  for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
  await ptt.sendKey(page, 'Enter');
  await articleRead(page);
  await openNextArticle(page, homeNext);
  await articleRead(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitFed(page, fedBefore(homeNext, 'back', 2));
  await listActive(page);
  await backRevealsDashboard(page, homeNext);
});
