// Back from an article list reveals the page the board was opened from (#31):
// the home dashboard or a board list, usable at once while PTT is asked to go
// back, then replaced by the real page at the same reading position.
const { test, expect } = require('@playwright/test');
const { touchDrag } = require('../helpers/real_input');
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
