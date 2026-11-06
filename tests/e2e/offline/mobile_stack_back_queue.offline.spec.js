// Quick Backs (#125): a Back made while PTT still answers an earlier one shows
// the next lower page at once, and PTT follows the Backs in order in the
// background. Two quick Backs from an article show the list, then the
// dashboard, with one leave per level sent in order and none lost or doubled.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, waitFed } = require('../helpers/replay');
const {
  dashboardVisible, bootDashboard, boardOpened, holdLeaves, heldLeaves, releaseLeave, sentLeaves, articleRead
} = require('../helpers/stack_routes');

const homeArticle = loadCassette('scn-stack-home-article-back');
const LIST_LAYER = '[data-stack-layer="articleList"]:not([data-stack-parked])';
const HOME_LAYER = '[data-stack-layer="home"]';

const pressBack = page => ptt.sendKey(page, 'ArrowLeft');
const sentSince = (page, n) => page.evaluate(n => window.__replay.sent.slice(n), n);
const sentCount = page => page.evaluate(() => window.__replay.sent.length);

// Dashboard → C_Chat → an article, each page alive under the next.
async function openArticleFromDashboard(page) {
  await bootDashboard(page, homeArticle);
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
  for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
  await ptt.sendKey(page, 'Enter');
  await articleRead(page);
}

// Two Backs, the second by `secondBack`, with PTT's answer to every leave
// held. Once the second Back is made, the dashboard shows although PTT has
// not answered the first leave yet.
async function twoQuickBacks(page, secondBack, afterLeave) {
  await openArticleFromDashboard(page);
  await holdLeaves(page);
  await pressBack(page);
  if (afterLeave) {
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(LIST_LAYER)).toBeVisible();
  }
  await secondBack(page);
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  await expect(page.locator('[data-stack-layer="articleList"]')).toHaveCount(0);
  await expect.poll(() => heldLeaves(page)).toBe(1);
  expect(await sentLeaves(page)).toHaveLength(1);
}

for (const [name, secondBack, afterLeave] of [
  ['← while the list is revealed', pressBack, true],
  ['system Back while the list is revealed', page => page.goBack(), true],
  ['← during the slide, before the leave is sent', pressBack, false]
]) {
  test(`a second Back by ${name} shows the dashboard at once, and PTT follows both Backs in order`, async ({ page }) => {
    await twoQuickBacks(page, secondBack, afterLeave);

    // PTT answers the first leave with the list: it is sent the second Back
    // at once, while the dashboard stays shown.
    await releaseLeave(page);
    await expect.poll(async () => (await sentLeaves(page)).length).toBe(2);
    await expect(page.locator(HOME_LAYER)).toBeVisible();
    await expect(page.locator('[data-stack-layer="articleList"]')).toHaveCount(0);

    await releaseLeave(page);
    await dashboardVisible(page);
    await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
    await waitFed(page, homeArticle.steps.length);
    // One leave per level, in order: the article's while the list showed, then
    // the list's while the dashboard showed.
    expect(await sentLeaves(page)).toEqual([['articleList'], ['home']]);
  });
}

test('a board tapped on the dashboard while PTT still follows the Backs opens once PTT has caught up', async ({ page }) => {
  await twoQuickBacks(page, pressBack, true);
  const before = await sentCount(page);
  await page.locator(`${HOME_LAYER} [data-home-board="Fav2"]`).tap();
  await releaseLeave(page);
  await expect.poll(async () => (await sentLeaves(page)).length).toBe(2);
  // PTT is still on its way to the main menu: no board search starts yet.
  expect((await sentSince(page, before)).join('')).not.toContain('s');
  await releaseLeave(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  // The dashboard's own open: a board search for the tapped board.
  await expect.poll(async () => (await sentSince(page, before)).join('')).toContain('s');
});

test('a third quick Back on the dashboard, the bottom page, sends PTT nothing more', async ({ page }) => {
  await twoQuickBacks(page, pressBack, true);
  await pressBack(page);
  await releaseLeave(page);
  await expect.poll(async () => (await sentLeaves(page)).length).toBe(2);
  await releaseLeave(page);
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitFed(page, homeArticle.steps.length);
  expect(await sentLeaves(page)).toHaveLength(2);
});
