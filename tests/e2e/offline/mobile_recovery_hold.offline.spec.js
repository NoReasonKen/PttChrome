// Recovery keeps the page shown while it drives PTT (#188). After a reconnect,
// the page the reader had stays on screen from the login's main menu until the
// recovery lands; after a reload, home (the dashboard under the countdown)
// stays until it lands. Either way the destination is shown only through easy
// reading, and no frame of PTT's own screens reaches paint. Every painted
// frame is sampled (helpers/layout.js installPaintedFrameProbe). The controlled
// PTT board is helpers/article_shortcut_search.js; touch, the socket close, the
// reconnect and the reload are real. Runs only in the offline-mobile project.
const { test, expect } = require('@playwright/test');
const {
  bootNestedShortcutSearch, nestedSessionAfterLogin, waitArticle, waitList, readToMiddle, topLine, tapShortcut,
  disconnectAndReconnect
} = require('../helpers/article_shortcut_search');
const { waitConnected } = require('../helpers/replay');
const { pauseClockNow } = require('../helpers/clock');
const { MAIN } = require('../helpers/stack_routes');
const { installPaintedFrameProbe } = require('../helpers/layout');
const ptt = require('../helpers/ptt');

const FULL_LIST = { has: ['Alpha topic', 'Delta topic'] };
const AUTHOR_RESULTS = { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] };

// One advancing clock across documents, as the search-trail recovery spec
// keeps it: the saved place's age depends on Date.now().
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
});

// Samples every painted frame until stopFrames.
async function watchFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate((MAIN) => {
    window.__frames = [];
    const visible = (el) => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const sample = () => {
      const app = window.__app;
      const main = document.querySelector(MAIN);
      const content = main?.querySelector('#mainContainer');
      const rect = main?.getBoundingClientRect();
      const left = Math.max(0, rect?.left || 0), right = Math.min(innerWidth, rect?.right || 0);
      const top = Math.max(0, rect?.top || 0, document.getElementById('mobileAppBar')?.getBoundingClientRect().bottom || 0);
      const bottom = Math.min(innerHeight, rect?.bottom || 0, document.querySelector('.mobileToolbarBar')?.getBoundingClientRect().top || innerHeight);
      // The terminal page itself reaches the eye (not the dashboard over it).
      const onTop = right > left && bottom > top && [0.25, 0.5, 0.75].some((fraction) => {
        const hit = document.elementFromPoint((left + right) / 2, top + (bottom - top) * fraction);
        return !!hit && main.contains(hit) && !hit.closest('#homeDashboard, [data-stack-layer]');
      });
      const shown = visible(content) && onTop;
      const cards = visible(content?.querySelector('.listBodyView'));
      window.__frames.push({
        shown,
        // PTT's own screen drawn on the terminal grid (not the easy-reading list
        // window). A blank grid is the reloaded page before PTT has drawn anything.
        native: shown && !!app.view._gridRender && !cards && /\S/.test(content.textContent),
        article: shown && !app.view._gridRender,
        cards: shown && cards,
        dashboard: visible(document.getElementById('homeDashboard')),
        alert: !!document.querySelector('#reactAlert button'),
        countdown: visible(document.getElementById('resumeLastPlace')),
        title: app.buf.getRowText(0, 0, app.buf.cols).trim().slice(0, 30),
        holding: !!app.reconnectResume.holding,
      });
    };
    window.__stopFrames = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  }, MAIN);
}

// A few more painted frames after the end, then the samples the reader saw
// (the connection alert covers the page until Reconnect is tapped).
async function stopFrames(page) {
  await page.waitForFunction((n) => window.__frames.length >= n,
    await page.evaluate(() => window.__frames.length + 8));
  const frames = await page.evaluate(() => { window.__stopFrames(); return window.__frames; });
  return frames.filter((f) => !f.alert);
}

const nativeFrames = (frames) => frames.filter((f) => f.native);

async function reloadAndWatch(page) {
  // Keep the save/read boundary at one clock time (as the search-trail recovery spec).
  await pauseClockNow(page);
  await page.reload();
  await page.clock.resume();
  await waitConnected(page);
  await watchFrames(page);
}

const listActive = (page) => expect.poll(() => page.evaluate(() => window.__app.listSession.state)).toBe('active');
const released = (page) => expect.poll(() => page.evaluate(() => window.__app.reconnectResume.holding)).toBe(false);

// Opens Alpha by its article code, so the app knows which article it is.
async function readAlpha(page, options) {
  await bootNestedShortcutSearch(page, { loggedIn: true, ...options });
  await page.evaluate(() => window.__app.aidNavigation.startResume({ kind: 'article', board: 'Test', aid: '1gIeu-3A' }));
  await waitArticle(page, 'Alpha');
  return readToMiddle(page);
}

async function readFullList(page, options) {
  await bootNestedShortcutSearch(page, { loggedIn: true, ...options });
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, FULL_LIST);
  await listActive(page);
}

for (const homeMenu of [true, false]) {
  const menu = homeMenu ? 'a home main menu' : "a main menu without My Favorites";
  test(`a reconnect from ${menu} keeps the article shown until it is back at the same line`, async ({ page }) => {
    const position = await readAlpha(page, { homeMenu });
    await watchFrames(page);
    await disconnectAndReconnect(page, { homeMenu });
    await waitArticle(page, 'Alpha');
    await expect.poll(() => topLine(page)).toBe(position);
    await released(page);
    const frames = await stopFrames(page);
    expect(nativeFrames(frames)).toEqual([]);
    // The article stays on screen until the drive reaches its board; the drive
    // then passes the board's list as easy-reading cards (as any jump to an
    // article does) and lands on the article. Never home, never a blank page.
    expect(frames[0].article).toBe(true);
    expect(frames.filter((f) => !f.article && !f.cards)).toEqual([]);
    expect(frames.filter((f) => f.dashboard)).toEqual([]);
    expect(frames.at(-1).article).toBe(true);
  });

  test(`a reconnect from ${menu} shows the article list only through easy reading`, async ({ page }) => {
    await readFullList(page, { homeMenu });
    await watchFrames(page);
    await disconnectAndReconnect(page, { homeMenu });
    await waitList(page, FULL_LIST);
    await listActive(page);
    await released(page);
    const frames = await stopFrames(page);
    expect(nativeFrames(frames)).toEqual([]);
    expect(frames.at(-1).cards).toBe(true);
  });
}

test('a reconnect into reconstructed search results paints none of the searches it replays', async ({ page }) => {
  await bootNestedShortcutSearch(page, { loggedIn: true, homeMenu: true });
  await readToMiddle(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await listActive(page);
  await watchFrames(page);
  await disconnectAndReconnect(page, { homeMenu: true });
  await waitList(page, AUTHOR_RESULTS);
  await listActive(page);
  await released(page);
  const frames = await stopFrames(page);
  expect(nativeFrames(frames)).toEqual([]);
  expect(frames.at(-1).cards).toBe(true);
});

test('a reload shows home under the countdown, keeps it while returning and lands on the list in easy reading', async ({ page }) => {
  await readFullList(page, { homeMenu: true });
  await reloadAndWatch(page);
  await nestedSessionAfterLogin(page, { homeMenu: true });
  await expect(page.locator('#resumeLastPlace')).toBeVisible();
  await expect(page.locator('#homeDashboard')).toBeVisible();
  await waitList(page, FULL_LIST);
  await listActive(page);
  await released(page);
  const frames = await stopFrames(page);
  expect(nativeFrames(frames)).toEqual([]);
  // Home is what shows under the countdown, then the list: nothing else between.
  const countdown = frames.filter((f) => f.countdown);
  expect(countdown.length).toBeGreaterThan(0);
  expect(countdown.filter((f) => !f.dashboard)).toEqual([]);
  expect(frames.at(-1).cards).toBe(true);
});

test('a reload returns to the article at the same line without painting PTT\'s screens', async ({ page }) => {
  const position = await readAlpha(page, { homeMenu: true });
  await reloadAndWatch(page);
  await nestedSessionAfterLogin(page, { homeMenu: true });
  await expect(page.locator('#homeDashboard')).toBeVisible();
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
  await released(page);
  const frames = await stopFrames(page);
  expect(nativeFrames(frames)).toEqual([]);
  expect(frames.at(-1).article).toBe(true);
});

test('canceling the countdown after a reload stays home', async ({ page }) => {
  await readFullList(page, { homeMenu: true });
  await reloadAndWatch(page);
  await nestedSessionAfterLogin(page, { homeMenu: true });
  await page.locator('#resumeLastPlace button').tap();
  await expect(page.locator('#resumeLastPlace')).toBeHidden();
  await expect(page.locator('#homeDashboard')).toBeVisible();
  // Past the countdown: nothing set off, home stays.
  await page.clock.runFor(5000);
  expect(await page.evaluate(() => window.__app.reconnectResume.hasPending())).toBe(false);
  await expect(page.locator('#homeDashboard')).toBeVisible();
  const frames = await stopFrames(page);
  expect(nativeFrames(frames)).toEqual([]);
});
