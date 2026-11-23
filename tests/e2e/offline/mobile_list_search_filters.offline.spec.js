// The easy-reading article list's other search filters on the phone (#298).
// Price, marked (G), same title (S) and thread starters (Backspace) are kinds of
// the search sheet, continuing on a second segmented row next to the old four; the title kind has a
// 排除 box for `!`. The digest is a mode, not a search: its one entry is in the
// toolbar's More sheet (「文摘」, 「離開文摘」 inside it). PTT drops every search on
// entering or leaving the digest (bbs.c#board_digest → board_select), and the
// app's own stacked pages, search trail and results context go with them. Keys,
// prompts and results are the desktop spec's (list_search_filters.offline.spec.js).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const {
  bootNestedShortcutSearch, waitList, waitArticle, waitIdle, hinted, tapShortcut, tapCard, nativeBack
} = require('../helpers/article_shortcut_search');
const { recordHints, dashboardVisible, holdBackReply, heldBack } = require('../helpers/stack_routes');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const sheet = (page) => page.locator('[data-sheet="search"]');
const input = (page) => sheet(page).locator('input[name="searchKeyword"]');
const chip = (page, kind) => sheet(page).locator(`.searchKindItem:has(input[value="${kind}"])`);
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
// What the filters sent, without the list's own cursor parking (number jumps)
// and its follow-up reads (escape sequences) around them.
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, ''))
    .filter((s) => s && !/^(10[1-4]|[1-4])\r$/.test(s) && !s.startsWith('\x1b')));
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && window.__app.commandQueue.idle && !window.__app.searchInFlight)).toBe(true);
const more = async (page, key) => {
  await page.locator('[data-key="__more"]').tap();
  const entry = page.locator(`[data-key="${key}"]`);
  await expect(entry).toBeVisible();
  await entry.tap();
};
// The app's own state about searches: stacked pages with live layers, the
// search trail, and what the controlled PTT is showing.
const ownState = (page) => page.evaluate(() => {
  const app = window.__app;
  const server = window.__shortcutServer.state;
  return {
    pages: app.navigationStack.stack.pages.length,
    layers: app.navigationStack.captured.filter(Boolean).length,
    trail: !!app.articleShortcutSearch.trail,
    ptt: server.digest ? (server.filter ? 'digest+search' : 'digest') : server.filter ? 'results' : 'full'
  };
});

async function openList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true });
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

async function openSheet(page, kind) {
  await page.locator('[data-key="__search"]').tap();
  await expect(sheet(page)).toBeVisible();
  if (kind) await chip(page, kind).locator('label').tap();
}

async function confirm(page) {
  await sheet(page).getByRole('button', { name: await text(page, 'searchModal_confirm') }).tap();
  await expect(sheet(page)).toHaveCount(0);
}

test.describe('the search sheet', () => {
  test('seven filter kinds on two segmented rows (4+3) at phone width, none cut off, no horizontal scroll, the old four first', async ({ page }) => {
    await openList(page);
    await openSheet(page);
    const kinds = await sheet(page).locator('.searchKindItem input').evaluateAll((els) => els.map((el) => el.value));
    expect(kinds).toEqual(['title', 'author', 'push', 'price', 'mark', 'sameTitle', 'newPost']);
    const fits = await sheet(page).locator('.searchKindItem').evaluateAll((els) => {
      const room = document.querySelector('[data-sheet="search"]').getBoundingClientRect();
      return els.every((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left >= room.left - 1 && r.right <= room.right + 1;
      });
    });
    expect(fits).toBe(true);
    const rows = await sheet(page).locator('[data-search-kinds="wrap"] > *').count();
    expect(rows).toBe(2);
    expect(await sheet(page).locator('[data-search-kinds="wrap"] > *').evaluateAll((els) =>
      els.map((el) => el.querySelectorAll('.searchKindItem').length))).toEqual([4, 3]);
    // The selected kind is highlighted on exactly one row, whichever it is on.
    await chip(page, 'price').locator('label').tap();
    await expect(sheet(page).locator('.searchKindItem input:checked')).toHaveCount(1);
    await expect(chip(page, 'price').locator('input')).toBeChecked();
    const scrolls = await sheet(page).evaluate((el) => {
      const own = [el, ...el.querySelectorAll('*')].filter((n) => n.scrollWidth > n.clientWidth + 1 &&
        getComputedStyle(n).overflowX !== 'visible');
      return own.map((n) => n.className);
    });
    expect(scrolls).toEqual([]);
    // The More sheet no longer lists the filters; only the digest remains.
    await page.keyboard.press('Escape');
  });

  test('price: the key and the digits go out in order', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await openSheet(page, 'price');
    expect(await sentSinceMark(page)).toEqual([]);
    await input(page).fill('150');
    await input(page).press('Enter');
    await expect(sheet(page)).toHaveCount(0);
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic', 'Charlie'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['A', '150\r']);
  });

  test('marked: m or s inside the kind', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await openSheet(page, 'mark');
    await expect(input(page)).toHaveCount(0);
    await sheet(page).locator('label', { hasText: await text(page, 'searchModal_markS') }).tap();
    await confirm(page);
    await waitList(page, { has: ['Delta topic'], lacks: ['Alpha topic', 'Beta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['G', 's\r']);
  });

  test('same title shows the article it will match and runs on submit', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await markSent(page);
    await openSheet(page, 'sameTitle');
    await expect(sheet(page).locator('[data-search-same-title]')).toHaveValue('[Talk] Beta topic');
    await expect(sheet(page).locator('[data-search-same-title]')).toBeDisabled();
    await expect(input(page)).toHaveCount(0);
    await confirm(page);
    await waitList(page, { has: ['Beta topic', 'Re: [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['S']);
  });

  test('price is in the sheet\'s history and runs again from it', async ({ page }) => {
    await openList(page);
    await openSheet(page, 'price');
    await input(page).fill('150');
    await input(page).press('Enter');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.goBack();
    await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
    await listActive(page);
    await openSheet(page, 'price');
    await markSent(page);
    await sheet(page).locator('[data-search-history-item="150"]').tap();
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['A', '150\r']);
  });

  test('thread starters, and a second one in the same results is refused with a hint', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await openSheet(page, 'newPost');
    await confirm(page);
    await waitList(page, { has: ['Alpha topic', 'Delta topic'], lacks: ['Re: [Talk] Beta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\b']);
    await markSent(page);
    await openSheet(page, 'newPost');
    await confirm(page);
    await expect.poll(async () => hinted(page, await text(page, 'searchFilter_applied'))).toBe(true);
    expect(await sentSinceMark(page)).toEqual([]);
  });

  test('the 排除 box: disabled with its reason outside results, enabled inside', async ({ page }) => {
    await openList(page);
    await openSheet(page);
    const box = sheet(page).getByRole('checkbox');
    await expect(box).toBeDisabled();
    await expect(sheet(page).locator('[data-search-exclude]')).toHaveText(await text(page, 'searchModal_excludeLabel'));
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);

    await openSheet(page, 'price');
    await input(page).fill('100');
    await input(page).press('Enter');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await openSheet(page);
    await expect(box).toBeEnabled();
    await box.check();
    await markSent(page);
    await input(page).fill('Beta');
    await input(page).press('Enter');
    await expect(sheet(page)).toHaveCount(0);
    await waitList(page, { has: ['Delta topic'], lacks: ['Beta topic', 'Alpha topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['!', 'Beta\r']);
  });

  test('the system Back leaves price results for the full list', async ({ page }) => {
    await openList(page);
    await openSheet(page, 'price');
    await input(page).fill('100');
    await input(page).press('Enter');
    await waitList(page, { has: ['Beta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.goBack();
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
  });
});

test.describe('the board jump, in the More sheet', () => {
  test('More over an article list has 跳至看板…; it opens the board-only sheet with its completion', async ({ page }) => {
    await openList(page);
    await more(page, '__boardJump');
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('.searchKindItem')).toHaveCount(0);
    await expect(sheet(page).locator('[data-board-suggest]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
  });
});

test.describe('the digest, in the More sheet', () => {
  test('More holds the digest entry only; it turns into its exit inside the digest', async ({ page }) => {
    await openList(page);
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-panel="more"] [data-key^="__filter-"]')).toHaveCount(0);
    await expect(page.locator('[data-key="__digest"]')).toHaveText(await text(page, 'mobileToolbar_digest'));
    await page.locator('[data-key="__digest"]').tap();
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-key="__digest"]')).toHaveText(await text(page, 'mobileToolbar_digestLeave'));
  });

  test('entering and leaving the digest sends the Tab alone; the full list returns where it was', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => window.__app.listSession._selectedNum)).toBe(102);
    await markSent(page);
    await more(page, '__digest');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\t']);
    await markSent(page);
    await more(page, '__digest');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\t']);
    await expect.poll(() => page.evaluate(() => window.__app.listSession._selectedNum)).toBe(102);
  });

  // Two article shortcut searches stack their articles under the results. Tab
  // from those results is PTT's board_digest: the searches are dropped there
  // (board_select), so the app's stack, trail and context drop them too.
  test('Tab from stacked search results leaves no search layer, trail or condition; Back is the digest\'s own', async ({ page }) => {
    await bootNestedShortcutSearch(page);
    await tapShortcut(page, 'author');
    await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
    await tapCard(page, '[Talk] Beta topic');
    await waitArticle(page, 'Beta');
    await tapShortcut(page, 'thread');
    await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
    await waitIdle(page);
    const before = await ownState(page);
    expect(before.pages).toBeGreaterThanOrEqual(2);
    expect(before.layers).toBeGreaterThanOrEqual(1);
    expect(before.trail).toBe(true);

    await markSent(page);
    await more(page, '__digest');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic', 'Re: [Talk] Beta topic'] });
    await listActive(page);
    // Only the Tab went out: PTT dropped the searches, nothing is replayed.
    expect(await sentSinceMark(page)).toEqual(['\t']);
    expect(await ownState(page)).toEqual({ pages: expect.any(Number), layers: 0, trail: false, ptt: 'digest' });
    expect((await ownState(page)).pages).toBeLessThanOrEqual(1);
    // No stacked layer is left to reveal.
    await expect(page.locator('[data-stack-layer]:not([data-stack-parked])')).toHaveCount(0);

    // Back from the digest is the digest's own Left: PTT leaves it for the
    // board's full list. No search comes back.
    await markSent(page);
    await nativeBack(page);
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
    await listActive(page);
    const lefts = await page.evaluate(() => window.__gestureSent.slice(window.__sentMark).filter((s) => s.startsWith('\x1b[D')));
    expect(lefts).toHaveLength(1);
    expect(await ownState(page)).toMatchObject({ layers: 0, trail: false, ptt: 'full' });
  });

  test('inside the digest: leaving it drops the searches made there, with no layer or trail left', async ({ page }) => {
    await openList(page);
    await more(page, '__digest');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await openSheet(page, 'price');
    await input(page).fill('300');
    await input(page).press('Enter');
    await waitList(page, { has: ['Delta topic'], lacks: ['Beta topic'] });
    await listActive(page);
    expect((await ownState(page)).ptt).toBe('digest+search');
    // An article opened from those results stacks the list under it.
    await tapCard(page, '[Talk] Delta topic');
    await waitArticle(page, 'Delta');
    await nativeBack(page);
    await waitList(page, { has: ['Delta topic'], lacks: ['Beta topic'] });
    await listActive(page);

    await markSent(page);
    await more(page, '__digest');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\t']);
    expect(await ownState(page)).toMatchObject({ layers: 0, trail: false, ptt: 'full' });
    await expect(page.locator('[data-stack-layer]:not([data-stack-parked])')).toHaveCount(0);
  });

  // The searches' pages go, the pages below the board's list stay: after the
  // digest round trip, Back from the full list reveals the home dashboard the
  // board was opened from at once, as it did before the reader searched.
  test('2 stacked searches, 文摘, 離開文摘: Back still reveals the home layer at once', async ({ page }) => {
    await bootNestedShortcutSearch(page, { startAtMain: true, homeMenu: true, dynamicRows: true, ptList: true });
    await page.evaluate(() => {
      const home = window.__app.homeDashboard;
      home._state.fetchedAt = Date.now();
      home._set({ boards: [{ name: 'Test', desc: 'controlled' }] });
    });
    await dashboardVisible(page);
    await page.locator('#homeDashboard [data-home-board="Test"]').tap();
    await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
    await listActive(page);
    await tapCard(page, '[Talk] Alpha topic');
    await waitArticle(page, 'Alpha');
    await tapShortcut(page, 'author');
    await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
    await tapCard(page, '[Talk] Beta topic');
    await waitArticle(page, 'Beta');
    await tapShortcut(page, 'thread');
    await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
    await waitIdle(page);
    const pages = () => page.evaluate(() => window.__app.navigationStack.stack.pages.map((p) => p.kind + (p.results ? ':results' : '')));
    expect((await pages()).length).toBeGreaterThanOrEqual(5);

    await more(page, '__digest');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    expect(await pages()).toEqual(['home', 'articleList']);
    await more(page, '__digest');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
    await listActive(page);
    expect(await pages()).toEqual(['home', 'articleList']);
    expect(await ownState(page)).toMatchObject({ trail: false, ptt: 'full' });

    const release = await holdBackReply(page);
    await nativeBack(page);
    await heldBack(page);
    await expect(page.locator('[data-stack-layer="home"]')).toBeVisible();
    await release();
    await dashboardVisible(page);
    await expect(page.locator('[data-stack-layer="home"]')).toHaveCount(0, { timeout: 10000 });
  });
});
