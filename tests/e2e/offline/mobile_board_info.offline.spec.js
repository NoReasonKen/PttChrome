// Board information on the phone (#288): 看板資訊 in the More sheet of the
// easy-reading article list. It sends PTT's `i` (bbs.c#bbs_cmd_config →
// board.c#b_config), reads every page of the PSB list (PgDn until the last
// item) into the app's own sheet and leaves PTT's screen with ←. PTT's screen
// never shows (the native grid guard sees no frame of it), closing the sheet
// sends nothing, and the list keeps its selection and the reader's viewport.
// The system Back while PTT is still answering gets the busy hint; a screen
// the app does not recognise leaves the list with a hint. The desktop's
// entrances are in board_info.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js, whose
// board information follows b_config's rows and keys.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, tapCard, waitArticle, hinted } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const sheet = (page) => page.locator('[data-sheet="boardInfo"]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.boardInfo.busy)).toBe(true);
const idle = (page) => page.waitForFunction(() => !window.__app.boardInfo.busy && window.__app.commandQueue.idle);
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
  const item = page.locator('[data-key="__boardInfo"]');
  await expect(item).toHaveText(await text(page, 'boardInfo_title'));
  await item.tap();
}

async function closeSheet(page) {
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
}

test.describe('board information on the phone', () => {
  test('More shows every row; the list keeps its selection and viewport; the next tap goes to the list', async ({ page }) => {
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
    await expect(sheet(page)).toContainText(await text(page, 'boardInfo_title'));
    await expect(sheet(page).locator('[data-board-info-field="board"] [data-board-info-value]')).toHaveText('Test');
    const labels = sheet(page).locator('[data-board-info-row] [data-board-info-label]');
    await expect(labels).toHaveCount(30);
    await expect(labels.nth(0)).toHaveText('看板管理紀錄(自動公告)');
    await expect(labels.nth(29)).toHaveText('[紀錄] 看板管理稽核紀錄');
    await expect(sheet(page).locator('[data-board-info-row] [data-board-info-value]').nth(29)).toHaveText('(限管理人員)');
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['i', '\x1b[6~', '\x1b[D']);
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
    await expect.poll(() => page.evaluate(() => window.__app.boardInfo.busy)).toBe(true);
    await page.goBack();
    await expect.poll(async () => hinted(page, await text(page, 'boardInfo_busy'))).toBe(true);
    await page.evaluate(() => window.__shortcutServer.releaseResponses());
    await expect(sheet(page)).toBeVisible();
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['i', '\x1b[6~', '\x1b[D']);
    await closeSheet(page);
    await listActive(page);
    expect(await guardHits(page)).toEqual([]);
  });

  test('PTT draws the list again: the hint, nothing else sent, no sheet', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.boardInfoFails = true; });
    await markSent(page);
    await openFromMore(page);
    await expect.poll(async () => hinted(page, await text(page, 'boardInfo_unavailable'))).toBe(true);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['i']);
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
    await expect(page.locator('[data-key="__boardInfo"]')).toHaveCount(0);
  });
});
