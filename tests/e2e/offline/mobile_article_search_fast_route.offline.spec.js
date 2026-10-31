// Article shortcut searches skip the waits and round trips they do not need
// (#86). The results take over as soon as the search lands. From an article
// opened from its board's full list, harmless keys go together and the author
// id waits for the verified prompt; anything else takes the verified route.
// The controlled PTT board is helpers/article_shortcut_search.js; the app,
// touch input and Back are real.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const {
  bootNestedShortcutSearch, tapShortcut, tapCard, nativeBack, waitArticle, waitList
} = require('../helpers/article_shortcut_search');

const AUTHOR_RESULTS = { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] };
const THREAD_RESULTS = { has: ['[Talk] Beta topic', 'Re: [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic'] };
const LEFT = '\x1b[D';

// What the reader sees `ms` after the search's results are sent: whether the
// easy-reading list has taken over and the source article still covers it.
async function watchAfterResults(page, submit, ms) {
  await page.evaluate(([submit, ms]) => {
    const send = window.__stubWSSent;
    window.__stubWSSent = bytes => {
      send(bytes);
      if (!bytes.includes(submit)) return;
      setTimeout(() => {
        const app = window.__app;
        window.__afterResults = { list: app.listSession.state, covered: !!app.articleShortcutSearch.cover };
      }, ms);
    };
  }, [submit, ms]);
}

// The article with `title` and `body`, open as PTT's first screen (no list
// below it: the verified route), or opened from the board's full list in the
// easy-reading list (the fast route). `squeezedFooter`: see the board's state.
async function openArticle(page, { route, title, body, squeezedFooter = false, ...options }) {
  await bootNestedShortcutSearch(page, { easyList: true, urls: true, ...options });
  if (route === 'fast' || body !== 'Alpha') {
    // The app guards system Back only once the reader has acted.
    await ptt.sendKey(page, 'ArrowLeft');
    await waitList(page, { has: ['Delta topic'] });
    await page.evaluate(squeezed => { window.__shortcutServer.state.squeezedFooter = squeezed; }, squeezedFooter);
    await tapCard(page, title);
    await waitArticle(page, body);
  }
  if (route === 'verified' && body !== 'Alpha') throw new Error('the verified route starts on Alpha');
  await page.evaluate(() => { window.__gestureSent = []; });
}

// The commands sent to PTT, without the repaint requests appended to them.
const sent = page => page.evaluate(() => window.__gestureSent.map(bytes => bytes.replace(/\f/g, '')).filter(Boolean));

// The commands the search sent up to and including `last`; the easy-reading
// list sends its own once the results have landed.
async function sentUntil(page, last) {
  const all = await sent(page);
  return all.slice(0, all.findIndex(bytes => bytes.includes(last)) + 1);
}

// The results the reader is shown and the entry selected in them. PTT's own
// cursor moves on once the easy-reading list fills its pages.
const shownResults = page => page.evaluate(() => {
  const shown = window.__app.listSession.readingPosition();
  return shown && { mode: shown.mode, cursorNum: shown.cursorNum };
});
// The newest of two results.
const NEWEST = { mode: 'select', cursorNum: 2 };

test('the results of a shortcut search take over as soon as the search lands', async ({ page }) => {
  await openArticle(page, { route: 'verified', title: '[Talk] Alpha topic', body: 'Alpha' });
  // Well under the resume probe's quiet wait (250 ms).
  await watchAfterResults(page, 'alice\r', 120);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await expect.poll(() => page.evaluate(() => window.__afterResults)).toEqual({ list: 'active', covered: false });
});

// Both routes land on the same results, the same selection and the same Back.
for (const route of ['verified', 'fast']) {
  test(`same-author search by the ${route} route lands on its results, newest selected, and Back returns to the source`, async ({ page }) => {
    await openArticle(page, { route, title: '[Talk] Alpha topic', body: 'Alpha' });
    await tapShortcut(page, 'author');
    await waitList(page, AUTHOR_RESULTS);
    expect(await shownResults(page)).toEqual(NEWEST);
    await nativeBack(page);
    await waitArticle(page, 'Alpha');
  });
}

// The reply in Beta's thread; its title names a single card.
const REPLY = { title: 'Re: [Talk] Beta topic', body: 'Charlie' };

test('same-thread search by the fast route lands on its results and Back returns to the source', async ({ page }) => {
  await openArticle(page, { route: 'fast', ...REPLY });
  await tapShortcut(page, 'thread');
  await waitList(page, THREAD_RESULTS);
  expect(await shownResults(page)).toEqual(NEWEST);
  await nativeBack(page);
  await waitArticle(page, 'Charlie');
});

test('same-author search from an article opened from its board\'s full list takes two round trips', async ({ page }) => {
  await openArticle(page, { route: 'fast', title: '[Talk] Alpha topic', body: 'Alpha' });
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  expect(await sentUntil(page, 'alice\r')).toEqual([LEFT + 'a', 'alice\r']);
});

test('same-thread search from an article opened from its board\'s full list takes one round trip', async ({ page }) => {
  await openArticle(page, { route: 'fast', ...REPLY });
  await tapShortcut(page, 'thread');
  await waitList(page, THREAD_RESULTS);
  expect(await sentUntil(page, 'S')).toEqual([LEFT + 'S']);
});

test('an article opened from search results takes the verified route', async ({ page }) => {
  await openArticle(page, { route: 'verified', title: '[Talk] Alpha topic', body: 'Alpha' });
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await page.evaluate(() => { window.__gestureSent = []; });
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  const keys = await sentUntil(page, 'alice\r');
  expect(keys).not.toContain(LEFT + 'a');
  expect(keys).toContain('#1gIeu-3B\r');
});

// pmore's movies answer Left themselves; an article whose footer does not
// prove plain reading is treated the same.
test('an article whose footer does not prove plain reading takes the verified route', async ({ page }) => {
  await openArticle(page, { route: 'fast', title: '[Talk] Alpha topic', body: 'Alpha', squeezedFooter: true });
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  const keys = await sentUntil(page, 'alice\r');
  expect(keys).not.toContain(LEFT + 'a');
  expect(keys).toContain('#1gIeu-3A\r');
});

// The legacy caption cannot tell results from the full list, so the reading
// position names no results mode there.
test('same-thread search on a board with the legacy list caption takes the verified route to the same results and Back', async ({ page }) => {
  await openArticle(page, { route: 'fast', ...REPLY, legacyCaptions: true });
  await tapShortcut(page, 'thread');
  await waitList(page, THREAD_RESULTS);
  const keys = await sentUntil(page, 'S');
  expect(keys).toContain('#1gIeu-3C\r');
  expect(keys[keys.length - 1]).toBe('S');
  // Under the legacy caption the list takes the results over after its quiet wait.
  await expect.poll(async () => (await shownResults(page))?.cursorNum).toBe(NEWEST.cursorNum);
  await nativeBack(page);
  await waitArticle(page, 'Charlie');
});

// A stale rule: Left returned to results, where `a` adds a condition.
test('when PTT asks to add a condition instead, the prompt is left empty and the verified route runs', async ({ page }) => {
  await openArticle(page, { route: 'fast', title: '[Talk] Alpha topic', body: 'Alpha' });
  // PTT's list below is already results, unknown to the app.
  await page.evaluate(() => {
    window.__shortcutServer.state.filter = { match: article => article.author === 'alice' };
  });
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  const keys = await sentUntil(page, 'alice\r');
  expect(keys.slice(0, 2)).toEqual([LEFT + 'a', '\r']);
  expect(keys).toContain('#1gIeu-3A\r');
  expect(keys.slice(-2)).toEqual(['a', 'alice\r']);
  expect(await shownResults(page)).toEqual(NEWEST);
});

// As on an empty list (read.c#select_read returns without a prompt), or any
// screen where `a` is no command.
test('the author id is never sent when the fresh-search prompt does not come', async ({ page }) => {
  await openArticle(page, { route: 'fast', title: '[Talk] Alpha topic', body: 'Alpha' });
  await page.evaluate(() => { window.__shortcutServer.state.promptless = true; });
  await tapShortcut(page, 'author');
  // The open step gives up after its hard budget (5 s).
  await expect.poll(() => page.evaluate(() => window.__app.articleShortcutSearch.active), { timeout: 15000 }).toBe(false);
  expect((await sent(page)).filter(bytes => bytes.includes('alice'))).toEqual([]);
});
