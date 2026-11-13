// Easy-reading gaps (#161): the main-menu areas easy reading does not present
// yet. Until a gap is filled it must look the same on every visit with easy
// reading on, so each area is reached from the home dashboard twice and must
// show PTT's native screen both times. The native grid guard allows each area
// under its gap issue (tests/e2e/helpers/native_grid_guard.js); filling a gap
// removes its entry here and there.
//
// Screens are synthetic: a submenu laid out like mbbsd/menu.c#domenu (title
// from the menu's description), a list with the title redraw_title prints.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, waitScreenSettled } = require('../helpers/replay');
const { drawMainMenu, drawMenu, MAIN_MENU } = require('../helpers/main_menu');

// The main menu with PTT's new-mail notice in its title row (menu.c#redraw_title):
// the only state in which the mobile home dashboard shows its mail button.
const MAIN_MENU_NEW_MAIL = { ...MAIN_MENU, title: '主功能表】     你有新信件     【批踢踢實業坊' };

const submenu = (title, items, status) => ({
  title,
  items,
  cursor: 0,
  status: ` ${status}   世界郵政日     10/9 週五 13:31 | someone`,
  right: '(←)回到上層 (h)說明 ',
});

// A list screen: a single-colour title row, a few rows and the footer.
async function drawList(page, title) {
  await page.evaluate((title) => {
    const u2b = (str) =>
      [...str]
        .map((ch) => {
          const c = ch.charCodeAt(0);
          return c < 0x80
            ? ch
            : String.fromCharCode(window.lib.u2bArray[2 * c]) + String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
        })
        .join('');
    const rows = window.__app.buf.rows;
    let d = '\x1b[H\x1b[2J\x1b[1;1H\x1b[7m' + u2b('【' + title + '】') + '\x1b[m';
    for (let i = 1; i <= 3; i++) d += '\x1b[' + (3 + i) + ';1H' + u2b(`   ${i}   項目 ${i}`);
    d += '\x1b[' + rows + ';1H\x1b[7m' + u2b(' 說明 (h)  離開 (←)') + '\x1b[m';
    window.__app.onData(d);
  }, title);
  await waitScreenSettled(page, { 0: title });
}

const GAPS = [
  { issue: 195, area: 'announcement area', key: 'a', title: '精華文章', draw: (page) => drawList(page, '精華文章') },
  {
    issue: 196, area: 'mail', key: 'm', title: '私人信件區',
    draw: (page) => drawMenu(page, submenu('私人信件區', ['(R)ead          我的信箱', '(S)end          站內寄信'], '電子郵件')),
  },
  // The home dashboard's mail button, shown with new mail, goes to the mail list itself.
  { issue: 196, area: 'mail list', tap: '[data-home-mail]', menu: MAIN_MENU_NEW_MAIL, title: '郵件選單', draw: (page) => drawList(page, '郵件選單') },
  {
    issue: 199, area: 'chat area', key: 't', title: '休閒聊天區',
    draw: (page) => drawMenu(page, submenu('休閒聊天區', ['(U)sers         線上使用者列表', '(Q)uery         查詢網友'], '聊天說話')),
  },
  {
    issue: 200, area: 'personal settings', key: 'u', title: '個人設定區',
    draw: (page) => drawMenu(page, submenu('個人設定區', ['(U)Customize    個人化設定', '(I)nfo          設定個人資料與密碼'], '個人設定')),
  },
  {
    issue: 201, area: 'system information area', key: 'x', title: '系統資訊區',
    draw: (page) => drawMenu(page, submenu('系統資訊區', ['(T)Hot Topics   【熱門話題與看板】', '(A)greement     《本站使用者條款》'], '工具程式')),
  },
  {
    issue: 198, area: 'entertainment area', key: 'p', title: '網路遊樂場',
    draw: (page) => drawMenu(page, submenu('網路遊樂場', ['(P)ay         【 量販店 】', '(C)hicken        養雞場'], '休閒遊樂')),
  },
  {
    issue: 197, area: 'special lists', key: 'n', title: '編特別名單',
    draw: (page) => drawMenu(page, submenu('編特別名單', ['(O)verRide      好友名單', '(B)lack         壞人名單'], '名單編輯')),
  },
];

// One visit: home dashboard on the main menu, the reader's key or tap, then
// the area's screen. Returns how the area was presented.
async function visit(page, gap) {
  await (gap.menu ? drawMenu(page, gap.menu) : drawMainMenu(page));
  await expect.poll(() => page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(true);
  await page.evaluate(() => window.__nativeGridGuard.reset());
  if (gap.tap) {
    await page.locator(gap.tap).tap();
  } else {
    await page.focus('#t');
    await page.keyboard.press(gap.key);
  }
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
