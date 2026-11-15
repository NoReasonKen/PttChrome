// Recovery shows home while it drives PTT (#188). After a reconnect, home
// covers the login's main menu from its first frame and stays until the
// recovery lands; after a reload, the same, with the countdown over home first.
// Without My Favorites on the main menu there is no home: the last frame before
// that menu stays instead. Either way the destination is shown only through
// easy reading, and no frame of PTT's own screens (nor a stale login screen)
// reaches paint. Every painted
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
    // A main-menu frame reached the buffer ('change' comes before its paint).
    window.__menuSeen = false;
    const buf = window.__app.buf;
    buf.addEventListener('change', () => {
      if (buf.getRowText(0, 0, buf.cols).includes('主功能表')) window.__menuSeen = true;
    });
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
        afterMenu: !!window.__menuSeen,
        hint: (() => {
          const el = document.querySelector('.ListHint');
          return el && el.style.opacity === '1' ? el.textContent : '';
        })(),
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
// From the main menu on, the reader sees home over it or easy reading: never a
// PTT screen, never the stale frame painted before that menu.
const notHomeOrEasyReading = (frames) =>
  frames.filter((f) => f.afterMenu && !f.dashboard && !f.article && !f.cards);

const encodeBig5 = (page, text) => page.evaluate((text) => [...text].map((ch) => {
  const c = ch.charCodeAt(0);
  return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
}).join(''), text);

// PTT's screens between the reconnect and the main menu, as the auto-login
// passes them: the duplicate-login question, then the login notice.
async function loginScreens(page) {
  for (const text of ['您想刪除其他重複登入的連線嗎？[Y/n] y', '歡迎您再度拜訪，上次您是從 example 連往本站。']) {
    const data = '\x1b[H\x1b[2J' + await encodeBig5(page, text);
    const before = await page.evaluate(() => window.__frames.length);
    await page.evaluate((data) => window.__app.onData(data), data);
    await page.waitForFunction((n) => window.__frames.length > n + 1, before);
  }
}

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

test('a reconnect from a home main menu covers its login screens with home until it is back at the same line', async ({ page }) => {
  const position = await readAlpha(page, { homeMenu: true });
  // Home knows one favourite, so it has a card to tap during the run.
  await page.evaluate(() => {
    const home = window.__app.homeDashboard;
    home._state.fetchedAt = Date.now();
    home._set({ boards: [{ name: 'Test', desc: 'controlled' }] });
  });
  await watchFrames(page);
  await page.evaluate(() => window.__stubWS.close());
  await page.locator('#reactAlert button', { hasText: 'Reconnect' }).tap();
  await waitConnected(page);
  await loginScreens(page);
  // Hold PTT's answers to the run's first key, so the run can be looked at.
  await pauseClockNow(page);
  await nestedSessionAfterLogin(page, { homeMenu: true });
  await page.evaluate(() => { window.__shortcutServer.state.holdResponses = true; });
  await page.clock.resume();
  await expect.poll(() => page.evaluate(() => window.__app.aidNavigation.active)).toBe(true);
  await expect(page.locator('#homeDashboard')).toBeVisible();
  // A card tapped during the run waits for it: the busy hint, nothing sent.
  const card = page.locator('#homeDashboard [data-home-board="Test"]');
  await expect(card).toBeVisible();
  // The run waits for PTT's answer to its board jump, so nothing else is due.
  const sent = await page.evaluate(() => window.__gestureSent.slice());
  expect(sent.at(-1)).toMatch(/^sTest\r/);
  await card.tap();
  await expect(page.locator('.ListHint')).toContainText('回到斷線前的位置');
  expect(await page.evaluate(() => window.__gestureSent.slice())).toEqual(sent);
  await page.evaluate(() => window.__shortcutServer.releaseResponses());
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
  await released(page);
  const frames = await stopFrames(page);
  // The login screens before the main menu are drawn, as on any login.
  expect(frames.some((f) => !f.afterMenu && f.native)).toBe(true);
  expect(notHomeOrEasyReading(frames)).toEqual([]);
  // Home shows from the main menu while the run drives, with its progress hint.
  const run = frames.filter((f) => f.afterMenu && f.holding);
  expect(run.length).toBeGreaterThan(0);
  expect(run.filter((f) => !f.dashboard)).toEqual([]);
  expect(run.some((f) => f.hint.includes('回到斷線前的位置'))).toBe(true);
  expect(frames.at(-1).article).toBe(true);
});

test('a reconnect from a home main menu covers the run with home and lands on the article', async ({ page }) => {
  const position = await readAlpha(page, { homeMenu: true });
  await watchFrames(page);
  await disconnectAndReconnect(page, { homeMenu: true });
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
  await released(page);
  const frames = await stopFrames(page);
  expect(nativeFrames(frames)).toEqual([]);
  expect(notHomeOrEasyReading(frames)).toEqual([]);
  expect(frames.some((f) => f.afterMenu && f.dashboard)).toBe(true);
  expect(frames.at(-1).article).toBe(true);
});

test('a reconnect from a main menu without My Favorites keeps the last frame before it until it is back at the same line', async ({ page }) => {
  const position = await readAlpha(page, { homeMenu: false });
  await watchFrames(page);
  await disconnectAndReconnect(page, { homeMenu: false });
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
  await released(page);
  const frames = await stopFrames(page);
  expect(nativeFrames(frames)).toEqual([]);
  // No home to show: this login painted nothing, so the article stays until
  // the drive reaches its board; the drive then passes the board's list as
  // easy-reading cards (as any jump to an article does) and lands.
  expect(frames[0].article).toBe(true);
  expect(frames.filter((f) => !f.article && !f.cards)).toEqual([]);
  expect(frames.filter((f) => f.dashboard)).toEqual([]);
  expect(frames.at(-1).article).toBe(true);
});

for (const homeMenu of [true, false]) {
  const menu = homeMenu ? 'a home main menu' : "a main menu without My Favorites";
  test(`a reconnect from ${menu} shows the article list only through easy reading`, async ({ page }) => {
    await readFullList(page, { homeMenu });
    await watchFrames(page);
    await disconnectAndReconnect(page, { homeMenu });
    await waitList(page, FULL_LIST);
    await listActive(page);
    await released(page);
    const frames = await stopFrames(page);
    expect(nativeFrames(frames)).toEqual([]);
    if (homeMenu) expect(notHomeOrEasyReading(frames)).toEqual([]);
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
  // Hold the clock inside the 1 s countdown, so a loaded machine cannot let it
  // expire before the tap (as the search-trail recovery spec does).
  await pauseClockNow(page);
  await nestedSessionAfterLogin(page, { homeMenu: true });
  await page.clock.runFor(500);
  await page.locator('#resumeLastPlace button').tap();
  await page.clock.resume();
  await expect(page.locator('#resumeLastPlace')).toBeHidden();
  await expect(page.locator('#homeDashboard')).toBeVisible();
  // Past the countdown: nothing set off, home stays.
  await page.clock.runFor(5000);
  expect(await page.evaluate(() => window.__app.reconnectResume.hasPending())).toBe(false);
  await expect(page.locator('#homeDashboard')).toBeVisible();
  const frames = await stopFrames(page);
  expect(nativeFrames(frames)).toEqual([]);
});
