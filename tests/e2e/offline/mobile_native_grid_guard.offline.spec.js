// The native grid guard installed by installReplay (tests/e2e/helpers/native_grid_guard.js):
// with easy reading on and past login, a frame drawn on PTT's grid is a hit;
// before login or with easy reading off, the grid is the expected presentation.
// The first three read the page's record, so the guard records without failing.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { nativeGridJudged } = require('../helpers/native_grid_guard');
const { drawMainMenu, drawPressAnyKey } = require('../helpers/main_menu');

const hits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);

test.describe('native grid guard', () => {
  test('a pause screen after the main menu under easy reading is a hit', async ({ page }) => {
    await bootOffline(page, ptt, { nativeGridGuard: 'off' });
    await ptt.applyPrefs(page, { enableEasyReading: true });
    await drawMainMenu(page);
    await expect.poll(() => page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(true);
    // The main menu's first frame paints before the dashboard covers it (an
    // inventory finding of #186); this test checks the guard's own judgement.
    await page.evaluate(() => window.__nativeGridGuard.reset());

    await drawPressAnyKey(page);
    await expect.poll(() => hits(page)).toEqual([
      expect.objectContaining({ surface: 'grid', pageState: 5, title: 'some screen' }),
    ]);
  });

  test('the same screen with easy reading off is not a hit', async ({ page }) => {
    await bootOffline(page, ptt, { nativeGridGuard: 'off' });
    await ptt.applyPrefs(page, { enableEasyReading: false });
    await drawMainMenu(page);
    await drawPressAnyKey(page);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await hits(page)).toEqual([]);
  });

  test('a grid screen before login is not a hit', async ({ page }) => {
    await bootOffline(page, ptt, { nativeGridGuard: 'off' });
    await ptt.applyPrefs(page, { enableEasyReading: true });
    await drawPressAnyKey(page);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => window.__nativeGridGuard.loggedIn)).toBe(false);
    expect(await hits(page)).toEqual([]);
  });

  // The default on offline-mobile: a hit outside the allowed list fails the test.
  test('an unallowed hit fails the test', async ({ page }) => {
    test.fail();
    await bootOffline(page, ptt);
    await ptt.applyPrefs(page, { enableEasyReading: true });
    await drawMainMenu(page);
    await expect.poll(() => page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(true);
    const judged = nativeGridJudged(page, (hit) => hit.title === 'some screen');
    await drawPressAnyKey(page);
    await judged;
  });
});
