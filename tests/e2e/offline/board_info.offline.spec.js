// Board information on the desktop (#288): `i` / `I` and 看板資訊 in the
// context menu of the easy-reading article list. Either sends PTT's `i`
// (bbs.c#bbs_cmd_config → board.c#b_config), reads every page of its PSB list
// (PgDn until the last item), shows the rows in the app's dialog, and leaves
// PTT's screen with ←. PTT's screen never shows; the list keeps its selection
// and the next key goes to it. A screen the app does not recognise leaves the
// list with a hint. The phone's entrance is in
// mobile_board_info.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js, whose
// board information follows b_config's rows and keys.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, hinted } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');
const { rightClickElement } = require('../helpers/real_input');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const dialog = (page) => page.getByRole('dialog');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const serverSurface = (page) => page.evaluate(() => window.__shortcutServer.state.surface);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.boardInfo.busy)).toBe(true);
const idle = (page) => page.waitForFunction(() => !window.__app.boardInfo.busy && window.__app.commandQueue.idle);
const menuItem = (page, label) =>
  page.locator('.DropdownMenu').first().getByRole('menuitem').filter({ hasText: label });
const rowLabels = (page) => dialog(page).locator('[data-board-info-row] [data-board-info-label]').allTextContents();
const rowValues = (page) => dialog(page).locator('[data-board-info-row] [data-board-info-value]').allTextContents();

async function openList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true });
  // No background reads: the keys sent are the sequence's alone.
  await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await listActive(page);
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => window.__app.commandQueue.idle ? window.__gestureSent.length : -1);
    const quiet = n >= 0 && n === last;
    last = n;
    return quiet;
  }, { intervals: [400] }).toBe(true);
  await recordHints(page);
}

// Every row of the fake's board information, in PTT's order.
async function expectAllRows(page) {
  const labels = await rowLabels(page);
  expect(labels).toHaveLength(30);
  expect(labels[0]).toBe('看板管理紀錄(自動公告)');
  expect(labels[20]).toBe('預設連署限制 (登入/退文)');
  expect(labels[21]).toBe('[名單] 設定禁言名單(水桶)');
  expect(labels[29]).toBe('[紀錄] 看板管理稽核紀錄');
  const values = await rowValues(page);
  expect(values[0]).toBe('(尚無記錄)');
  expect(values[10]).toBe('限制 (間隔 5 秒)');
  expect(values[21]).toBe('[唯讀檢視]');
  expect(values[29]).toBe('(限管理人員)');
}

test.describe('board information on the desktop', () => {
  test('i reads both pages into the dialog; Esc returns to the list with its selection', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(103);
    await markSent(page);
    await page.keyboard.press('i');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(await text(page, 'boardInfo_title'));
    await expect(dialog(page).locator('[data-board-info-field="board"] [data-board-info-value]')).toHaveText('Test');
    await expect(dialog(page).locator('[data-board-info-field="moderators"] [data-board-info-value]')).toHaveText('test');
    await expectAllRows(page);
    await idle(page);
    // No cursor sync: `i` names the board, not a row. PgDn for the second
    // page, ← to leave b_config.
    expect(await sentSinceMark(page)).toEqual(['i', '\x1b[6~', '\x1b[D']);
    expect(await serverSurface(page)).toBe('list');
    await expect(dialog(page).locator('[data-board-info]')).toBeFocused();
    await markSent(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await sentSinceMark(page)).toEqual([]);
    await listActive(page);
    expect(await selectedNum(page)).toBe(103);
    // The next key goes to the list.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(104);
  });

  test('I is the same key', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await page.keyboard.press('Shift+I');
    await expect(dialog(page)).toBeVisible();
    await expectAllRows(page);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['I', '\x1b[6~', '\x1b[D']);
    await page.keyboard.press('Escape');
    await listActive(page);
    expect(await selectedNum(page)).toBe(101);
  });

  test('看板資訊 in the list\'s context menu shows it, wherever the right click was', async ({ page }) => {
    await openList(page);
    await rightClickElement(page, 'span[type="bbsrow"][data-list-title*="Delta topic"]');
    const item = menuItem(page, await text(page, 'boardInfo_title'));
    await expect(item).toBeVisible();
    await markSent(page);
    await item.click();
    await expect(dialog(page)).toBeVisible();
    await expectAllRows(page);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['i', '\x1b[6~', '\x1b[D']);
    // The board's information, not the row's: the selection did not move.
    expect(await selectedNum(page)).toBe(101);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await listActive(page);
  });

  test('PTT draws the list again (no board header): the hint, and nothing else is sent', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.boardInfoFails = true; });
    await markSent(page);
    await page.keyboard.press('i');
    await expect.poll(async () => hinted(page, await text(page, 'boardInfo_unavailable'))).toBe(true);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['i']);
    await expect(dialog(page)).toHaveCount(0);
    await listActive(page);
    expect(await selectedNum(page)).toBe(101);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(102);
  });

  test('a board information screen the app cannot read: ← leaves it, the hint, no dialog', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.boardInfoGarbled = true; });
    await markSent(page);
    await page.keyboard.press('i');
    await expect.poll(async () => hinted(page, await text(page, 'boardInfo_unavailable'))).toBe(true);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['i', '\x1b[D']);
    expect(await serverSurface(page)).toBe('list');
    await expect(dialog(page)).toHaveCount(0);
    await listActive(page);
    expect(await selectedNum(page)).toBe(101);
  });
});
