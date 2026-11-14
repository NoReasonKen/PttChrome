// A board search keeps the reader's page under the search sheet (#190). PTT's
// board-select prompt is data: while the sheet's bridge (or a typed board)
// owns it, the page stays on screen, and the board it leads to is shown only
// through easy reading. Every animation frame from opening the sheet to the
// end is sampled. Runs only in the offline-mobile project.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { bootNestedShortcutSearch, waitList } = require('../helpers/article_shortcut_search');
const { MAIN, listActive, dashboardVisible } = require('../helpers/stack_routes');
const { installPaintedFrameProbe } = require('../helpers/layout');

const PROMPT = '請輸入看板名稱';
const sheet = (page) => page.locator('[data-sheet="search"]');

// Samples every painted frame (helpers/layout.js installPaintedFrameProbe:
// measured after the rendering update, so only frames that reach the eye)
// until stopFrames.
async function watchFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(({ MAIN, PROMPT }) => {
    window.__frames = [];
    const visible = (el) => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const sample = () => {
      const app = window.__app;
      const main = document.querySelector(MAIN);
      const content = main?.querySelector('#mainContainer');
      const rect = main?.getBoundingClientRect();
      const left = Math.max(0, rect?.left || 0), right = Math.min(innerWidth, rect?.right || 0);
      const top = Math.max(0, rect?.top || 0, document.getElementById('mobileAppBar')?.getBoundingClientRect().bottom || 0);
      const bottom = Math.min(innerHeight, rect?.bottom || 0);
      // The terminal page itself reaches the eye (not the dashboard over it).
      const onTop = right > left && bottom > top && [0.25, 0.5, 0.75].some((fraction) => {
        const hit = document.elementFromPoint((left + right) / 2, top + (bottom - top) * fraction);
        return !!hit && main.contains(hit) && !hit.closest('#homeDashboard, [data-stack-layer]');
      });
      const shown = visible(content) && onTop;
      const listView = content?.querySelector('.listBodyView');
      window.__frames.push({
        surface: app.view.mobileSurface,
        shown,
        dashboard: visible(document.getElementById('homeDashboard')),
        prompt: shown && (content.textContent || '').includes(PROMPT),
        cards: visible(listView),
        scrollTop: listView ? Math.round(listView.scrollTop) : null,
        state: app.buf.pageState,
        mode: app.buf.listRenderMode,
        holding: !!app.boardSearchHold?.holding,
      });
    };
    window.__stopFrames = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  }, { MAIN, PROMPT });
}

// A few more painted frames after the end, then the samples.
async function stopFrames(page) {
  await page.waitForFunction((n) => window.__frames.length >= n,
    await page.evaluate(() => window.__frames.length + 8));
  return page.evaluate(() => { window.__stopFrames(); return window.__frames; });
}

// A frame where PTT's own screen reaches the reader: the terminal grid, the
// native menu, or the board-select prompt drawn on any surface.
const nativeFrames = (frames) =>
  frames.filter((f) => f.shown && (['grid', 'menu'].includes(f.surface) || f.prompt));

async function bootHome(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true, homeMenu: true, dynamicRows: true, ptList: true });
  await page.evaluate(() => {
    const home = window.__app.homeDashboard;
    home._state.fetchedAt = Date.now();
    home._set({ boards: [{ name: 'Test', desc: 'controlled' }] });
  });
  await dashboardVisible(page);
}

async function chooseBoardKind(page) {
  const radio = sheet(page).locator('input[value="board"]');
  if (await radio.count()) {
    const id = await radio.getAttribute('id');
    await sheet(page).locator(`label[for="${id}"]`).tap();
  }
}

async function submitBoard(page, name) {
  const search = page.locator('input[name="searchKeyword"]');
  await search.fill(name);
  await search.press('Enter');
}

test.describe('手機：看板搜尋留住原畫面 (#190)', () => {
  test('searching a board from home lands on the board with no native frame, every frame', async ({ page }) => {
    await bootHome(page);
    await watchFrames(page);
    await page.locator('[data-key="__search"]').tap();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('[data-board-suggest="ready"]')).toHaveCount(1);
    await submitBoard(page, 'Test');
    await waitList(page, { has: ['Alpha topic'] });
    await listActive(page);
    const frames = await stopFrames(page);
    expect(frames.some((f) => f.holding)).toBe(true);
    expect(nativeFrames(frames)).toEqual([]);
    expect(frames.some((f) => f.cards && f.shown)).toBe(true);
    // The dashboard covers the main menu until the board is shown.
    const firstList = frames.findIndex((f) => f.cards && f.shown);
    expect(frames.slice(0, firstList).filter((f) => !f.dashboard)).toEqual([]);
  });

  for (const key of ['s', 'S']) {
    test(`typed search key ${key} at home keeps the dashboard until the board, every frame`, async ({ page }) => {
      await bootHome(page);
      await watchFrames(page);
      await ptt.sendKey(page, key);
      await expect(sheet(page)).toBeVisible();
      await expect(sheet(page).locator('[data-board-suggest="ready"]')).toHaveCount(1);
      await submitBoard(page, 'Test');
      await waitList(page, { has: ['Alpha topic'] });
      await listActive(page);
      const frames = await stopFrames(page);
      expect(frames.some((f) => f.holding)).toBe(true);
      expect(nativeFrames(frames)).toEqual([]);
      expect(frames.some((f) => f.cards && f.shown)).toBe(true);
      // Either search key opens the sheet over the dashboard (#191), and the
      // dashboard covers the main menu until the board is shown.
      const firstList = frames.findIndex((f) => f.cards && f.shown);
      expect(frames.slice(0, firstList).filter((f) => !f.dashboard)).toEqual([]);
    });
  }

  test('closing the sheet at home keeps the dashboard, every frame', async ({ page }) => {
    await bootOffline(page, ptt);
    await page.evaluate(() => { window.__app.homeDashboard._state.fetchedAt = Date.now(); });
    await drawMainMenu(page);
    await dashboardVisible(page);
    await page.evaluate(() => {
      window.__sent = [];
      window.__stubWSSent = (s) => window.__sent.push(s);
    });
    const sent = () => page.evaluate(() => window.__sent.join(''));
    await watchFrames(page);
    await page.locator('[data-key="__search"]').tap();
    await expect(sheet(page)).toBeVisible();
    await expect.poll(sent).toContain('s');
    // PTT's prompt answers the `s` the bridge sent.
    await page.evaluate(async () => {
      const { u2b } = await import('/src/js/string_util.js');
      window.__app.onData(
        '\x1b[2J\x1b[1;1H\x1b[7m' + u2b('【 選擇看板 】') + '\x1b[m' +
          '\x1b[2;1H' + u2b('請輸入看板名稱(按空白鍵自動搜尋): ') +
          '\x1b[30;47m' + ' '.repeat(20) + '\x1b[m\x1b[2;35H'
      );
    });
    await expect(sheet(page).locator('[data-board-suggest="ready"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(sent).toContain('\x03');
    await drawMainMenu(page);
    await dashboardVisible(page);
    await expect.poll(() => page.evaluate(() => !window.__app.boardSearchHold)).toBe(true);
    const frames = await stopFrames(page);
    expect(frames.some((f) => f.holding)).toBe(true);
    expect(nativeFrames(frames)).toEqual([]);
    expect(frames.filter((f) => !f.dashboard)).toEqual([]);
  });

  for (const end of ['cancel', 'submit']) {
    test(`a board search over the article list keeps the list on screen (${end}), every frame`, async ({ page }) => {
      await bootHome(page);
      await page.locator('#homeDashboard [data-home-board="Test"]').tap();
      await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
      await listActive(page);
      // Over an article list PTT's prompt has its own title row (a menu title
      // there would read as leaving the board).
      await page.evaluate(() => { window.__shortcutServer.state.selectTitle = true; });
      await watchFrames(page);
      await page.locator('[data-key="__search"]').tap();
      await expect(sheet(page)).toBeVisible();
      await chooseBoardKind(page);
      await expect(sheet(page).locator('[data-board-suggest="ready"]')).toHaveCount(1);
      if (end === 'cancel') {
        await page.keyboard.press('Escape');
        await expect(sheet(page)).toHaveCount(0);
      } else {
        await submitBoard(page, 'Test');
      }
      await expect.poll(() => page.evaluate(() => !window.__app.boardSearchHold)).toBe(true);
      await listActive(page);
      const frames = await stopFrames(page);
      expect(frames.some((f) => f.holding)).toBe(true);
      expect(nativeFrames(frames)).toEqual([]);
      // The easy-reading list stays the page the reader sees throughout.
      expect(frames.filter((f) => !f.cards)).toEqual([]);
      // A cancel gives back the list as it was: its rows and scroll stay.
      if (end === 'cancel')
        expect(frames.filter((f) => f.scrollTop !== frames[0].scrollTop)
          .map((f) => `${f.scrollTop} ${f.mode} holding=${f.holding}`)).toEqual([]);
    });
  }
});
