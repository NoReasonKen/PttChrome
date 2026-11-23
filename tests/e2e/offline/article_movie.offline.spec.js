// An article's animation on the desktop (#300): `p` and 播放動畫 in the
// context menu of an easy-reading article. Either sends PTT Home and `p`
// (pmore.c#pmore_cmd_movie: the movie plays from the article's top) and shows
// PTT's own screen on the page of the board entry screen (#292), sliding over
// the article, drawn live frame by frame. Keys on the page reach PTT as typed
// (an interactive movie's choices); ←, Esc and q leave, and leaving sends what
// pmore waits for (Home stops a plain movie, q an interactive one, Ctrl-C
// clears the classic animation's speed question). The article comes back at
// the reader's line and the next key goes to it. A movie that ends keeps its
// last frame until the reader leaves. The phone's entrance is in
// mobile_article_movie.offline.spec.js.
//
// The article is the controlled PTT of helpers/article_shortcut_search.js,
// whose `p` follows pmore_cmd_movie and pmore's movie footers.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const {
  bootNestedShortcutSearch, waitList, waitArticle, topLine, hinted
} = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');
const { rightClickElement } = require('../helpers/real_input');
const { waitRectStable } = require('../helpers/layout');

const HOME = '\x1b[1~';
const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const moviePage = (page) => page.locator('[data-article-movie-page]');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const serverState = (page) => page.evaluate(() => {
  const { surface, line, movieChoices } = window.__shortcutServer.state;
  return { surface, line, movieChoices };
});
const setMovie = (page, fields) => page.evaluate((f) => Object.assign(window.__shortcutServer.state, f), fields);
const phase = (page) => page.evaluate(() => window.__app.articleMovie.phase);
const menuItem = (page, label) =>
  page.locator('.DropdownMenu').first().getByRole('menuitem').filter({ hasText: label });

async function quiet(page) {
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => window.__app.commandQueue.idle ? window.__gestureSent.length : -1);
    const still = n >= 0 && n === last;
    last = n;
    return still;
  }, { intervals: [400] }).toBe(true);
}

// Alpha in easy reading, `alphaLines` long, read to its middle with the wheel.
async function openAlpha(page, { alphaLines = 60, middle = true } = {}) {
  await bootNestedShortcutSearch(page, { startAtMain: true, alphaLines });
  // No background reads: the keys sent are the animation's alone.
  await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await quiet(page);
  await page.keyboard.press('Enter');
  await waitArticle(page, 'Alpha');
  await quiet(page);
  await page.waitForFunction(() => window.__app.articleMovie.available());
  await recordHints(page);
  if (!middle) return topLine(page);
  const main = await page.locator('.main:not([data-stack-layer])').boundingBox();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => topLine(page)).toMatch(/^Alpha line (0[5-9]|[1-4]\d)/);
  let last = null;
  await expect.poll(async () => {
    const now = await topLine(page);
    const still = now === last;
    last = now;
    return still;
  }, { intervals: [300] }).toBe(true);
  await quiet(page);
  return topLine(page);
}

// The page shows PTT's screen and has finished sliding in.
async function pageShown(page) {
  await expect(moviePage(page)).toBeVisible();
  await page.waitForFunction(() => window.__app.articleMovie.phase === 'shown' &&
    document.querySelector('[data-article-movie-page]').getAnimations().length === 0);
}

// Back in the article: the page is gone, PTT shows the article, easy reading
// draws it again at the reader's line and its keys are the article's.
async function backInArticle(page, position) {
  await expect(moviePage(page)).toHaveCount(0);
  await page.waitForFunction(() => window.__app.articleMovie.phase === 'idle' &&
    !window.__app.buf.easyReadingFunctionMode && !window.__app.easyReading._pendingScrollRestore);
  expect((await serverState(page)).surface).toBe('article');
  await expect.poll(() => topLine(page)).toBe(position);
  await page.waitForFunction(() => window.__app.articleMovie.available());
}

test.describe('an article\'s animation on the desktop', () => {
  test('p plays the movie frame by frame over the article; Esc stops it with Home; the article is back at the reader\'s line', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'movie', movieFrames: 40, movieFrameMs: 250 });
    await markSent(page);
    await page.keyboard.press('p');
    await pageShown(page);
    expect((await sentSinceMark(page))[0]).toBe(HOME + 'p');
    await expect(moviePage(page)).toContainText('動畫播放中');
    await expect(moviePage(page)).toContainText('Article frame 3');
    await expect(moviePage(page)).toContainText('Article frame 4');
    // The page covers the article's area.
    const main = await waitRectStable(page, '.main:not([data-stack-layer])', { fullRect: true });
    const box = await waitRectStable(page, '[data-article-movie-page]', { fullRect: true });
    expect(Math.abs(box.left - main.left)).toBeLessThan(2);
    expect(Math.abs(box.width - main.width)).toBeLessThan(2);
    await page.keyboard.press('Escape');
    await expect(moviePage(page)).toHaveCount(0);
    await backInArticle(page, position);
    expect((await sentSinceMark(page)).slice(0, 2)).toEqual([HOME + 'p', HOME]);
    // The next key is the article's: ← leaves it for the list.
    await page.keyboard.press('ArrowLeft');
    await waitList(page, { has: ['Alpha topic'] });
  });

  test('a movie that ends keeps its last frame; the article is back under it; a key then only leaves', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'movie', movieFrames: 3, movieFrameMs: 200 });
    await markSent(page);
    await page.keyboard.press('p');
    await expect(moviePage(page)).toBeVisible();
    await expect.poll(() => phase(page)).toBe('ended');
    await expect(moviePage(page)).toContainText('Article frame 3');
    expect((await serverState(page)).surface).toBe('article');
    expect((await sentSinceMark(page))[0]).toBe(HOME + 'p');
    // It stays; the article under it is easy reading's again, and nothing of
    // the page's is sent until the reader leaves.
    await quiet(page);
    await expect(moviePage(page)).toBeVisible();
    await markSent(page);
    await page.keyboard.press('x');
    await expect.poll(async () => hinted(page, '不支援')).toBe(true);
    expect(await phase(page)).toBe('ended');
    await moviePage(page).click();
    await backInArticle(page, position);
    expect(await sentSinceMark(page)).toEqual([]);
  });

  test('an interactive movie takes the reader\'s keys as typed; q leaves with q', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'interactive', movieFrames: 60, movieFrameMs: 400 });
    await markSent(page);
    await page.keyboard.press('p');
    await pageShown(page);
    await expect(moviePage(page)).toContainText('互動式動畫播放中');
    await page.keyboard.press('1');
    await page.keyboard.press('ArrowDown');
    await expect(moviePage(page)).toContainText('Choices made: 2');
    expect((await serverState(page)).movieChoices).toEqual(['1', '\x1b[B']);
    expect(await phase(page)).toBe('shown');
    await page.keyboard.press('q');
    await backInArticle(page, position);
    expect((await sentSinceMark(page)).slice(0, 4)).toEqual([HOME + 'p', '1', '\x1b[B', 'q']);
  });

  test('an article that is no movie: pmore\'s speed question on the page with a hint; Esc clears it with Ctrl-C', async ({ page }) => {
    const position = await openAlpha(page);
    await setMovie(page, { articleMovie: 'none' });
    await markSent(page);
    await page.keyboard.press('p');
    await pageShown(page);
    await expect(moviePage(page)).toContainText('這可能是傳統動畫檔');
    await expect.poll(async () => hinted(page, await text(page, 'articleMovie_notMovie'))).toBe(true);
    await page.keyboard.press('Escape');
    await backInArticle(page, position);
    expect((await sentSinceMark(page)).slice(0, 2)).toEqual([HOME + 'p', '\x03']);
  });

  test('播放動畫 in the article\'s context menu plays it', async ({ page }) => {
    const position = await openAlpha(page, { alphaLines: 0, middle: false });
    await setMovie(page, { articleMovie: 'movie', movieFrames: 40, movieFrameMs: 250 });
    await rightClickElement(page, '#mainContainer [type="bbsrow"][srow="5"]');
    const item = menuItem(page, await text(page, 'articleMovie_title'));
    await expect(item).toBeVisible();
    await markSent(page);
    await item.click();
    await pageShown(page);
    await expect(moviePage(page)).toContainText('Article frame 2');
    await page.keyboard.press('ArrowLeft');
    await backInArticle(page, position);
    expect((await sentSinceMark(page)).slice(0, 2)).toEqual([HOME + 'p', HOME]);
  });
});
