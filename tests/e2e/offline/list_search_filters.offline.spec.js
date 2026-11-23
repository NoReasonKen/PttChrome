// The easy-reading article list's other search filters on the desktop (#298).
// A price, G marked (m/s) and S same title / Backspace thread starters are kinds
// of the search sheet next to title, author, push and board; `!` is the title
// kind's 排除 box. Keys: A, G and ! open the sheet on their kind; S, Backspace
// and Tab send at once. Tab is the digest, a mode: PTT drops every search on
// entering or leaving it (bbs.c#board_digest → board_select), and so do the
// app's own search trail and context. Prompts and results follow pttbbs
// read.c#select_read / ask_filter_predicate; the controlled PTT is
// helpers/article_shortcut_search.js. The phone's entrances are in
// mobile_list_search_filters.offline.spec.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, hinted } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const dialog = (page) => page.getByRole('dialog');
const input = (page) => dialog(page).locator('input[name="searchKeyword"]');
const confirmButton = async (page) => dialog(page).getByRole('button', { name: await text(page, 'searchModal_confirm') });
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
// What the filters sent, without the list's own cursor parking (number jumps)
// and its follow-up reads (escape sequences) around them.
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, ''))
    .filter((s) => s && !/^(10[1-4]|[1-4])\r$/.test(s) && !s.startsWith('\x1b')));
const appliedHint = (page) => text(page, 'searchFilter_applied').then((t) => hinted(page, t));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && window.__app.commandQueue.idle && !window.__app.searchInFlight)).toBe(true);
const chip = (page, kind) => dialog(page).locator(`.searchKindItem:has(input[value="${kind}"])`);

async function openList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true });
  // No background reads: the keys sent are the sequence's alone.
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

async function submitSheet(page, value) {
  await expect(dialog(page)).toBeVisible();
  await input(page).fill(value);
  await input(page).press('Enter');
  await expect(dialog(page)).toHaveCount(0);
}

test.describe('the sheet offers the new kinds next to the old four', () => {
  test('/ opens the sheet with seven filter kinds on two segmented rows (4+3), none of them the board jump, no horizontal scroll', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('/');
    await expect(dialog(page).locator('[data-search-kinds="wrap"]')).toBeVisible();
    expect(await dialog(page).locator('[data-search-kinds="wrap"] > *').count()).toBe(2);
    const scrolls = await dialog(page).evaluate((el) =>
      [el, ...el.querySelectorAll('*')].filter((n) => n.scrollWidth > n.clientWidth + 1 &&
        getComputedStyle(n).overflowX !== 'visible').map((n) => n.className));
    expect(scrolls).toEqual([]);
    const kinds = await dialog(page).locator('.searchKindItem input').evaluateAll((els) => els.map((el) => el.value));
    expect(kinds).toEqual(['title', 'author', 'push', 'price', 'mark', 'sameTitle', 'newPost']);
  });

  test('S as a kind shows the title it will match and runs on submit', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(102);
    await page.keyboard.press('/');
    await chip(page, 'sameTitle').locator('label').click();
    await expect(dialog(page).locator('[data-search-same-title]')).toHaveValue('[Talk] Beta topic');
    await expect(dialog(page).locator('[data-search-same-title]')).toBeDisabled();
    await expect(input(page)).toHaveCount(0);
    await markSent(page);
    await (await confirmButton(page)).click();
    await waitList(page, { has: ['Beta topic', 'Re: [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic'] });
    await listActive(page);
    // PTT's own S, no prompt; the sheet only showed the title it matches.
    expect(await sentSinceMark(page)).toEqual(['S']);
  });

  test('Backspace as a kind: nothing to type, ^H on submit', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('/');
    await chip(page, 'newPost').locator('label').click();
    await expect(input(page)).toHaveCount(0);
    await markSent(page);
    await (await confirmButton(page)).click();
    await waitList(page, { has: ['Alpha topic', 'Delta topic'], lacks: ['Re: [Talk] Beta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\b']);
  });
});

test.describe('board jump (s)', () => {
  test('s opens the board-only sheet over the article list; the filter kinds are not offered there', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('s');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('.searchKindItem')).toHaveCount(0);
    await expect(dialog(page).locator('[data-board-suggest]')).toHaveCount(1);
  });
});

test.describe('price history', () => {
  test('a price search is recorded and can be run again from the sheet\'s history', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('A');
    await submitSheet(page, '150');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.keyboard.press('ArrowLeft');
    await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
    await listActive(page);
    await page.keyboard.press('A');
    const item = dialog(page).locator('[data-search-history-item="150"]');
    await expect(item).toHaveCount(1);
    await markSent(page);
    await item.click();
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['A', '150\r']);
  });
});

test.describe('price (A)', () => {
  test('A opens the price kind; the key goes out, then the digits once the prompt shows', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await page.keyboard.press('A');
    await expect(dialog(page)).toBeVisible();
    await expect(chip(page, 'price').locator('input')).toBeChecked();
    expect(await sentSinceMark(page)).toEqual([]);
    await submitSheet(page, '150');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic', 'Charlie'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['A', '150\r']);
  });

  test('a price that PTT would cancel (0, text) cannot be submitted', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('A');
    for (const [value, enabled] of [['0', false], ['12a', false], ['1', true]]) {
      await input(page).fill(value);
      if (enabled) await expect(await confirmButton(page)).toBeEnabled();
      else await expect(await confirmButton(page)).toBeDisabled();
    }
  });

  test('a price nothing reaches keeps the list and PTT\'s notice is dismissed', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('A');
    await submitSheet(page, '9999');
    await expect.poll(() => page.evaluate(() => window.__shortcutServer.state.surface)).toBe('empty');
    await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
    await listActive(page);
  });
});

test.describe('marked (G)', () => {
  test('G opens the mark kind: m or s is chosen inside it and answers PTT\'s prompt', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await page.keyboard.press('G');
    await expect(dialog(page)).toBeVisible();
    await expect(input(page)).toHaveCount(0);
    await dialog(page).locator('label', { hasText: await text(page, 'searchModal_markS') }).click();
    await (await confirmButton(page)).click();
    await waitList(page, { has: ['Delta topic'], lacks: ['Alpha topic', 'Beta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['G', 's\r']);
  });

  test('m is the default', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await page.keyboard.press('G');
    await (await confirmButton(page)).click();
    await waitList(page, { has: ['Alpha topic'], lacks: ['Beta topic', 'Delta topic'] });
    expect(await sentSinceMark(page)).toEqual(['G', 'm\r']);
  });

  test('the same mark twice in one search is refused locally with a hint', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('A');
    await submitSheet(page, '1');
    await waitList(page, { has: ['Alpha topic', 'Delta topic'], lacks: ['Charlie'] });
    await listActive(page);
    await page.keyboard.press('G');
    await (await confirmButton(page)).click();
    await waitList(page, { has: ['Alpha topic'], lacks: ['Delta topic'] });
    await listActive(page);
    await markSent(page);
    await page.keyboard.press('G');
    await (await confirmButton(page)).click();
    await expect.poll(() => appliedHint(page)).toBe(true);
    expect(await sentSinceMark(page)).toEqual([]);
  });
});

test.describe('exclude: the title kind\'s 排除 box (!)', () => {
  test('! inside results opens the title kind with the box checked; the keyword goes out after PTT\'s 排除標題 prompt', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('A');
    await submitSheet(page, '100');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await markSent(page);
    await page.keyboard.press('!');
    await expect(chip(page, 'title').locator('input')).toBeChecked();
    await expect(dialog(page).getByRole('checkbox')).toBeChecked();
    await expect(dialog(page).getByRole('checkbox')).toBeEnabled();
    await submitSheet(page, 'Beta');
    await waitList(page, { has: ['Delta topic'], lacks: ['Beta topic', 'Alpha topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['!', 'Beta\r']);
  });

  test('outside results the box is disabled with its reason, and a keyword searches as an ordinary title', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('!');
    const box = dialog(page).getByRole('checkbox');
    await expect(box).toBeDisabled();
    await expect(box).not.toBeChecked();
    // No explanatory text: only the label.
    await expect(dialog(page).locator('[data-search-exclude]')).toHaveText(await text(page, 'searchModal_excludeLabel'));
    await markSent(page);
    await submitSheet(page, 'Beta');
    await waitList(page, { has: ['Beta topic'], lacks: ['Delta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['/', 'Beta\r']);
  });

  test('the box can be switched off inside results: an ordinary added title', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('A');
    await submitSheet(page, '100');
    await waitList(page, { has: ['Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.keyboard.press('!');
    await dialog(page).getByRole('checkbox').uncheck();
    await markSent(page);
    await submitSheet(page, 'Delta');
    await waitList(page, { has: ['Delta topic'], lacks: ['Beta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['/', 'Delta\r']);
  });
});

test.describe('same title (S) and thread starters (Backspace) keys', () => {
  test('S sends its key alone and lists the thread of the selected article', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(102);
    await markSent(page);
    await page.keyboard.press('Shift+S');
    await waitList(page, { has: ['Beta topic', 'Re: [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['S']);
    // Not a title search: nothing in the title history.
    await page.keyboard.press('/');
    await expect(dialog(page).locator('[data-search-history-item]')).toHaveCount(0);
  });

  test('a second S in the same results does nothing on PTT, so it is refused with a hint', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('Shift+S');
    await waitList(page, { has: ['Alpha topic'], lacks: ['Beta topic'] });
    await listActive(page);
    await markSent(page);
    await page.keyboard.press('Shift+S');
    await expect.poll(() => appliedHint(page)).toBe(true);
    expect(await sentSinceMark(page)).toEqual([]);
  });

  test('Left leaves the results for the full list', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('Shift+S');
    await waitList(page, { has: ['Alpha topic'], lacks: ['Beta topic'] });
    await listActive(page);
    await page.keyboard.press('ArrowLeft');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
  });

  test('Backspace sends ^H and stacks with another condition; its repeat is refused', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await page.keyboard.press('Backspace');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'], lacks: ['Re: [Talk] Beta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\b']);
    await page.keyboard.press('A');
    await submitSheet(page, '100');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await markSent(page);
    await page.keyboard.press('Backspace');
    await expect.poll(() => appliedHint(page)).toBe(true);
    expect(await sentSinceMark(page)).toEqual([]);
  });
});

// The digest is a mode: PTT drops the search on entering and leaving it
// (bbs.c#board_digest), and the app's own trail, context and stacked pages go too.
const ownState = (page) => page.evaluate(() => {
  const app = window.__app;
  return {
    trail: !!app.articleShortcutSearch.trail,
    layers: document.querySelectorAll('[data-stack-layer]').length,
    surface: window.__shortcutServer.state.digest ? 'digest' : window.__shortcutServer.state.filter ? 'results' : 'full'
  };
});

test.describe('digest (Tab)', () => {
  test('Tab enters the digest list; Tab again returns to the full list where it was', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(102);
    await markSent(page);
    await page.keyboard.press('Tab');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\t']);
    await markSent(page);
    await page.keyboard.press('Tab');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\t']);
    await expect.poll(() => selectedNum(page)).toBe(102);
  });

  test('Tab inside search results drops the searches, as PTT does (no conditions carried)', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('Backspace');
    await waitList(page, { has: ['Alpha topic'], lacks: ['Re: [Talk] Beta topic'] });
    await listActive(page);
    await markSent(page);
    await page.keyboard.press('Tab');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    // Only the Tab went out: nothing is replayed after it.
    expect(await sentSinceMark(page)).toEqual(['\t']);
    expect(await page.evaluate(() => window.__shortcutServer.state.filter)).toBeNull();
    // The digest's own Left leaves it for the full list; no search comes back.
    await page.keyboard.press('ArrowLeft');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic', 'Re: [Talk] Beta topic'] });
  });

  test('a search inside the digest is ordinary; Tab leaving it drops that search too', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('Tab');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.keyboard.press('A');
    await submitSheet(page, '300');
    await waitList(page, { has: ['Delta topic'], lacks: ['Beta topic'] });
    await listActive(page);
    // Exclude is allowed inside a search made in the digest.
    await page.keyboard.press('!');
    await expect(dialog(page).getByRole('checkbox')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await markSent(page);
    await page.keyboard.press('Tab');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
    await listActive(page);
    expect(await sentSinceMark(page)).toEqual(['\t']);
    expect(await ownState(page)).toMatchObject({ surface: 'full', trail: false });
  });

  test('the digest keeps the search keys: A works inside it', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('Tab');
    await waitList(page, { has: ['Beta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.keyboard.press('Shift+A');
    await expect(dialog(page)).toBeVisible();
  });

  test('Left leaves a search made in the digest for the digest, then the digest for the full list', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('Tab');
    await waitList(page, { has: ['Beta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.keyboard.press('A');
    await submitSheet(page, '300');
    await waitList(page, { has: ['Delta topic'], lacks: ['Beta topic'] });
    await listActive(page);
    await page.keyboard.press('ArrowLeft');
    await waitList(page, { has: ['Beta topic', 'Delta topic'], lacks: ['Alpha topic'] });
    await listActive(page);
    await page.keyboard.press('ArrowLeft');
    await waitList(page, { has: ['Alpha topic', 'Beta topic', 'Delta topic'] });
  });
});
