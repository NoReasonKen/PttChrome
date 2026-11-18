// Querying an article's author from the easy-reading article list on the
// desktop (#254): Ctrl-Q on the selected article, and 查詢作者 in a row's
// context menu, move PTT's cursor to that article and send Ctrl-Q
// (read.c#read_cmd_query); PTT's query screen shows as the query page of the
// online user list (#199), and leaving it shows the list again with the same
// article selected. The phone's entrance and its failures are in
// mobile_author_query.offline.spec.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList } = require('../helpers/article_shortcut_search');
const { rightClickElement } = require('../helpers/real_input');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const queryPage = (page) => page.locator('[data-user-query-page]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.userQuery.holding)).toBe(true);
const menuItem = (page, label) =>
  page.locator('.DropdownMenu').first().getByRole('menuitem').filter({ hasText: label });

async function openList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true });
  // No background reads: the keys sent are the query's alone.
  await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await listActive(page);
  // The list's own reads (its edges) end before the keys are counted.
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => window.__app.commandQueue.idle ? window.__gestureSent.length : -1);
    const quiet = n >= 0 && n === last;
    last = n;
    return quiet;
  }, { intervals: [400] }).toBe(true);
}

async function pageShown(page, id) {
  await expect(queryPage(page)).toBeVisible();
  await expect(queryPage(page)).toHaveAttribute('data-user-id', id);
  await page.waitForFunction(() => window.__app.userQuery.phase === 'shown' && window.__app.commandQueue.idle);
  expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('query');
}

test.describe('querying an article\'s author from the article list (desktop)', () => {
  test('Ctrl-Q queries the selected article\'s author; Esc returns with the selection kept', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(103);
    await markSent(page);
    await page.keyboard.press('Control+q');
    await pageShown(page, 'bob');
    expect(await sentSinceMark(page)).toEqual(['103\r', '\x11']);
    await markSent(page);
    await page.keyboard.press('Escape');
    await expect(queryPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await selectedNum(page)).toBe(103);
    expect(await sentSinceMark(page)).toEqual([' ']);
  });

  test('查詢作者 in a row\'s context menu queries that row\'s author', async ({ page }) => {
    await openList(page);
    expect(await selectedNum(page)).toBe(101);
    await rightClickElement(page, 'span[type="bbsrow"][data-list-title*="Delta topic"]');
    const item = menuItem(page, await text(page, 'authorQuery_title'));
    await expect(item).toBeVisible();
    await expect(item).toHaveText(`${await text(page, 'authorQuery_title')} 'bob'`);
    await markSent(page);
    await item.click();
    await pageShown(page, 'bob');
    expect(await sentSinceMark(page)).toEqual(['104\r', '\x11']);
    expect(await selectedNum(page)).toBe(104);
    await page.keyboard.press('Escape');
    await expect(queryPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await selectedNum(page)).toBe(104);
  });
});
