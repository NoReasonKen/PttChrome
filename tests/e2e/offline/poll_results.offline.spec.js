// The poll results on the desktop (#301): `R` and 投票結果 in the context menu
// of the easy-reading article list. Either sends PTT's `R` (bbs.c#bbs_cmd_poll_results
// → poll.c#poll_results: more(results, YEA), a pmore page with its footer
// prompt) and shows PTT's own screen on the page of the board entry screen
// (#292), where keys reach PTT as typed (paging) and ←, Esc and q leave; PTT
// draws the list with no pressanykey, so leaving sends the pager's ← alone.
// A board without results makes PTT wait in a vmsg banner over the list: the
// app reads its message, sends the one key it waits for and shows the message
// as a hint, no page. The shapes are derived from the pttbbs source; no real
// result screen has been seen. The phone's entrance is in
// mobile_poll_results.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, hinted } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');
const { rightClickElement } = require('../helpers/real_input');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const pollPage = (page) => page.locator('[data-board-notes-page]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const serverSurface = (page) => page.evaluate(() => window.__shortcutServer.state.surface);
const setPoll = (page, fields) => page.evaluate((f) => Object.assign(window.__shortcutServer.state, f), fields);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.pollResults.busy)).toBe(true);
const menuItem = (page, label) =>
  page.locator('.DropdownMenu').first().getByRole('menuitem').filter({ hasText: label });

async function openList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true });
  // No background reads: the keys sent are the entry screen's alone.
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

// The page shows PTT's screen and has finished sliding in.
async function pageShown(page) {
  await expect(pollPage(page)).toBeVisible();
  await page.waitForFunction(() => window.__app.pollResults.phase === 'shown' &&
    document.querySelector('[data-board-notes-page]').getAnimations().length === 0);
}

// Back on the list: the page is gone, PTT shows the list, the selection is
// where it was and the next key goes to the list.
async function backOnList(page, num) {
  await expect(pollPage(page)).toHaveCount(0);
  await listActive(page);
  expect(await serverSurface(page)).toBe('list');
  expect(await selectedNum(page)).toBe(num);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedNum(page)).toBe(num + 1);
}

test.describe('the poll results on the desktop', () => {
  test('R shows the results page by page; Esc leaves with the pager\'s ← and the list is back', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(103);
    await markSent(page);
    await page.keyboard.press('R');
    await pageShown(page);
    expect(await sentSinceMark(page)).toEqual(['R']);
    await expect(pollPage(page).locator('.q11', { hasText: 'Lunch poll, page 1' })).toBeVisible();
    await expect(pollPage(page)).toContainText('Bento  12 votes');
    await expect(pollPage(page)).toContainText('瀏覽 第 1/2 頁');
    await expect(page.locator('[data-board-notes-page]')).toHaveAttribute('aria-label', await text(page, 'pollResults_title'));
    // A key typed on the page pages PTT's own pager.
    await page.keyboard.press(' ');
    await expect(pollPage(page)).toContainText('Lunch poll, page 2');
    await expect(pollPage(page)).toContainText('瀏覽 第 2/2 頁');
    await page.keyboard.press('Escape');
    await expect(pollPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['R', ' ', '\x1b[D']);
    await backOnList(page, 103);
  });

  test('a board without results: PTT\'s message is the hint, the banner is answered, no page shows', async ({ page }) => {
    await openList(page);
    await setPoll(page, { poll: 'none' });
    await markSent(page);
    await page.keyboard.press('R');
    await expect.poll(async () => hinted(page, '目前沒有任何投票的結果。')).toBe(true);
    await listActive(page);
    await expect(pollPage(page)).toHaveCount(0);
    expect(await sentSinceMark(page)).toEqual(['R', ' ']);
    await backOnList(page, 101);
  });

  test('q leaves too, and 投票結果 in the list\'s context menu shows the results', async ({ page }) => {
    await openList(page);
    await rightClickElement(page, 'span[type="bbsrow"][data-list-title*="Delta topic"]');
    const item = menuItem(page, await text(page, 'pollResults_title'));
    await expect(item).toBeVisible();
    await markSent(page);
    await item.click();
    await pageShown(page);
    await expect(pollPage(page)).toContainText('Lunch poll, page 1');
    // The board's results, not the row's: the selection did not move.
    expect(await selectedNum(page)).toBe(101);
    await page.keyboard.press('q');
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['R', '\x1b[D']);
    await backOnList(page, 101);
  });
});
