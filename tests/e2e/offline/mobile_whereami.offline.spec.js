// Where the board is on the phone (#293): 我在哪 in the More sheet of the
// easy-reading article list. It sends PTT's Ctrl-W (bbs.c#whereami), reads the
// screen it draws (every level of the class tree and the 位置 path) into the
// app's own sheet and answers PTT's pressanykey. PTT's screen never shows (the
// native grid guard sees no frame of it), closing the sheet sends nothing, and
// the list keeps its selection and the reader's viewport. The system Back while
// PTT is still answering gets the busy hint; a board PTT draws nothing for
// leaves the list with a hint. The desktop's entrances are in
// whereami.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js, whose
// 我在哪 screen follows whereami's rows.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, tapCard, waitArticle, hinted } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const sheet = (page) => page.locator('[data-sheet="whereAmI"]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.whereAmI.busy)).toBe(true);
const idle = (page) => page.waitForFunction(() => !window.__app.whereAmI.busy && window.__app.commandQueue.idle);
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
  // No background reads: the keys sent are the sequence's alone.
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
  const item = page.locator('[data-key="__whereAmI"]');
  await expect(item).toHaveText(await text(page, 'whereAmI_title'));
  await item.tap();
}

async function closeSheet(page) {
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
}

test.describe('where the board is on the phone', () => {
  test('More shows every level and the path; the list keeps its selection and viewport; the next tap goes to the list', async ({ page }) => {
    await openList(page, { extraArticles: 30 });
    // A viewport away from the top: the newest article selected.
    await page.keyboard.press('End');
    await waitQuiet(page);
    await expect.poll(async () => (await listView(page)).selected).toBe(134);
    await expect.poll(async () => (await listView(page)).scrollTop).toBeGreaterThan(0);
    const before = await listView(page);
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await markSent(page);
    await openFromMore(page);
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText(await text(page, 'whereAmI_title'));
    const levels = sheet(page).locator('[data-whereami-level]');
    await expect(levels).toHaveCount(3);
    await expect(levels.nth(0).locator('[data-whereami-description]')).toHaveText('測試 ◎測試分類');
    await expect(levels.nth(1).locator('[data-whereami-board]')).toHaveText('Test_Class');
    await expect(levels.nth(2).locator('[data-whereami-board]')).toHaveText('Test');
    await expect(levels.nth(2).locator('[data-whereami-moderators]')).toContainText('test');
    await expect(sheet(page).locator('[data-whereami-path]')).toHaveText('測試 > Test_Class > Test');
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['\x17', ' ']);
    expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('list');
    await markSent(page);
    await closeSheet(page);
    // Closing the sheet sends nothing; PTT's screen never showed.
    expect(await sentSinceMark(page)).toEqual([]);
    await listActive(page);
    expect(await guardHits(page)).toEqual([]);
    expect(await listView(page)).toEqual(before);
    // The next tap goes to the list: it opens the card.
    await tapCard(page, 'Extra topic 30');
    await waitArticle(page, 'Extra 30');
  });

  test('the system Back while PTT is answering gets the busy hint; the sheet still opens', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.holdResponses = true; });
    await markSent(page);
    await openFromMore(page);
    await expect.poll(() => page.evaluate(() => window.__app.whereAmI.busy)).toBe(true);
    await page.goBack();
    await expect.poll(async () => hinted(page, await text(page, 'whereAmI_busy'))).toBe(true);
    await page.evaluate(() => window.__shortcutServer.releaseResponses());
    await expect(sheet(page)).toBeVisible();
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['\x17', ' ']);
    await closeSheet(page);
    await listActive(page);
    expect(await guardHits(page)).toEqual([]);
  });

  test('PTT does nothing: the hint, nothing else sent, no sheet', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.whereAmIFails = true; });
    await markSent(page);
    await openFromMore(page);
    await expect.poll(async () => hinted(page, await text(page, 'whereAmI_unavailable'))).toBe(true);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['\x17']);
    await expect(sheet(page)).toHaveCount(0);
    await listActive(page);
    expect(await guardHits(page)).toEqual([]);
  });

  test('not offered over an article', async ({ page }) => {
    await openList(page);
    await tapCard(page, 'Alpha topic');
    await waitArticle(page, 'Alpha');
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-key="__share"]')).toBeVisible();
    await expect(page.locator('[data-key="__whereAmI"]')).toHaveCount(0);
  });
});
