// Stacked-page navigation routes (#25), replayed from real PTT recordings
// (tests/e2e/cassettes/scn-stack-*.json, yarn record:scenarios). These smoke
// tests prove each route replays end to end with today's behavior; the
// stacked-page tickets build on the same material.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootScenario, waitFed } = require('../helpers/replay');

const reopen = loadCassette('scn-stack-article-reopen');
const boardList = loadCassette('scn-stack-boardlist-board');
const homeBoard = loadCassette('scn-stack-home-board');

// Each action waits for the product state the recorder waited for, and for the
// wire to be quiet, as the recording discipline requires.
const listActive = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 2 && app.listSession.state === 'active' && app.commandQueue.idle && !app.buf._settleTimer;
});

const articleRead = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.easyReading.easyReadingReachedPageEnd && app.commandQueue.idle && !app.buf._settleTimer;
});

const dashboardVisible = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.homeDashboard.state.visible === true && app.commandQueue.idle && !app.buf._settleTimer;
});

const boardListEngaged = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.listRenderOwner === 'board-list' && app.commandQueue.idle && !app.buf._settleTimer;
});

test('article list → article → back → the same article again replays end to end', async ({ page }) => {
  await bootScenario(page, ptt, reopen);
  await ptt.applyPrefs(page, { enableEasyReadingList: true });
  await listActive(page);
  for (let round = 0; round < 2; round++) {
    await ptt.sendKey(page, 'Enter');
    await articleRead(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await listActive(page);
  }
  await waitFed(page, reopen.steps.length);
});

test('board list → board → back replays end to end', async ({ page }) => {
  await bootScenario(page, ptt, boardList);
  // Article-list easy reading was already on before recording started; only
  // board-list smooth scrolling was turned on inside the recording.
  await ptt.applyPrefs(page, { enableEasyReadingList: true, enableBoardListSmoothScroll: true });
  await boardListEngaged(page);
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await boardListEngaged(page);
  await waitFed(page, boardList.steps.length);
  expect(await page.evaluate(() => window.__app.buf.listRenderOwner)).toBe('board-list');
});

test('home dashboard → board → back replays end to end', async ({ page }) => {
  await bootScenario(page, ptt, homeBoard);
  // As in the recording: the dashboard's board data counts as fresh, so it
  // does not fetch, and a redraw gives it the settle it shows itself on.
  await page.evaluate(() => { window.__app.homeDashboard._state.fetchedAt = Date.now(); });
  await ptt.applyPrefs(page, homeBoard.meta.prefs);
  await page.evaluate(() => window.__app.onData('\x1b[H'));
  await dashboardVisible(page);
  await page.evaluate(() => window.__app.homeDashboard.openBoard('C_Chat'));
  await page.waitForFunction(() => window.__app.buf.isPassScreenNow() || window.__app.buf.pageState === 2);
  if (await page.evaluate(() => window.__app.buf.isPassScreenNow())) await ptt.sendKey(page, 'Space');
  await listActive(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await dashboardVisible(page);
  await waitFed(page, homeBoard.steps.length);
});
