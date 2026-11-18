// Querying an article's author from the easy-reading article list (#254):
// 查詢作者 in a card's long-press sheet moves PTT's cursor to that article and
// sends Ctrl-Q (read.c#read_cmd_query), and PTT's query screen shows as the
// query page of the online user list (#199), stacked over the list. Leaving it
// shows the list again at once with the same card selected. An author PTT
// does not know (the account is gone) leaves the list on screen with a hint,
// and nothing more is sent. PTT's grid never shows on this route, so the
// native grid guard (helpers/native_grid_guard.js) must see no frame of it.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js; its
// query screen reads as the one of helpers/user_list.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList } = require('../helpers/article_shortcut_search');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const queryPage = (page) => page.locator('[data-user-query-page]');
const field = (page, name) => queryPage(page).locator(`.userQueryRow[data-field="${name}"] .userQueryValue`);
const sheetItem = (page, key) => page.locator(`[data-sheet="context"] [data-cmenu="${key}"]`);
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const holding = (page) => page.evaluate(() => window.__app.userQuery.holding);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.userQuery.holding)).toBe(true);

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
  await page.evaluate(() => window.__nativeGridGuard.reset());
}

// Long-press the card with `title` (its body, as a finger does). Desktop
// Chromium sends no contextmenu for a CDP long press, so the event is made here
// (E2E_EXEMPT in tests/unit/e2e_real_input.test.js, as mobile_list_cards does).
async function longPress(page, title) {
  await page.evaluate((title) => {
    const card = [...document.querySelectorAll('.main:not([data-stack-layer]) .listCard')]
      .find((c) => c.textContent.includes(title));
    const el = card.querySelector('.listCardBody') || card;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('contextmenu', {
      bubbles: true, cancelable: true, pointerType: 'touch',
      clientX: r.left + Math.min(r.width / 2, 20), clientY: r.top + r.height / 2
    }));
  }, title);
}

async function queryFromSheet(page, title, author) {
  await longPress(page, title);
  const item = sheetItem(page, 'queryAuthor');
  await expect(item).toBeVisible();
  await expect(item).toHaveText(`${await text(page, 'authorQuery_title')} '${author}'`);
  await item.tap();
}

// The query page is up, PTT shows its query screen and nothing else is sent.
async function pageShown(page, id) {
  await expect(queryPage(page)).toBeVisible();
  await expect(queryPage(page)).toHaveAttribute('data-user-id', id);
  await page.waitForFunction(() => window.__app.userQuery.phase === 'shown' && window.__app.commandQueue.idle &&
    document.querySelector('[data-user-query-page]').getAnimations().length === 0);
  expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('query');
}

test.describe('querying an article\'s author from the article list', () => {
  test('查詢作者 in a card\'s sheet shows the author as a page, never PTT\'s grid', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await queryFromSheet(page, 'Re: [Talk] Beta topic', 'bob');
    await pageShown(page, 'bob');
    // PTT's cursor goes to that article first: Ctrl-Q queries the cursor's author.
    expect(await sentSinceMark(page)).toEqual(['103\r', '\x11']);
    await expect(field(page, 'id')).toHaveText('bob');
    await expect(field(page, 'nick')).toHaveText('bob 的暱稱');
    await expect(field(page, 'lastHost')).toHaveText('某地');
    await expect(queryPage(page)).not.toContainText('請按任意鍵繼續');
    await expect(page.locator('#mobileAppBar')).toContainText(await text(page, 'userQuery_title'));
    expect(await guardHits(page)).toEqual([]);
  });

  test('Back shows the list at once with the article still selected', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.querySleepMs = 1500; });
    await queryFromSheet(page, 'Re: [Talk] Beta topic', 'bob');
    await pageShown(page, 'bob');
    await markSent(page);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    // The page is gone and the list shows with the same card selected while
    // PTT still sleeps on its query screen.
    await expect(queryPage(page)).toHaveCount(0);
    expect(await holding(page)).toBe(true);
    await expect(page.locator('.main:not([data-stack-layer]) .listCard', { hasText: 'Re: [Talk] Beta topic' })).toBeVisible();
    expect(await selectedNum(page)).toBe(103);
    await listActive(page);
    expect(await selectedNum(page)).toBe(103);
    // One key for PTT's 請按任意鍵繼續.
    expect(await sentSinceMark(page)).toEqual([' ']);
    expect(await guardHits(page)).toEqual([]);
  });

  test('an author PTT does not know stays on the list with a hint and sends nothing more', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.goneAuthors.add('bob'); });
    await markSent(page);
    await queryFromSheet(page, 'Re: [Talk] Beta topic', 'bob');
    await expect(page.locator('.ListHint')).toHaveText(await text(page, 'authorQuery_notFound'));
    await listActive(page);
    await expect(queryPage(page)).toHaveCount(0);
    expect(await selectedNum(page)).toBe(103);
    // Ctrl-Q only: PTT drew nothing, so no key answers a screen that is not there.
    expect(await sentSinceMark(page)).toEqual(['103\r', '\x11']);
    expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('list');
    expect(await guardHits(page)).toEqual([]);
  });
});
