// The board entry screen on the desktop (#292): `b` and 進板畫面 in the
// context menu of the easy-reading article list. Either sends PTT's `b`
// (bbs.c#b_notes: more(notes, NA), then pressanykey) and shows PTT's own
// screen on a page that slides over the list, drawn live by a second instance
// of the screen renderer. Keys on the page reach PTT as typed; ←, Esc and q
// leave, and leaving sends what PTT waits for (q while a movie plays, then
// one key for pressanykey), each after PTT answered the one before. The list
// comes back with its selection and the next key goes to it. The phone's
// entrance is in mobile_board_notes.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js, whose
// `b` follows b_notes and pmore's movie footers.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');
const { rightClickElement } = require('../helpers/real_input');
const { waitRectStable } = require('../helpers/layout');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const notesPage = (page) => page.locator('[data-board-notes-page]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const serverSurface = (page) => page.evaluate(() => window.__shortcutServer.state.surface);
const setNotes = (page, fields) => page.evaluate((f) => Object.assign(window.__shortcutServer.state, f), fields);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.boardNotes.busy)).toBe(true);
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
  await expect(notesPage(page)).toBeVisible();
  await page.waitForFunction(() => window.__app.boardNotes.phase === 'shown' &&
    document.querySelector('[data-board-notes-page]').getAnimations().length === 0);
}

// Back on the list: the page is gone, PTT shows the list, the selection is
// where it was and the next key goes to the list.
async function backOnList(page, num) {
  await expect(notesPage(page)).toHaveCount(0);
  await listActive(page);
  expect(await serverSurface(page)).toBe('list');
  expect(await selectedNum(page)).toBe(num);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedNum(page)).toBe(num + 1);
}

test.describe('the board entry screen on the desktop', () => {
  test('b shows the coloured entry screen with PTT\'s footer; Esc leaves with one key for pressanykey', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(103);
    await markSent(page);
    await page.keyboard.press('b');
    await pageShown(page);
    expect(await sentSinceMark(page)).toEqual(['b']);
    // PTT's screen as it is: its colours and its pressanykey bar.
    await expect(notesPage(page).locator('.q11', { hasText: 'Welcome to the Test board' })).toBeVisible();
    await expect(notesPage(page).locator('.q9', { hasText: 'A red notice line' })).toBeVisible();
    await expect(notesPage(page)).toContainText('請按任意鍵繼續');
    // The page covers the list's area.
    const list = await waitRectStable(page, '.main:not([data-stack-layer])', { fullRect: true });
    const box = await waitRectStable(page, '[data-board-notes-page]', { fullRect: true });
    expect(Math.abs(box.left - list.left)).toBeLessThan(2);
    expect(Math.abs(box.width - list.width)).toBeLessThan(2);
    await markSent(page);
    await page.keyboard.press('Escape');
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual([' ']);
    await backOnList(page, 103);
  });

  test('a board without an entry screen: PTT\'s line on the page; q leaves', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'none' });
    await markSent(page);
    await page.keyboard.press('b');
    await pageShown(page);
    await expect(notesPage(page)).toContainText('本看板尚無進板畫面。');
    await page.keyboard.press('q');
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', ' ']);
    await backOnList(page, 101);
  });

  test('a movie plays on the page frame by frame; ← stops it with q, then one key for pressanykey', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'movie', notesFrames: 30, notesFrameMs: 250 });
    await markSent(page);
    await page.keyboard.press('b');
    await pageShown(page);
    await expect(notesPage(page)).toContainText('動畫播放中');
    await expect(notesPage(page)).toContainText('Movie frame 3');
    await expect(notesPage(page)).toContainText('Movie frame 4');
    await page.keyboard.press('ArrowLeft');
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', 'q', ' ']);
    await backOnList(page, 101);
  });

  test('a movie that ends waits on its last frame until the reader leaves; any key then leaves', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'movie', notesFrames: 3, notesFrameMs: 200 });
    await markSent(page);
    await page.keyboard.press('b');
    await pageShown(page);
    await expect(notesPage(page)).toContainText('請按任意鍵繼續');
    await expect(notesPage(page)).toContainText('Movie frame 3');
    expect(await serverSurface(page)).toBe('notesPause');
    // It stays: nothing more is sent until the reader leaves.
    await page.waitForFunction(() => window.__app.commandQueue.idle && !window.__app.buf._settleTimer);
    await expect(notesPage(page)).toBeVisible();
    expect(await page.evaluate(() => window.__app.boardNotes.phase)).toBe('shown');
    expect(await sentSinceMark(page)).toEqual(['b']);
    await page.keyboard.press('x');
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', ' ']);
    await backOnList(page, 101);
  });

  test('a key typed during a plain movie reaches PTT and stops it; the page follows to pressanykey', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'movie', notesFrames: 30, notesFrameMs: 250 });
    await markSent(page);
    await page.keyboard.press('b');
    await pageShown(page);
    await expect(notesPage(page)).toContainText('Movie frame 2');
    await page.keyboard.press('x');
    await expect(notesPage(page)).toContainText('請按任意鍵繼續');
    expect(await sentSinceMark(page)).toEqual(['b', 'x']);
    await page.keyboard.press('Escape');
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', 'x', ' ']);
    await backOnList(page, 101);
  });

  test('an interactive movie takes the reader\'s keys as typed; Esc leaves with q', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'interactive', notesFrames: 60, notesFrameMs: 400 });
    await markSent(page);
    await page.keyboard.press('b');
    await pageShown(page);
    await expect(notesPage(page)).toContainText('互動式動畫播放中');
    await page.keyboard.press('1');
    await page.keyboard.press('ArrowDown');
    await expect(notesPage(page)).toContainText('Choices made: 2');
    await expect.poll(() => page.evaluate(() => window.__shortcutServer.state.notesChoices)).toEqual(['1', '\x1b[B']);
    expect(await page.evaluate(() => window.__app.boardNotes.phase)).toBe('shown');
    await page.keyboard.press('Escape');
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', '1', '\x1b[B', 'q', ' ']);
    await backOnList(page, 101);
  });

  test('PTT draws the list when a key stops the movie: the page keeps the last frame, leaving sends nothing', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(102);
    await setNotes(page, { notes: 'movie', notesFrames: 30, notesFrameMs: 250, notesStop: 'list' });
    await markSent(page);
    await page.keyboard.press('b');
    await pageShown(page);
    await expect(notesPage(page)).toContainText('Movie frame 2');
    await page.keyboard.press('x');
    await expect.poll(() => page.evaluate(() => window.__app.boardNotes.phase)).toBe('ended');
    await expect(notesPage(page)).toContainText('動畫播放中');
    await expect.poll(() => page.evaluate(() => window.__app.listSession.state)).toBe('active');
    await page.keyboard.press('Escape');
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', 'x']);
    await backOnList(page, 102);
  });

  test('a click leaves on pressanykey; during a movie it does nothing', async ({ page }) => {
    await openList(page);
    await setNotes(page, { notes: 'movie', notesFrames: 8, notesFrameMs: 300 });
    await markSent(page);
    await page.keyboard.press('b');
    await pageShown(page);
    await expect(notesPage(page)).toContainText('動畫播放中');
    await notesPage(page).click();
    expect(await page.evaluate(() => window.__app.boardNotes.phase)).toBe('shown');
    // The movie ends in pressanykey; nothing was sent for the click.
    await expect(notesPage(page)).toContainText('請按任意鍵繼續');
    expect(await sentSinceMark(page)).toEqual(['b']);
    await notesPage(page).click();
    await expect(notesPage(page)).toHaveCount(0);
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', ' ']);
    await backOnList(page, 101);
  });

  test('進板畫面 in the list\'s context menu shows it', async ({ page }) => {
    await openList(page);
    await rightClickElement(page, 'span[type="bbsrow"][data-list-title*="Delta topic"]');
    const item = menuItem(page, await text(page, 'boardNotes_title'));
    await expect(item).toBeVisible();
    await markSent(page);
    await item.click();
    await pageShown(page);
    await expect(notesPage(page)).toContainText('Welcome to the Test board');
    expect(await sentSinceMark(page)).toEqual(['b']);
    // The board's entry screen, not the row's: the selection did not move.
    expect(await selectedNum(page)).toBe(101);
    await page.keyboard.press('Escape');
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['b', ' ']);
    await backOnList(page, 101);
  });
});
