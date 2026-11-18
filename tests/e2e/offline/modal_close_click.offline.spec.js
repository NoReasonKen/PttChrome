// A click that closes a modal (here the command palette) must do nothing else:
// the same click used to reach the terminal behind it, because Mantine closes on
// the overlay's mousedown and App.mouse_click then saw no modal (#259).
// Real mouse input is the only way to produce the mousedown -> click sequence.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, waitScreenSettled } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { waitRectStable } = require('../helpers/layout');
const { drawFavorites } = require('../helpers/home_screens');
const { startCapture, peekCapture, takeCapture, expectOnlyFence } = require('../helpers/capture');

const MOUSE_PREFS = { useMouseBrowsing: true, mouseLeftClick: true };
const paletteInput = (page) => page.locator('input[name="commandPaletteQuery"]');

async function openPaletteAndClickOutside(page) {
  await page.keyboard.press('F4');
  await expect(paletteInput(page)).toBeFocused();
  await waitRectStable(page, '.mantine-Modal-content');
  const box = await page.locator('.mantine-Modal-content').boundingBox();
  const viewport = page.viewportSize();
  // Below the palette (it sits at the top), on the overlay.
  const y = Math.min(viewport.height - 20, box.y + box.height + 200);
  await page.mouse.click(Math.round(viewport.width / 2), y);
  await expect(paletteInput(page)).toHaveCount(0);
}

async function bootOnList(page) {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: false, ...MOUSE_PREFS });
  await page.evaluate(() => {
    const u2b = (str) => {
      let out = '';
      for (const ch of str) {
        const c = ch.charCodeAt(0);
        if (c < 0x80) { out += ch; continue; }
        out += String.fromCharCode(window.lib.u2bArray[2 * c]) + String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
      }
      return out;
    };
    let d = '\x1b[2J';
    d += '\x1b[1;1H\x1b[7m' + u2b('【板主：test】看板《Test》'.padEnd(80)) + '\x1b[0m';
    d += '\x1b[3;1H\x1b[7m' + u2b('  編號    日 期 作  者       文  章  標  題'.padEnd(70)) + '\x1b[0m';
    for (let i = 0; i < 18; ++i) d += '\x1b[' + (4 + i) + ';1H' + u2b(String(1233 + i).padStart(7) + ' + 5 9/01 testuser     □[閒聊] 測試' + i);
    d += '\x1b[24;1H' + u2b(' 文章選讀  (y)回應(X)推文(^X)轉錄 ');
    window.__app.onData(d);
  });
  await waitScreenSettled(page, { 2: '編號', 23: '文章選讀' });
  await page.evaluate(() => window.__app.setInputAreaFocus());
  await startCapture(page);
}

test.describe('closing a modal by clicking outside it', () => {
  test('home dashboard: the closing click sends nothing to PTT', async ({ page }) => {
    await bootOffline(page, ptt);
    await ptt.applyPrefs(page, MOUSE_PREFS);
    await page.evaluate(() => window.__app.setInputAreaFocus());
    await startCapture(page);
    await drawMainMenu(page);
    await expect(page.locator('#homeDashboard')).toBeVisible();
    await expect.poll(() => peekCapture(page)).toContain('\x1af');
    await drawFavorites(page, [{ name: 'Stock', desc: '[股票] 今天漲了', unread: false }]);
    await expect.poll(() => peekCapture(page)).toContain('q');
    await takeCapture(page);
    await drawMainMenu(page);
    await expect(page.locator('[data-home-board]')).toHaveCount(1);

    await openPaletteAndClickOutside(page);
    // Anything the click sent would show up before the fence.
    await expectOnlyFence(page, () => page.keyboard.press('h'), 'h');
  });

  test('article list (easy reading off, mouse browsing on): the closing click sends nothing', async ({ page }) => {
    await bootOnList(page);

    await openPaletteAndClickOutside(page);
    await expectOnlyFence(page, () => page.keyboard.press('h'), 'h');
  });

  test('settings modal over the article list: the closing click sends nothing', async ({ page }) => {
    await bootOnList(page);
    await page.locator('#BBSWindow').click({ button: 'right', position: { x: 40, y: 20 } });
    await page
      .locator('.DropdownMenu')
      .first()
      .getByText(await page.evaluate(() => window.__i18n('cmenu_settings')), { exact: true })
      .click();
    await expect(page.locator('.PrefModal')).toBeVisible();
    await waitRectStable(page, '.mantine-Modal-content');
    const box = await page.locator('.mantine-Modal-content').boundingBox();
    const viewport = page.viewportSize();
    await page.mouse.click(Math.max(2, Math.round(box.x / 2)), Math.round(viewport.height / 2));
    await expect(page.locator('.PrefModal')).toHaveCount(0);
    // Closing the settings page redraws the screen itself (^L); a leaked click
    // would add its own bytes to that.
    await expectOnlyFence(page, () => page.keyboard.press('h'), '\x0ch');
  });
});
