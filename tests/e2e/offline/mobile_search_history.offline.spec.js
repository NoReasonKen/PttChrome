// 搜尋紀錄（#70）在手機上的完整流程：搜尋紀錄區的版面、從設定打開管理視窗、釘選後
// 搜尋紀錄區的順序跟著變。只在 offline-mobile project 跑（Pixel 7 模擬）。
//
// unit（search_history.test.js／search_modal.test.jsx／search_history_manager.test.jsx）
// 守資料模型與元件；這裡守 unit 摸不到的：真的版面（三行高、26px 按鈕、框內捲動且
// 捲軸一直在；長關鍵字不把管理頁撐寬）、設定裡一層層蓋上去的管理頁、系統返回只退一層。
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');

const byKey = (page, k) => page.locator(`[data-key="${k}"]`);
const sheet = (page, k) => page.locator(`[data-sheet="${k}"]`);
const historyItems = (page) =>
  sheet(page, 'search').locator('[data-search-history-item]');

async function bootMenu(page, boards) {
  await bootOffline(page, ptt);
  // 主選單上的搜尋只有看板一類。
  await page.evaluate(async (texts) => {
    const { rememberSearch } = await import('/src/js/search_history.js');
    texts.forEach((t) => rememberSearch('board', t));
  }, boards);
  await drawMainMenu(page);
}

async function collectSent(page) {
  await page.evaluate(() => {
    window.__sent = [];
    window.__stubWSSent = (s) => window.__sent.push(s);
  });
}
const sentText = (page) => page.evaluate(() => (window.__sent || []).join(''));

// 看板搜尋一打開就在背景開原生 `s` prompt（board_search_bridge.js）：替 PTT 畫出那個
// prompt，否則「搜尋中」的閘門要等逾時才放開。
async function openSearch(page) {
  await collectSent(page);
  await byKey(page, '__search').tap();
  await expect(sheet(page, 'search')).toBeVisible();
  await expect.poll(() => sentText(page)).toContain('s');
  await page.evaluate(async () => {
    const { u2b } = await import('/src/js/string_util.js');
    window.__app.onData(
      '\x1b[2J\x1b[1;1H\x1b[7m' + u2b('【 選擇看板 】') + '\x1b[m' +
        '\x1b[2;1H' + u2b('請輸入看板名稱(按空白鍵自動搜尋): ') +
        '\x1b[30;47m' + ' '.repeat(20) + '\x1b[m\x1b[2;35H'
    );
  });
  await expect(sheet(page, 'search').locator('[data-board-suggest="ready"]')).toHaveCount(1);
}

// Esc 送 Ctrl-C 收掉背景的 prompt：替 PTT 回到主選單那一幀。
async function closeSearch(page) {
  await page.keyboard.press('Escape');
  await expect(sheet(page, 'search')).toHaveCount(0);
  await expect.poll(() => sentText(page)).toContain('\x03');
  await drawMainMenu(page);
  await expect.poll(() => page.evaluate(() => window.__app.searchInFlight)).toBe(false);
}

test.describe('手機：搜尋紀錄', () => {
  test('搜尋紀錄區：全部顯示、按鈕 26px；超過三行固定三行高，框內捲動，捲軸一直在', async ({ page }) => {
    const boards = Array.from({ length: 10 }, (_, i) => 'Board' + String(i).padStart(2, '0') + 'Long');
    await bootMenu(page, boards);
    await openSearch(page);
    await expect(historyItems(page)).toHaveCount(10);
    const box = await historyItems(page).first().boundingBox();
    expect(Math.round(box.height)).toBe(26);
    const area = sheet(page, 'search').locator('.searchHistoryArea');
    const viewport = area.locator('.mantine-ScrollArea-viewport');
    const m = await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return { client: el.clientHeight, scroll: el.scrollHeight, top: el.scrollTop };
    });
    expect(m.client).toBe(3 * 26 + 2 * 8);
    expect(m.scroll).toBeGreaterThan(m.client);
    expect(m.top).toBeGreaterThan(0);
    // 沒在滑也看得到捲軸（手機原生捲軸只在滑動時閃一下）。
    await page.waitForTimeout(1500); // sleep-ok: outlasts Mantine's 1s scrollbar auto-hide; the assertion is that it never hides
    await expect(area.locator('.mantine-ScrollArea-scrollbar[data-orientation="vertical"]')).toBeVisible();
    await area.screenshot({ path: test.info().outputPath('search-history-area.png') });
  });

  test('從本機設定點進管理頁，釘選後搜尋紀錄區把它排到最前面；系統返回只退回本機設定', async ({ page }) => {
    const long = 'VeryLongKeyword'.repeat(8);
    await bootMenu(page, ['Gossiping', 'C_Chat', 'Steam', long]);
    await openSearch(page);
    await expect(historyItems(page)).toHaveText([long, 'Steam', 'C_Chat', 'Gossiping']);
    await closeSearch(page);

    const settings = page.locator('.PrefModal');
    await byKey(page, '__more').tap();
    await byKey(page, '__settings').tap();
    await expect(settings).toBeVisible();
    await settings.locator('[data-pref-category="local"]').tap();
    await settings.locator('[data-pref-subpage="searchHistory"]').tap();
    const manager = settings.locator('[data-search-history-manager]');
    await expect(manager).toBeVisible();
    // 頂端的返回換成這一頁的名字（同分類頁的「< 本機設定」）。
    await expect(settings.locator('[data-pref-subpage-back]')).toBeVisible();
    // 「設回預設值」是整個設定的，不放在這一頁底下。
    const reset = settings.locator('.PrefModal__Grid__Col--right__Reset');
    await expect(reset).toHaveCount(0);
    const boardId = await manager.locator('input[value="board"]').getAttribute('id');
    await manager.locator(`label[for="${boardId}"]`).tap();
    // 長關鍵字在自己的框裡左右捲：頁面不變寬，右邊的次數不被蓋住。
    const right = settings.locator('.PrefModal__Grid__Col--right');
    const widths = await right.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    const longRow = manager.locator(`[data-manager-entry="${long}"]`);
    const textBox = await longRow.locator('[data-manager-text]').boundingBox();
    const usesBox = await longRow.locator('[data-manager-uses]').boundingBox();
    expect(textBox.x + textBox.width).toBeLessThanOrEqual(usesBox.x);
    await expect(longRow.locator('.mantine-ScrollArea-scrollbar[data-orientation="horizontal"]')).toBeVisible();

    await manager.locator('[data-manager-entry="Gossiping"] [data-manager-text]').tap();
    // 工具列五顆按鈕排在同一行（中文、英文都塞得下）。
    const actionTops = await manager
      .locator('[data-manager-action]')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(actionTops).toHaveLength(5);
    expect(new Set(actionTops).size).toBe(1);
    await manager.locator('[data-manager-action="pin"]').tap();
    await expect(
      manager.locator('[data-manager-section="pinned"] [data-manager-entry]'),
    ).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('search-history-manager.png'), fullPage: true });

    await page.waitForFunction(() => !!(window.history.state && window.history.state.pttchromeBackGuard));
    await page.goBack();
    await expect(manager).toHaveCount(0);
    await expect(settings.locator('[data-pref-subpage="searchHistory"]')).toBeVisible();
    await expect(reset).toHaveCount(1);
    await collectSent(page);
    await settings.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(settings).toBeHidden();
    // 關設定會向 PTT 要一次重畫（Ctrl-L）：等它真的送出，再替 PTT 回那一幀。
    await expect.poll(() => sentText(page)).toContain('\x0c');
    await drawMainMenu(page);

    await openSearch(page);
    await expect(historyItems(page)).toHaveText(['Gossiping', long, 'Steam', 'C_Chat']);
    await expect(historyItems(page).first()).toHaveAttribute('data-variant', 'light');
    await expect(historyItems(page).nth(1)).toHaveAttribute('data-variant', 'default');
  });
});
