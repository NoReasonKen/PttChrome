// #251: a desktop right-click on the home dashboard opens the app's context menu (it renders in
// #cmenuReact, outside #BBSWindow where the handler used to live), so Settings is reachable from home.
// Links and text fields on the dashboard keep the browser's menu. Real right-clicks only: whether the
// event reaches the handler and whether it is defaultPrevented are browser facts.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { drawFavorites } = require('../helpers/home_screens');
const { startCapture, peekCapture, takeCapture } = require('../helpers/capture');
const { waitRectStable } = require('../helpers/layout');
const { recordContextMenu, lastContextMenu } = require('../helpers/real_input');

const FAVS = [{ name: 'C_Chat', desc: '[希洽] 閒聊', unread: true }];
const label = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const menu = (page) => page.locator('.DropdownMenu').first();

async function bootHome(page) {
  await bootOffline(page, ptt, { favoritesFetch: true });
  await page.evaluate(() => window.__app.setInputAreaFocus());
  await startCapture(page);
  await drawMainMenu(page);
  await expect(page.locator('#homeDashboard')).toBeVisible();
  await expect.poll(() => peekCapture(page)).toContain('\x1af');
  await drawFavorites(page, FAVS);
  await expect.poll(() => peekCapture(page)).toContain('q');
  await takeCapture(page);
  await drawMainMenu(page);
  await expect(page.locator('[data-home-board]')).toHaveCount(1);
  await recordContextMenu(page);
}

async function rightClickAt(page, selector, pos) {
  await waitRectStable(page, selector);
  const box = await page.locator(selector).boundingBox();
  const x = box.x + (pos ? pos.x : box.width / 2);
  const y = box.y + (pos ? pos.y : box.height / 2);
  await page.mouse.click(x, y, { button: 'right' });
}

test.describe('home dashboard context menu', () => {
  test('right-click on empty dashboard space opens the app menu; Settings opens', async ({ page }) => {
    await bootHome(page);
    await rightClickAt(page, '#homeDashboard', { x: 6, y: 6 });
    const ev = await lastContextMenu(page);
    expect(ev.isTrusted).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    await expect(menu(page)).toBeVisible();
    await menu(page).getByText(await label(page, 'cmenu_settings'), { exact: true }).click();
    await expect(page.locator('.PrefModal')).toBeVisible();
  });

  test('right-click on a board tile opens the app menu', async ({ page }) => {
    await bootHome(page);
    await rightClickAt(page, '[data-home-board="C_Chat"]');
    expect((await lastContextMenu(page)).defaultPrevented).toBe(true);
    await expect(menu(page)).toBeVisible();
  });

  test('right-click on a dashboard link or text input keeps the browser menu', async ({ page }) => {
    await bootHome(page);
    await page.evaluate(() => {
      const host = document.querySelector('#homeDashboard .homeInner');
      host.insertAdjacentHTML(
        'beforeend',
        '<a id="probeLink" href="https://example.com/" style="display:block;padding:8px">link</a>' +
          '<input id="probeInput" style="display:block;width:160px">'
      );
    });
    for (const sel of ['#probeLink', '#probeInput']) {
      await rightClickAt(page, sel);
      const ev = await lastContextMenu(page);
      expect(ev.defaultPrevented, sel).toBe(false);
      await expect(page.locator('.DropdownMenu')).toHaveCount(0);
    }
  });

  test('a click elsewhere on the dashboard closes the menu; a right-click moves it; Escape closes it', async ({ page }) => {
    await bootHome(page);
    await rightClickAt(page, '#homeDashboard', { x: 6, y: 6 });
    await expect(menu(page)).toBeVisible();
    await page.mouse.click(700, 500);
    await expect(page.locator('.DropdownMenu')).toHaveCount(0);

    await rightClickAt(page, '#homeDashboard', { x: 6, y: 6 });
    await expect(menu(page)).toBeVisible();
    const first = await menu(page).boundingBox();
    await rightClickAt(page, '#homeDashboard', { x: 700, y: 300 });
    await expect(menu(page)).toBeVisible();
    await expect
      .poll(async () => (await menu(page).boundingBox()).x)
      .not.toBe(first.x);

    await page.keyboard.press('Escape');
    await expect(page.locator('.DropdownMenu')).toHaveCount(0);
  });

  test('home offers no select all (it would select the hidden terminal grid)', async ({ page }) => {
    await bootHome(page);
    await rightClickAt(page, '#homeDashboard', { x: 6, y: 6 });
    await expect(menu(page)).toBeVisible();
    await expect(
      menu(page).getByRole('menuitem').filter({ hasText: await label(page, 'cmenu_selectAll') })
    ).toHaveCount(0);
    await expect(menu(page).getByText(await label(page, 'cmenu_settings'), { exact: true })).toBeVisible();
  });
});
