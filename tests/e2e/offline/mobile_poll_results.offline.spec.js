// The poll results on the phone (#301): 投票結果 in the More sheet of the
// easy-reading article list. It sends PTT's `R` (bbs.c#bbs_cmd_poll_results →
// poll.c#poll_results: more(results, YEA)) and shows PTT's 80-column screen on
// the board entry screen's page (#292), scaled to the page's width; the
// keypad's keys reach PTT as typed (paging), the system Back leaves with the
// pager's ←, and the list comes back with its selection and viewport. A board
// without results answers with a vmsg banner: its message is the hint and no
// page shows. PTT's grid itself never shows: the native grid guard must see no
// frame of it. The shapes are derived from the pttbbs source; no real result
// screen has been seen. The desktop's entrances are in
// poll_results.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, tapCard, waitArticle, hinted } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const pollPage = (page) => page.locator('[data-board-notes-page]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const setPoll = (page, fields) => page.evaluate((f) => Object.assign(window.__shortcutServer.state, f), fields);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.pollResults.busy)).toBe(true);
const VIEW = '.main:not([data-stack-layer]) .listBodyView';

// The card at the top edge of the list, the list's scroll position and the
// selection.
const listView = (page) =>
  page.evaluate((sel) => {
    const view = document.querySelector(sel);
    if (!view) return { top: null };
    const edge = view.getBoundingClientRect().top;
    const card = [...view.querySelectorAll('.listCard')].find((c) => c.getBoundingClientRect().bottom > edge + 1);
    return {
      top: card ? Number(card.querySelector('.listCardNum')?.textContent.trim()) || null : null,
      scrollTop: Math.round(view.scrollTop),
      selected: window.__app.listSession._selectedNum
    };
  }, VIEW);

async function waitQuiet(page) {
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => window.__app.commandQueue.idle ? window.__gestureSent.length : -1);
    const quiet = n >= 0 && n === last;
    last = n;
    return quiet;
  }, { intervals: [400] }).toBe(true);
}

async function openList(page, options = {}) {
  await bootNestedShortcutSearch(page, { startAtMain: true, ...options });
  // No background reads: the keys sent are the entry screen's alone.
  await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await listActive(page);
  await waitQuiet(page);
  await recordHints(page);
  await page.evaluate(() => window.__nativeGridGuard.reset());
}

async function openFromMore(page) {
  await page.locator('[data-key="__more"]').tap();
  const item = page.locator('[data-key="__pollResults"]');
  await expect(item).toHaveText(await text(page, 'pollResults_title'));
  await item.tap();
}

// The page shows PTT's screen and has finished sliding in.
async function pageShown(page) {
  await expect(pollPage(page)).toBeVisible();
  await page.waitForFunction(() => window.__app.pollResults.phase === 'shown' &&
    document.querySelector('[data-board-notes-page]').getAnimations().length === 0);
}

test.describe('the poll results on the phone', () => {
  test('More shows PTT\'s results fitted to the page; Back leaves with the pager\'s ←; the list keeps its viewport', async ({ page }) => {
    await openList(page, { extraArticles: 30 });
    await page.keyboard.press('End');
    await waitQuiet(page);
    await expect.poll(async () => (await listView(page)).selected).toBe(134);
    await expect.poll(async () => (await listView(page)).scrollTop).toBeGreaterThan(0);
    const before = await listView(page);
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    expect(await sentSinceMark(page)).toEqual(['R']);
    await expect(pollPage(page).locator('.q11', { hasText: 'Lunch poll, page 1' })).toBeVisible();
    await expect(pollPage(page)).toContainText('瀏覽 第 1/2 頁');
    await expect(page.locator('#mobileAppBar')).toContainText(await text(page, 'pollResults_title'));
    // All 80 columns fit the page's width.
    const fit = await pollPage(page).evaluate((el) => {
      const screen = el.querySelector('.screenPageScreen');
      return { page: el.clientWidth, screen: screen.getBoundingClientRect().width, scroll: el.scrollWidth };
    });
    expect(fit.screen).toBeLessThanOrEqual(fit.page + 1);
    expect(fit.scroll).toBeLessThanOrEqual(fit.page + 1);
    await markSent(page);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    await expect(pollPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\x1b[D']);
    expect(await listView(page)).toEqual(before);
    expect(await guardHits(page)).toEqual([]);
    await tapCard(page, 'Extra topic 30');
    await waitArticle(page, 'Extra 30');
  });

  test('a board without results: PTT\'s message is the hint, no page shows, the list stays', async ({ page }) => {
    await openList(page);
    await setPoll(page, { poll: 'none' });
    const before = await listView(page);
    await markSent(page);
    await openFromMore(page);
    await expect.poll(async () => hinted(page, '目前沒有任何投票的結果。')).toBe(true);
    await listActive(page);
    await expect(pollPage(page)).toHaveCount(0);
    expect(await sentSinceMark(page)).toEqual(['R', ' ']);
    expect(await listView(page)).toEqual(before);
    expect(await guardHits(page)).toEqual([]);
  });
});
