// An article's animation on the phone (#300): 播放動畫 in the More sheet of an
// easy-reading article. It sends PTT Home and `p` (pmore.c#pmore_cmd_movie)
// and shows PTT's own 80-column screen on the page of the board entry screen
// (#292), scaled to the page's width and drawn live, over the article. The
// keypad's keys reach PTT as typed (an interactive movie's choices); the
// system Back, a swipe right and the keypad's ← and Esc leave, sending what
// pmore waits for. The article comes back at the reader's line. Whether an
// article is a movie cannot be told before `p`, so More offers it on every
// article; one that is no movie shows pmore's question with a hint. PTT's
// grid itself never shows: the native grid guard (failing on offline-mobile)
// must see no frame of it. The desktop's entrances are in
// article_movie.offline.spec.js.
//
// The article is the controlled PTT of helpers/article_shortcut_search.js,
// whose `p` follows pmore_cmd_movie and pmore's movie footers.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const {
  bootNestedShortcutSearch, waitList, waitArticle, readToMiddle, topLine, tapCard, hinted
} = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');
const { beginArticleTouch } = require('../helpers/article_gestures');

const HOME = '\x1b[1~';
// A movie that plays until a key stops it: a test that stops a playing movie
// must not depend on how long the runner takes to get there.
const PLAYING = Infinity;
const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const moviePage = (page) => page.locator('[data-article-movie-page]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const setMovie = (page, fields) => page.evaluate((f) => Object.assign(window.__shortcutServer.state, f), fields);
const phase = (page) => page.evaluate(() => window.__app.articleMovie.phase);

async function waitQuiet(page) {
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => window.__app.commandQueue.idle ? window.__gestureSent.length : -1);
    const quiet = n >= 0 && n === last;
    last = n;
    return quiet;
  }, { intervals: [400] }).toBe(true);
}

// Alpha in easy reading, read to its middle with a touch drag.
async function openAlpha(page, options = {}) {
  await bootNestedShortcutSearch(page, { startAtMain: true, alphaLines: 60, ...options });
  // No background reads: the keys sent are the animation's alone.
  await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await waitQuiet(page);
  await tapCard(page, 'Alpha topic');
  await waitArticle(page, 'Alpha');
  await waitQuiet(page);
  const position = await readToMiddle(page);
  await waitQuiet(page);
  await page.waitForFunction(() => window.__app.articleMovie.available());
  await recordHints(page);
  await page.evaluate(() => window.__nativeGridGuard.reset());
  return position;
}

async function openFromMore(page) {
  await page.locator('[data-key="__more"]').tap();
  const item = page.locator('[data-key="__articleMovie"]');
  await expect(item).toHaveText(await text(page, 'articleMovie_title'));
  await item.tap();
}

// The page shows PTT's screen and has finished sliding in.
async function pageShown(page) {
  await expect(moviePage(page)).toBeVisible();
  await page.waitForFunction(() => window.__app.articleMovie.phase === 'shown' &&
    document.querySelector('[data-article-movie-page]').getAnimations().length === 0);
}

// Back in the article: the page is gone, PTT shows the article, easy reading
// draws it at the reader's line, and PTT's grid never showed.
async function backInArticle(page, position) {
  await expect(moviePage(page)).toHaveCount(0);
  await page.waitForFunction(() => window.__app.articleMovie.phase === 'idle' &&
    !window.__app.buf.easyReadingFunctionMode && !window.__app.easyReading._pendingScrollRestore);
  expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('article');
  await expect.poll(() => topLine(page)).toBe(position);
  expect(await guardHits(page)).toEqual([]);
}

async function swipeRight(page) {
  const box = await moviePage(page).boundingBox();
  const y = box.y + box.height / 2;
  const contact = await beginArticleTouch(page, { x: box.x + 20, y });
  await contact.move({ x: box.x + 36, y });
  await contact.move({ x: box.x + 160, y });
  await contact.move({ x: box.x + box.width - 20, y });
  await contact.release();
}

test.describe('an article\'s animation on the phone', () => {
  test('More plays the movie fitted to the page; Back stops it with Home; the article is back at the reader\'s line', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'movie', movieFrames: PLAYING, movieFrameMs: 250 });
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    await expect(moviePage(page)).toContainText('Article frame 2');
    await expect(moviePage(page)).toContainText('Article frame 3');
    await expect(page.locator('#mobileAppBar')).toContainText(await text(page, 'articleMovie_title'));
    // All 80 columns fit the page's width: nothing of PTT's screen is cut.
    const fit = await moviePage(page).evaluate((el) => {
      const screen = el.querySelector('.screenPageScreen');
      return { page: el.clientWidth, screen: screen.getBoundingClientRect().width, scroll: el.scrollWidth };
    });
    expect(fit.screen).toBeLessThanOrEqual(fit.page + 1);
    expect(fit.scroll).toBeLessThanOrEqual(fit.page + 1);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    await backInArticle(page, position);
    expect((await sentSinceMark(page)).slice(0, 2)).toEqual([HOME + 'p', HOME]);
  });

  test('a swipe right stops a playing movie', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'movie', movieFrames: PLAYING, movieFrameMs: 250 });
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    await expect(moviePage(page)).toContainText('Article frame 2');
    await swipeRight(page);
    await backInArticle(page, position);
    expect((await sentSinceMark(page)).slice(0, 2)).toEqual([HOME + 'p', HOME]);
  });

  test('the keypad\'s keys reach an interactive movie; its Esc leaves with q', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'interactive', movieFrames: PLAYING, movieFrameMs: 400 });
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    await expect(page.locator('[data-key="__keys"]')).toBeEnabled();
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toBeVisible();
    await page.locator('#mobileKeypad [data-key="ArrowDown"]').tap();
    await page.locator('#mobileKeypad [data-key="Enter"]').tap();
    await expect(moviePage(page)).toContainText('Choices made: 2');
    expect(await page.evaluate(() => window.__shortcutServer.state.movieChoices)).toEqual(['\x1b[B', '\r']);
    expect(await phase(page)).toBe('shown');
    await page.locator('#mobileKeypad [data-key="Escape"]').tap();
    await backInArticle(page, position);
    expect((await sentSinceMark(page)).slice(0, 4)).toEqual([HOME + 'p', '\x1b[B', '\r', 'q']);
  });

  test('a movie that ends keeps its last frame; a tap then leaves and sends nothing', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'movie', movieFrames: 3, movieFrameMs: 200 });
    await markSent(page);
    await openFromMore(page);
    await expect(moviePage(page)).toBeVisible();
    await expect.poll(() => phase(page)).toBe('ended');
    await expect(moviePage(page)).toContainText('Article frame 3');
    expect((await sentSinceMark(page))[0]).toBe(HOME + 'p');
    await waitQuiet(page);
    await expect(moviePage(page)).toBeVisible();
    await markSent(page);
    await moviePage(page).tap();
    await backInArticle(page, position);
    expect(await sentSinceMark(page)).toEqual([]);
  });

  test('an article that is no movie: pmore\'s question with a hint; the keypad\'s ← clears it', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'none' });
    await markSent(page);
    await openFromMore(page);
    await pageShown(page);
    await expect(moviePage(page)).toContainText('這可能是傳統動畫檔');
    await expect.poll(async () => hinted(page, await text(page, 'articleMovie_notMovie'))).toBe(true);
    await page.locator('[data-key="__keys"]').tap();
    await page.locator('#mobileKeypad [data-key="ArrowLeft"]').tap();
    await backInArticle(page, position);
    expect((await sentSinceMark(page)).slice(0, 2)).toEqual([HOME + 'p', '\x03']);
  });

  test('not offered over the list', async ({ page }) => {
    await bootNestedShortcutSearch(page, { startAtMain: true });
    await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
    await page.evaluate(() => {
      const server = window.__shortcutServer;
      server.state.surface = 'list';
      window.__app.onData(server.frame(true));
    });
    await waitList(page, { has: ['Alpha topic'] });
    await waitQuiet(page);
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-key="__boardNotes"]')).toBeVisible();
    await expect(page.locator('[data-key="__articleMovie"]')).toHaveCount(0);
  });
});
