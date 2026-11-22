// The board entry screen on the phone (#292): 進板畫面 in the More sheet of the
// easy-reading article list. It sends PTT's `b` (bbs.c#b_notes) and shows
// PTT's own 80-column screen on a page that slides over the list, scaled to
// the page's width and drawn live. The keypad's keys reach PTT as typed (an
// interactive movie's choices); the system Back, a swipe right and the
// keypad's ← and Esc leave, sending what PTT waits for (q while a movie
// plays, then one key for pressanykey). The list comes back with its
// selection and viewport. PTT's grid itself never shows: the native grid
// guard (failing on offline-mobile) must see no frame of it. The desktop's
// entrances are in board_notes.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js, whose
// `b` follows b_notes and pmore's movie footers.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, tapCard, waitArticle, hinted } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');
const { beginArticleTouch } = require('../helpers/article_gestures');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const notesPage = (page) => page.locator('[data-board-notes-page]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const setNotes = (page, fields) => page.evaluate((f) => Object.assign(window.__shortcutServer.state, f), fields);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.boardNotes.busy)).toBe(true);
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
  const item = page.locator('[data-key="__boardNotes"]');
  await expect(item).toHaveText(await text(page, 'boardNotes_title'));
  await item.tap();
}

// The page shows PTT's screen and has finished sliding in.
async function pageShown(page) {
  await expect(notesPage(page)).toBeVisible();
  await page.waitForFunction(() => window.__app.boardNotes.phase === 'shown' &&
    document.querySelector('[data-board-notes-page]').getAnimations().length === 0);
}

async function swipeRight(page) {
  const box = await notesPage(page).boundingBox();
  const y = box.y + box.height / 2;
  const contact = await beginArticleTouch(page, { x: box.x + 20, y });
  await contact.move({ x: box.x + 36, y });
  await contact.move({ x: box.x + 160, y });
  await contact.move({ x: box.x + box.width - 20, y });
  await contact.release();
}

test.describe('the board entry screen on the phone', () => {
  test('More shows PTT\'s whole screen fitted to the page; Back leaves with one key; the list keeps its viewport', async ({ page }) => {
    await openList(page, { extraArticles: 30 });
    // A viewport away from the top: the newest article selected.
    await page.keyboard.press('End');
    await waitQuiet(page);
    await expect.poll(async () => (await listView(page)).selected).toBe(134);
    await expect.poll(async () => (await listView(page)).scrollTop).toBeGreaterThan(0);
    const before = await listView(page);
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    expect(await sentSinceMark(page)).toEqual(['b']);
    await expect(notesPage(page).locator('.q11', { hasText: 'Welcome to the Test board' })).toBeVisible();
    await expect(notesPage(page)).toContainText('請按任意鍵繼續');
    await expect(page.locator('#mobileAppBar')).toContainText(await text(page, 'boardNotes_title'));
    // All 80 columns fit the page's width: nothing of PTT's screen is cut.
    const fit = await notesPage(page).evaluate((el) => {
      const screen = el.querySelector('.boardNotesScreen');
      return { page: el.clientWidth, screen: screen.getBoundingClientRect().width, scroll: el.scrollWidth };
    });
    expect(fit.screen).toBeLessThanOrEqual(fit.page + 1);
    expect(fit.scroll).toBeLessThanOrEqual(fit.page + 1);
    await markSent(page);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual([' ']);
    expect(await listView(page)).toEqual(before);
    expect(await guardHits(page)).toEqual([]);
    // The next tap goes to the list: it opens the card.
    await tapCard(page, 'Extra topic 30');
    await waitArticle(page, 'Extra 30');
  });

  test('a movie plays on the page; a swipe right stops it with q, then one key for pressanykey', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'movie', notesFrames: 40, notesFrameMs: 250 });
    const before = await listView(page);
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    await expect(notesPage(page)).toContainText('Movie frame 2');
    await expect(notesPage(page)).toContainText('Movie frame 3');
    await swipeRight(page);
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', 'q', ' ']);
    expect(await listView(page)).toEqual(before);
    expect(await guardHits(page)).toEqual([]);
  });

  test('the keypad\'s keys reach an interactive movie; its Esc leaves with q', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'interactive', notesFrames: 80, notesFrameMs: 400 });
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    await expect(page.locator('[data-key="__keys"]')).toBeEnabled();
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toBeVisible();
    await page.locator('#mobileKeypad [data-key="ArrowDown"]').tap();
    await page.locator('#mobileKeypad [data-key="Enter"]').tap();
    await expect(notesPage(page)).toContainText('Choices made: 2');
    expect(await page.evaluate(() => window.__shortcutServer.state.notesChoices)).toEqual(['\x1b[B', '\r']);
    expect(await page.evaluate(() => window.__app.boardNotes.phase)).toBe('shown');
    await page.locator('#mobileKeypad [data-key="Escape"]').tap();
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', '\x1b[B', '\r', 'q', ' ']);
    expect(await guardHits(page)).toEqual([]);
  });

  test('a board without an entry screen: PTT\'s line on the page; the keypad\'s ← leaves', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'none' });
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    await expect(notesPage(page)).toContainText('本看板尚無進板畫面。');
    await page.locator('[data-key="__keys"]').tap();
    await page.locator('#mobileKeypad [data-key="ArrowLeft"]').tap();
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', ' ']);
    expect(await guardHits(page)).toEqual([]);
  });

  test('a tap on the page leaves at pressanykey; while a movie plays it does nothing', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'movie', notesFrames: 8, notesFrameMs: 300 });
    const before = await listView(page);
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    await expect(notesPage(page)).toContainText('動畫播放中');
    await notesPage(page).tap();
    expect(await page.evaluate(() => window.__app.boardNotes.phase)).toBe('shown');
    await expect(notesPage(page)).toContainText('請按任意鍵繼續');
    expect(await sentSinceMark(page)).toEqual(['b']);
    await notesPage(page).tap();
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', ' ']);
    expect(await listView(page)).toEqual(before);
    expect(await guardHits(page)).toEqual([]);
  });

  test('the system Back while PTT is answering gets the busy hint; the page still shows', async ({ page }) => {
    await openList(page);
    await page.evaluate(() => { window.__shortcutServer.state.holdResponses = true; });
    await markSent(page);
    await openFromMore(page);
    await expect.poll(() => page.evaluate(() => window.__app.boardNotes.phase)).toBe('asking');
    await page.goBack();
    await expect.poll(async () => hinted(page, await text(page, 'boardNotes_busy'))).toBe(true);
    await page.evaluate(() => window.__shortcutServer.releaseResponses());
    await pageShown(page);
    await page.goBack();
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', ' ']);
    expect(await guardHits(page)).toEqual([]);
  });

  test('not offered over an article', async ({ page }) => {
    await openList(page);
    await tapCard(page, 'Alpha topic');
    await waitArticle(page, 'Alpha');
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-key="__share"]')).toBeVisible();
    await expect(page.locator('[data-key="__boardNotes"]')).toHaveCount(0);
  });
});
