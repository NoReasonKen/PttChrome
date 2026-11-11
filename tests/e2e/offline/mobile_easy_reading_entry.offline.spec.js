const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootOffline, replayListCassette } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { bootNestedShortcutSearch, waitArticle, waitList, tapCard } = require('../helpers/article_shortcut_search');
const { installPaintedFrameProbe, waitRectStable } = require('../helpers/layout');
const { MAIN, bootDashboard, bootBoardList, boardOpened, boardListEngaged, listActive, articleRead } = require('../helpers/stack_routes');

// Inspect the renderer that actually reaches paint. A terminal buffer already
// classified as an article can still be drawn on the native grid before settle.
async function watchEntry(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(MAIN => {
    window.__entryFrames = [];
    const sample = () => {
      const app = window.__app;
      const main = document.querySelector(MAIN);
      const content = main?.querySelector('#mainContainer');
      const visible = el => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      const rect = main?.getBoundingClientRect();
      const left = Math.max(0, rect?.left || 0), right = Math.min(innerWidth, rect?.right || 0);
      const top = Math.max(0, rect?.top || 0, document.getElementById('mobileAppBar')?.getBoundingClientRect().bottom || 0);
      const bottom = Math.min(innerHeight, rect?.bottom || 0, document.querySelector('.mobileToolbarBar')?.getBoundingClientRect().top ?? innerHeight);
      const onTop = right > left && bottom > top && [0.25, 0.5, 0.75].some(fraction => {
        const hit = document.elementFromPoint((left + right) / 2, top + (bottom - top) * fraction);
        return !!hit && main.contains(hit) && !hit.closest('#homeDashboard, [data-stack-layer]');
      });
      window.__entryFrames.push({
        state: app.buf.pageState,
        surface: app.view.mobileSurface,
        grid: app.view._gridRender,
        shown: visible(content) && onTop,
        listState: app.listSession.state,
        search: !!app.searchInFlight,
        boardEntry: !!app.boardNoteSkip.active,
        loading: !!main?.classList.contains('stackEntryLoading'),
        boardList: app.buf.isBoardListScreen() || app.buf.listRenderOwner === 'board-list' ||
          app.buf.getRowText(0, 0, app.buf.cols).includes('看板列表'),
      });
    };
    window.__stopEntryWatch = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  }, MAIN);
}

async function entryFrames(page) {
  await waitRectStable(page, MAIN, { fullRect: true });
  return page.evaluate(() => { window.__stopEntryWatch(); return window.__entryFrames; });
}

for (const from of ['home', 'main menu']) {
  test(`opening an article after entering from ${from} paints no native article frame`, async ({ page }) => {
    await bootDashboard(page, loadCassette('scn-stack-home-article-back'));
    await watchEntry(page);
    if (from === 'home') {
      await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
    } else {
      await page.locator('#mobileAppBar [data-key="__homeNative"]').tap();
      await ptt.sendKey(page, 's');
      const search = page.locator('input[name="searchKeyword"]');
      await search.fill('C_Chat');
      await search.press('Enter');
    }
    await boardOpened(page);
    for (let n = 0; n < 2; n++) await ptt.sendKey(page, 'ArrowUp');
    await ptt.sendKey(page, 'Enter');
    await articleRead(page);
    const frames = await entryFrames(page);
    expect(frames.some(frame => frame.state === 3 && frame.surface === 'article' && frame.shown)).toBe(true);
    expect(frames.filter(frame => frame.surface === 'grid' && frame.grid && frame.shown)).toEqual([]);
  });
}

test('opening a board from favorites paints no native article-list frame', async ({ page }) => {
  await bootBoardList(page);
  await watchEntry(page);
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  const frames = await entryFrames(page);
  expect(frames.some(frame => frame.state === 2 && frame.surface === 'list' && frame.shown)).toBe(true);
  expect(frames.filter(frame => frame.state === 2 && frame.surface === 'grid' && frame.grid && frame.shown)).toEqual([]);
});

test('opening a board from home hides the skipped board entry screen', async ({ page }) => {
  await bootDashboard(page);
  await watchEntry(page);
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
  const frames = await entryFrames(page);
  expect(frames.some(frame => frame.surface === 'list' && frame.shown)).toBe(true);
  expect(frames.filter(frame => ['grid', 'menu'].includes(frame.surface) && frame.shown)).toEqual([]);
});

test('entering favorites from the main menu paints no native board-list frame', async ({ page }) => {
  await bootOffline(page, ptt);
  await page.evaluate(() => { window.__app.homeDashboard._state.fetchedAt = Date.now(); });
  await drawMainMenu(page);
  await page.locator('#mobileAppBar [data-key="__homeNative"]').tap();
  await watchEntry(page);
  await ptt.sendKey(page, 'f');
  await replayListCassette(page, loadCassette('scn-stack-boardlist-board'));
  await boardListEngaged(page);
  const frames = await entryFrames(page);
  expect(frames.some(frame => frame.boardList && frame.surface === 'list' && frame.shown)).toBe(true);
  expect(frames.filter(frame => frame.boardList && frame.surface === 'grid' && frame.shown)).toEqual([]);
});

for (const from of ['home', 'main menu']) {
  test(`first board and article opened from a fresh ${from} stay in easy reading`, async ({ page }, testInfo) => {
    await bootNestedShortcutSearch(page, { startAtMain: true, homeMenu: true, dynamicRows: true, ptList: true });
    expect(await page.evaluate(() => window.__app.view.useEasyReadingMode)).toBe(false);
    await page.evaluate(() => {
      const home = window.__app.homeDashboard;
      home._state.fetchedAt = Date.now();
      home._set({ boards: [{ name: 'Test', desc: 'controlled' }] });
    });
    await watchEntry(page);
    if (from === 'home') await page.locator('#homeDashboard [data-home-board="Test"]').tap();
    else {
      await page.locator('#mobileAppBar [data-key="__homeNative"]').tap();
      await ptt.sendKey(page, 's');
      const search = page.locator('input[name="searchKeyword"]');
      await search.fill('Test');
      await search.press('Enter');
    }
    await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
    await tapCard(page, '[Talk] Alpha topic');
    await waitArticle(page, 'Alpha');
    const frames = await entryFrames(page);
    expect(frames.some(frame => frame.state === 3 && frame.surface === 'article' && frame.shown)).toBe(true);
    expect(frames.filter(frame => [2, 3].includes(frame.state) && frame.surface === 'grid' && frame.shown)).toEqual([]);
    if (from === 'home')
      expect(frames.filter(frame => ['grid', 'menu'].includes(frame.surface) && frame.shown)).toEqual([]);
    if (from === 'home' && process.env.E2E_ARTIFACT_DIR)
      await testInfo.attach('easy-reading-entry', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test(`opening an article by AID from ${from} paints no native article frame`, async ({ page }) => {
    await bootNestedShortcutSearch(page, { startAtMain: true, homeMenu: true, dynamicRows: true });
    expect(await page.evaluate(() => window.__app.view.useEasyReadingMode)).toBe(false);
    await page.evaluate(() => { window.__app.homeDashboard._state.fetchedAt = Date.now(); });
    if (from === 'main menu') await page.locator('#mobileAppBar [data-key="__homeNative"]').tap();
    await watchEntry(page);
    await page.evaluate(() => window.__app.aidNavigation.startExternal('1gIeu-3A', 'Test'));
    await waitArticle(page, 'Alpha');
    const frames = await entryFrames(page);
    expect(frames.some(frame => frame.state === 3 && frame.surface === 'article' && frame.shown)).toBe(true);
    expect(frames.filter(frame => frame.state === 3 && frame.surface === 'grid' && frame.shown)).toEqual([]);
  });
}

for (const boardEntry of ['none', 'pause', 'pager', 'movie']) {
  test(`known-board entry batches the initial keys with a ${boardEntry} entry screen`, async ({ page }) => {
    await bootNestedShortcutSearch(page, { startAtMain: true, boardEntry, homeMenu: true, dynamicRows: true, ptList: true });
    await page.evaluate(() => {
      const home = window.__app.homeDashboard;
      home._state.fetchedAt = Date.now();
      home._set({ boards: [{ name: 'Test', desc: 'controlled' }] });
      window.__gestureSent = [];
    });
    await watchEntry(page);
    await page.locator('#homeDashboard [data-home-board="Test"]').tap();
    await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
    await listActive(page);
    const state = await page.evaluate(() => ({
      sent: window.__gestureSent.slice(), skipping: window.__app.boardNoteSkip.active,
      board: window.__shortcutServer.state.board, cursor: window.__shortcutServer.state.cursor
    }));
    expect(state.sent[0]).toBe('sTest\r`\f');
    const navigation = state.sent.filter(bytes => /^(?:s|q| |\x1b\[D)/.test(bytes));
    expect(navigation).toEqual(boardEntry === 'pager' ? ['sTest\r`\f', '\x1b[D\f', ' \f']
      : boardEntry === 'movie' ? ['sTest\r`\f', 'q\f'] : ['sTest\r`\f']);
    expect(state.skipping).toBe(false);
    expect(state.board).toBe('Test');
    expect(state.cursor).toBe(0);
    const frames = await entryFrames(page);
    expect(frames.some(frame => frame.surface === 'list' && frame.shown)).toBe(true);
    expect(frames.filter(frame => ['grid', 'menu'].includes(frame.surface) && frame.shown)).toEqual([]);
  });
}

test('easy reading off keeps the first favorites page native', async ({ page }) => {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: false });
  await drawMainMenu(page);
  await watchEntry(page);
  await ptt.sendKey(page, 'f');
  await replayListCassette(page, loadCassette('scn-stack-boardlist-board'));
  await page.waitForFunction(() => !window.__app.buf._settleTimer && window.__app.buf.pageState === 2);
  const frames = await entryFrames(page);
  expect(await page.evaluate(() => window.__app.boardListSession.state)).toBe('idle');
  expect(frames.some(frame => frame.boardList && frame.surface === 'grid' && frame.shown)).toBe(true);
});

test('easy reading off keeps external article navigation native', async ({ page }) => {
  await bootNestedShortcutSearch(page, { startAtMain: true, homeMenu: true, dynamicRows: true });
  await ptt.applyPrefs(page, { enableEasyReading: false });
  await watchEntry(page);
  expect(await page.evaluate(() => window.__app.aidNavigation.startExternal('1gIeu-3A', 'Test'))).toBe(true);
  await page.waitForFunction(() => {
    const app = window.__app;
    return app.buf.pageState === 3 && !app.aidNavigation.active && !app.buf.timerUpdate && !app.buf._settleTimer;
  });
  const frames = await entryFrames(page);
  expect(await page.evaluate(() => window.__app.view.useEasyReadingMode)).toBe(false);
  expect(frames.some(frame => frame.state === 3 && frame.surface === 'grid' && frame.shown)).toBe(true);
});
