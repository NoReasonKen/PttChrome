// A Back made while a revealed page waits for PTT is queued and runs after the
// swap (#34): two quick Backs from an article unwind to the dashboard, each
// level revealed in turn, with no lost or duplicated leave.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, waitFed } = require('../helpers/replay');
const { dashboardVisible, bootDashboard, boardOpened } = require('../helpers/stack_routes');

const homeArticle = loadCassette('scn-stack-home-article-back');
const LIST_LAYER = '[data-stack-layer="articleList"]';
const HOME_LAYER = '[data-stack-layer="home"]';

const articleRead = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.easyReading.easyReadingReachedPageEnd && app.commandQueue.idle && !app.buf._settleTimer;
});

// Hold PTT's reply to every leave (←) until released, oldest first.
const holdLeaves = page => page.evaluate(() => {
  const send = window.__stubWSSent;
  window.__heldLeaves = [];
  window.__stubWSSent = data => (data.indexOf('\x1b[D') < 0 ? send(data) : window.__heldLeaves.push(() => send(data)));
});
const heldLeaves = page => page.evaluate(() => window.__heldLeaves.length);
const releaseLeave = page => page.evaluate(() => window.__heldLeaves.shift()());

for (const [name, back] of [
  ['←', page => ptt.sendKey(page, 'ArrowLeft')],
  ['system Back', page => page.goBack()]
]) {
  test(`a second Back by ${name} while the list is revealed runs after the swap and reveals the dashboard`, async ({ page }) => {
    await bootDashboard(page, homeArticle);
    await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
    await boardOpened(page);
    for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
    await ptt.sendKey(page, 'Enter');
    await articleRead(page);

    await holdLeaves(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(LIST_LAYER)).toBeVisible();
    await back(page);
    // Queued, not sent: only the first leave is on its way.
    await page.waitForTimeout(300);
    expect(await heldLeaves(page)).toBe(1);

    await releaseLeave(page);
    // The list takes over, then the queued Back leaves it over the dashboard.
    await expect(page.locator(HOME_LAYER)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(LIST_LAYER)).toHaveCount(0);
    await expect.poll(() => heldLeaves(page)).toBe(1);
    expect(await page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(false);

    await releaseLeave(page);
    await dashboardVisible(page);
    await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
    await waitFed(page, homeArticle.steps.length);
    expect(await heldLeaves(page)).toBe(0);
  });
}
