// Where the board is on the desktop (#293): Ctrl-W / Ctrl-Y (and Alt+W / Alt+Y)
// and 我在哪 in the context menu of the easy-reading article list. Each sends
// PTT's Ctrl-W (bbs.c#whereami), reads the screen it draws (every level of the
// board's class tree and the 位置 path), shows it in the app's dialog and
// answers PTT's pressanykey. PTT's screen never shows; the list keeps its
// selection and the next key goes to it. A board PTT draws nothing for leaves
// the list with a hint. The phone's entrance is in
// mobile_whereami.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js, whose
// 我在哪 screen follows whereami's rows.
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
  window.__app.listSession.state === 'active' && !window.__app.whereAmI.busy)).toBe(true);
const idle = (page) => page.waitForFunction(() => !window.__app.whereAmI.busy && window.__app.commandQueue.idle);
const menuItem = (page, label) =>
  page.locator('.DropdownMenu').first().getByRole('menuitem').filter({ hasText: label });

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

// Every level of the fake's class tree, as PTT printed it, and the path.
async function expectTree(page) {
  const levels = dialog(page).locator('[data-whereami-level]');
  await expect(levels).toHaveCount(3);
  await expect(levels.nth(0).locator('[data-whereami-board]')).toHaveCount(0);
  await expect(levels.nth(0).locator('[data-whereami-description]')).toHaveText('測試 ◎測試分類');
  await expect(levels.nth(1).locator('[data-whereami-board]')).toHaveText('Test_Class');
  await expect(levels.nth(1).locator('[data-whereami-description]')).toHaveText('◎測試子分類');
  await expect(levels.nth(1).locator('[data-whereami-moderators]')).toContainText('classadm');
  await expect(levels.nth(2).locator('[data-whereami-board]')).toHaveText('Test');
  await expect(levels.nth(2).locator('[data-whereami-description]')).toHaveText('測試 ◎Test board');
  await expect(levels.nth(2).locator('[data-whereami-moderators]')).toContainText('test');
  await expect(dialog(page).locator('[data-whereami-path]')).toHaveText('測試 > Test_Class > Test');
}

test.describe('where the board is on the desktop', () => {
  test('Ctrl-W reads the class tree into the dialog; Esc returns to the list with its selection', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(103);
    await markSent(page);
    await page.keyboard.press('Control+w');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(await text(page, 'whereAmI_title'));
    await expectTree(page);
    await idle(page);
    // No cursor sync: Ctrl-W names the board, not a row. A space answers the
    // pressanykey.
    expect(await sentSinceMark(page)).toEqual(['\x17', ' ']);
    expect(await serverSurface(page)).toBe('list');
    await expect(dialog(page).locator('[data-whereami]')).toBeFocused();
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

  for (const [key, bytes] of [['Control+y', '\x19'], ['Alt+KeyW', '\x17'], ['Alt+KeyY', '\x19']]) {
    test(`${key} is the same key and sends its own byte`, async ({ page }) => {
      await openList(page);
      await markSent(page);
      await page.keyboard.press(key);
      await expect(dialog(page)).toBeVisible();
      await expectTree(page);
      await idle(page);
      expect(await sentSinceMark(page)).toEqual([bytes, ' ']);
      await page.keyboard.press('Escape');
      await listActive(page);
      expect(await selectedNum(page)).toBe(101);
    });
  }

  test('我在哪 in the list\'s context menu shows it, wherever the right click was', async ({ page }) => {
    await openList(page);
    await rightClickElement(page, 'span[type="bbsrow"][data-list-title*="Delta topic"]');
    const item = menuItem(page, await text(page, 'whereAmI_title'));
    await expect(item).toBeVisible();
    await markSent(page);
    await item.click();
    await expect(dialog(page)).toBeVisible();
    await expectTree(page);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['\x17', ' ']);
    // The board's place, not the row's: the selection did not move.
    expect(await selectedNum(page)).toBe(101);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await listActive(page);
  });

  test('PTT does nothing (no board): the hint, and nothing else is sent', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.whereAmIFails = true; });
    await markSent(page);
    await page.keyboard.press('Control+w');
    await expect.poll(async () => hinted(page, await text(page, 'whereAmI_unavailable'))).toBe(true);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['\x17']);
    await expect(dialog(page)).toHaveCount(0);
    await listActive(page);
    expect(await selectedNum(page)).toBe(101);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(102);
  });

  test('a screen the app cannot read: the pause is answered, the hint, no dialog', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.whereAmIGarbled = true; });
    await markSent(page);
    await page.keyboard.press('Control+w');
    await expect.poll(async () => hinted(page, await text(page, 'whereAmI_unavailable'))).toBe(true);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['\x17', ' ']);
    expect(await serverSurface(page)).toBe('list');
    await expect(dialog(page)).toHaveCount(0);
    await listActive(page);
    expect(await selectedNum(page)).toBe(101);
  });
});
