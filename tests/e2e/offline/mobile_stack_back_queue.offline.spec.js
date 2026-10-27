// A Back made while a revealed page waits for PTT is queued and runs after the
// swap (#34): two quick Backs from an article unwind to the dashboard, each
// level revealed in turn, with no lost or duplicated leave.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, waitFed } = require('../helpers/replay');
const {
  dashboardVisible, bootDashboard, boardOpened, holdLeaves, heldLeaves, releaseLeave, sentLeaves, articleRead
} = require('../helpers/stack_routes');

const homeArticle = loadCassette('scn-stack-home-article-back');
const LIST_LAYER = '[data-stack-layer="articleList"]';
const HOME_LAYER = '[data-stack-layer="home"]';

const pressBack = page => ptt.sendKey(page, 'ArrowLeft');

for (const [name, secondBack, afterLeave] of [
  ['← while the list is revealed', pressBack, true],
  ['system Back while the list is revealed', page => page.goBack(), true],
  ['← during the slide, before the leave is sent', pressBack, false]
]) {
  test(`a second Back by ${name} runs after the swap and reveals the dashboard`, async ({ page }) => {
    await bootDashboard(page, homeArticle);
    await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
    await boardOpened(page);
    for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
    await ptt.sendKey(page, 'Enter');
    await articleRead(page);

    await holdLeaves(page);
    await pressBack(page);
    if (afterLeave) {
      await expect.poll(() => heldLeaves(page)).toBe(1);
      await expect(page.locator(LIST_LAYER)).toBeVisible();
    }
    await secondBack(page);
    await expect.poll(() => heldLeaves(page)).toBe(1);

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
    // One leave per level: the article's over the list, then the list's over
    // the dashboard, sent only after the list took over.
    expect(await sentLeaves(page)).toEqual([['articleList'], ['home']]);
  });
}
