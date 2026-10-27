// The stack never reveals a page that is no longer the way back (#35). The
// controlled PTT board is helpers/article_shortcut_search.js; the app, touch
// input and Back are real.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const {
  bootNestedShortcutSearch, waitArticle, waitList, tapShortcut, tapCard
} = require('../helpers/article_shortcut_search');
const { loadCassette, waitScreenSettled } = require('../helpers/replay');
const {
  MAIN, dashboardVisible, bootDashboard, boardOpened, holdLeaves, heldLeaves, releaseLeave, articleRead,
  watchReveals, revealedSinceWatch
} = require('../helpers/stack_routes');

const RESULTS = { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] };
const BOARD = { has: ['Alpha topic', 'Delta topic'] };

const pressBack = page => ptt.sendKey(page, 'ArrowLeft');

// Dashboard → board → Alpha, each page alive under the next.
async function openAlphaFromDashboard(page) {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, homeMenu: true });
  // Favorites already fetched: the dashboard fetches nothing from this board.
  await ptt.applyPrefs(page, { enableHomeDashboard: true });
  await page.evaluate(() => {
    const home = window.__app.homeDashboard;
    home._state.fetchedAt = Date.now();
    home._set({ boards: [{ name: 'Test', desc: 'controlled' }] });
  });
  await pressBack(page);
  await waitList(page, BOARD);
  await pressBack(page);
  await waitScreenSettled(page, { 0: '主功能表' });
  await dashboardVisible(page);
  await page.locator('#homeDashboard [data-home-board="Test"]').tap();
  await waitList(page, BOARD);
  // Search return on PTT goes from the results straight to the source article;
  // the controlled board passes the main menu, where the dashboard would
  // start a new base by itself.
  await ptt.applyPrefs(page, { enableHomeDashboard: false });
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
}

test('Back from an article reopened by search return reveals nothing from before the search', async ({ page }) => {
  await openAlphaFromDashboard(page);
  await tapShortcut(page, 'author');
  await waitList(page, RESULTS);
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await pressBack(page);
  await waitList(page, RESULTS);
  await pressBack(page);
  await waitArticle(page, 'Alpha');
  // Alpha was reopened by its code: the dashboard below the board's list is
  // not where Back from it goes.
  await watchReveals(page);
  await pressBack(page);
  await waitList(page, BOARD);
  expect(await revealedSinceWatch(page)).toBe(false);
  expect(await page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(false);
});

test('after a Back that lands somewhere unexpected, the next Back reveals nothing from before', async ({ page }) => {
  await openAlphaFromDashboard(page);
  // PTT answers the Back from Alpha with a prompt; a key then shows the list.
  await page.evaluate(() => {
    const send = window.__stubWSSent;
    let answered = false;
    window.__stubWSSent = data => {
      if (answered || !data.includes('\x1b[D')) return send(data);
      answered = true;
      window.__shortcutServer.state.surface = 'list';
      setTimeout(() => window.__app.onData('\x1b[H\x1b[2J\x1b[24;1H\x1b[1;37;44m 請按任意鍵繼續 \x1b[m'), 300);
    };
  });
  await pressBack(page);
  await page.waitForFunction(() => window.__app.buf.pageState !== 3);
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0, { timeout: 1000 });
  await ptt.sendKey(page, 'Space');
  await waitList(page, BOARD);
  await watchReveals(page);
  await pressBack(page);
  await waitScreenSettled(page, { 0: '主功能表' });
  expect(await revealedSinceWatch(page)).toBe(false);
});

// The first card at the top of an article list's viewport.
const topCardTitle = (page, root) => page.locator(root).evaluate(el => {
  const top = el.getBoundingClientRect().top;
  const card = [...el.querySelectorAll('.listCard')].find(c => c.getBoundingClientRect().bottom > top + 1);
  return card?.dataset.listTitle || null;
});

test('after a width change, the revealed list fits the new width at the same entry', async ({ page }) => {
  await bootDashboard(page, loadCassette('scn-stack-home-article-back'));
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
  const entry = await topCardTitle(page, MAIN);
  for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
  await ptt.sendKey(page, 'Enter');
  await articleRead(page);
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width: width - 60, height });
  // The app lays the screen out again once the resize settles.
  await expect.poll(async () => (await page.locator(MAIN).boundingBox()).width).toBeCloseTo(width - 60, 0);

  await holdLeaves(page);
  await pressBack(page);
  await expect.poll(() => heldLeaves(page)).toBe(1);
  const layer = page.locator('[data-stack-layer="articleList"]');
  await expect(layer).toBeVisible();
  const fit = await layer.evaluate(el => ({ width: el.getBoundingClientRect().width, overflow: el.scrollWidth - el.clientWidth }));
  expect(fit.width).toBeCloseTo(width - 60, 0);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(await topCardTitle(page, '[data-stack-layer="articleList"]')).toBe(entry);

  // The dashboard below follows the new width too.
  await releaseLeave(page);
  await expect(layer).toHaveCount(0, { timeout: 10000 });
  await pressBack(page);
  await expect.poll(() => heldLeaves(page)).toBe(1);
  const home = page.locator('[data-stack-layer="home"]');
  await expect(home).toBeVisible();
  expect((await home.boundingBox()).width).toBeCloseTo(width - 60, 0);
});
