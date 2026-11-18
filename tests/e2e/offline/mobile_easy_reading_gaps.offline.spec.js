// Easy-reading gaps (#161): a main-menu area easy reading presents but does
// not show as its own pages yet would look the same on every visit, as PTT's
// native screen, under an entry of the native grid guard
// (tests/e2e/helpers/native_grid_guard.js). No such gap is left: the mailbox
// (#196, mobile_mail_easy_reading.offline.spec.js) and the online user list
// (#199, mobile_user_list_entry.offline.spec.js) are shown by easy reading
// through the home dashboard's entrances.
//
// The areas easy reading does not present at all (#231, docs/easy-reading.md)
// have no entrance: at home their main-menu keys are refused with the "not
// supported" hint, PTT receives nothing and no native grid is painted. The
// menus of the mail and chat areas are among them: easy reading presents the
// mailbox and the user list themselves, not the rest of 私人信件區 and
// 休閒聊天區.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { startCapture, expectOnlyFence } = require('../helpers/capture');

// Main-menu areas easy reading does not present (#231), by the item letter
// the main menu shows for each (helpers/main_menu.js MAIN_MENU).
const UNSUPPORTED = [
  { area: '精華公佈欄', key: 'a' },
  { area: '私人信件區', key: 'm', issue: 196 },
  { area: '休閒聊天區', key: 't', issue: 199 },
  { area: '個人設定區', key: 'u' },
  { area: '系統資訊區', key: 'x' },
  { area: '娛樂與休閒', key: 'p' },
  { area: '編特別名單', key: 'n' },
  { area: '離開，再見', key: 'g' },
];

test.describe('main-menu areas easy reading does not present have no entrance', () => {
  for (const { area, key, issue = 231 } of UNSUPPORTED) {
    test(`at home the ${area} key is refused and PTT receives nothing (#${issue})`, async ({ page }) => {
      await bootOffline(page, ptt);
      await ptt.applyPrefs(page, { enableEasyReading: true });
      // Favorites fetched just now: home sends nothing of its own while the keys are typed.
      await page.evaluate(() => { window.__app.homeDashboard._state.fetchedAt = Date.now(); });
      await drawMainMenu(page);
      await expect.poll(() => page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(true);
      await page.evaluate(() => window.__nativeGridGuard.reset());
      await page.focus('#t');
      await startCapture(page);
      // A hardware key, its upper case, and the soft keyboard's typed character.
      await page.keyboard.press(key);
      await expect(page.locator('.ListHint')).toContainText('好讀模式目前不支援這個按鍵');
      await page.keyboard.press('Shift+' + key.toUpperCase());
      await page.keyboard.insertText(key);
      // The help key goes out through the same keyboard path, so anything the
      // refused keys sent would show up before it.
      await expectOnlyFence(page, () => page.keyboard.press('h'), 'h', area);
      expect(await page.evaluate(() => window.__nativeGridGuard.hits)).toEqual([]);
      await expect(page.locator('#homeDashboard')).toBeVisible();
    });
  }
});
