// Easy-reading gaps (#161): the main-menu areas easy reading presents but does
// not show as its own pages yet. Until a gap is filled it must look the same
// on every visit with easy reading on, so each area is reached from the home
// dashboard twice and must show PTT's native screen both times. The native
// grid guard allows each area under its gap issue
// (tests/e2e/helpers/native_grid_guard.js); filling a gap removes its entry
// here and there.
//
// The areas easy reading does not present at all (#231, docs/easy-reading.md)
// have no entrance: at home their main-menu keys are refused with the "not
// supported" hint, PTT receives nothing and no native grid is painted. The
// mail area's menu is one of them: easy reading presents the mailbox itself
// through the home dashboard's mail entrance (#196,
// mobile_mail_easy_reading.offline.spec.js), not the rest of 私人信件區.
//
// Screens are synthetic: a submenu laid out like mbbsd/menu.c#domenu (title
// from the menu's description).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu, drawMenu } = require('../helpers/main_menu');
const { startCapture, expectOnlyFence } = require('../helpers/capture');

const submenu = (title, items, status) => ({
  title,
  items,
  cursor: 0,
  status: ` ${status}   世界郵政日     10/9 週五 13:31 | someone`,
  right: '(←)回到上層 (h)說明 ',
});

const GAPS = [
  {
    issue: 199, area: 'chat area', key: 't', title: '休閒聊天區',
    draw: (page) => drawMenu(page, submenu('休閒聊天區', ['(U)sers         線上使用者列表', '(Q)uery         查詢網友'], '聊天說話')),
  },
];

// Main-menu areas easy reading does not present (#231), by the item letter
// the main menu shows for each (helpers/main_menu.js MAIN_MENU).
const UNSUPPORTED = [
  { area: '精華公佈欄', key: 'a' },
  { area: '私人信件區', key: 'm', issue: 196 },
  { area: '個人設定區', key: 'u' },
  { area: '系統資訊區', key: 'x' },
  { area: '娛樂與休閒', key: 'p' },
  { area: '編特別名單', key: 'n' },
  { area: '離開，再見', key: 'g' },
];

// One visit: home dashboard on the main menu, the reader's key, then the
// area's screen. Returns how the area was presented.
async function visit(page, gap) {
  await drawMainMenu(page);
  await expect.poll(() => page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(true);
  await page.evaluate(() => window.__nativeGridGuard.reset());
  await page.focus('#t');
  await page.keyboard.press(gap.key);
  await gap.draw(page);
  const found = await page.waitForFunction(
    (title) => window.__nativeGridGuard.hits.find((h) => h.title.includes(title)),
    gap.title
  );
  const hit = await found.jsonValue();
  return { surface: hit.surface, pageState: hit.pageState, listRenderMode: hit.listRenderMode };
}

test.describe('easy-reading gaps look the same on every visit', () => {
  for (const gap of GAPS) {
    test(`the ${gap.area} shows PTT's native screen on every visit (#${gap.issue})`, async ({ page }) => {
      await bootOffline(page, ptt);
      await ptt.applyPrefs(page, { enableEasyReading: true });
      const first = await visit(page, gap);
      const second = await visit(page, gap);
      expect(second).toEqual(first);
      expect(await page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(false);
    });
  }
});

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
