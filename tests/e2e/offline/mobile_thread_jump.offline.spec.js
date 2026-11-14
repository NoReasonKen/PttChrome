// Same-thread jumps whose target lies beyond PTT's search range (#65) land
// through a hidden same-thread search, with the source article kept on screen
// and the progress bar running until the target shows.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { revealArticleDrawer } = require('../helpers/article_gestures');
const { THREAD, NEAR_REPLY_BOARD, bootThreadBoard, listActive, watchScreen, stopWatching, sent, server } = require('../helpers/thread_jump');
const { watchHold, keyCount, sentSince, expectArticleHeld, pullDown } = require('../helpers/article_hold');

const body = num => `Body of article ${num} by`;

async function jump(page, key) {
  await revealArticleDrawer(page);
  await page.locator(`[data-article-shortcut="${key}"]`).tap();
}

async function landedOn(page, num) {
  await expect.poll(() => page.locator('.main').first().innerText()).toContain(body(num));
  await expect.poll(async () => (await server(page)).surface).toBe('article');
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.threadJump.active)).toBe(true);
}

// From the tap until the target shows, the reader sees the source article
// under its own title with the progress bar running: no list, no results.
function expectHiddenRoute(seen, from, to) {
  const landed = seen.findIndex(entry => entry.screen.includes(body(to)));
  expect(landed, JSON.stringify(seen)).toBeGreaterThan(0);
  const route = seen.slice(0, landed);
  for (const entry of route) {
    expect(entry.screen, JSON.stringify(seen)).toContain(body(from));
    expect([THREAD, 'Re: ' + THREAD], JSON.stringify(seen)).toContain(entry.title);
  }
  const busy = route.findIndex(entry => entry.busy);
  expect(busy, JSON.stringify(seen)).toBeGreaterThanOrEqual(0);
  expect(route.slice(busy).every(entry => entry.busy), JSON.stringify(seen)).toBe(true);
}

for (const [key, target] of [['[', 40], ['=', 1], [']', 1150]]) {
  test(`a far ${key} lands on its target while the source article stays on screen`, async ({ page }) => {
    await bootThreadBoard(page, { open: 600 });
    await watchScreen(page);
    await jump(page, key);
    await landedOn(page, target);
    await expect.poll(() => page.locator('.main').first().evaluate(el => el.scrollTop)).toBe(0);
    expectHiddenRoute(await stopWatching(page), 600, target);
    expect(await server(page)).toMatchObject({ open: target, filter: null, cursor: target });
  });
}

test('a first-in-thread jump that PTT lands on a reply goes on to the original', async ({ page }) => {
  await bootThreadBoard(page, { open: 1150, thread: NEAR_REPLY_BOARD });
  await watchScreen(page);
  await jump(page, '=');
  await landedOn(page, 1);
  expectHiddenRoute(await stopWatching(page), 1150, 1);
  expect(await server(page)).toMatchObject({ open: 1, filter: null, cursor: 1 });
});

test('a first-in-thread jump in a thread whose original was deleted lands on its earliest reply', async ({ page }) => {
  await bootThreadBoard(page, { open: 1150, thread: NEAR_REPLY_BOARD.filter(article => article.num !== 1) });
  await watchScreen(page);
  await jump(page, '=');
  await landedOn(page, 40);
  expectHiddenRoute(await stopWatching(page), 1150, 40);
  expect(await server(page)).toMatchObject({ open: 40, filter: null, cursor: 40 });
});

test('a first-in-thread jump that PTT lands on the original takes one round trip', async ({ page }) => {
  await bootThreadBoard(page, { open: 40 });
  await jump(page, '=');
  await landedOn(page, 1);
  expect(await sent(page)).toEqual(['=\f']);
});

test('Back from a far target returns to the full article list on the target', async ({ page }) => {
  await bootThreadBoard(page, { open: 600 });
  await jump(page, '[');
  await landedOn(page, 40);
  await ptt.sendKey(page, 'ArrowLeft');
  await expect.poll(() => server(page)).toMatchObject({ surface: 'list', filter: null, cursor: 40 });
});

// The list is a page of its own (#127): Back shows it as it was left, with
// the article opened from it selected, and PTT's selection moves back there.
test('an article opened from the easy-reading list returns to that list as it was left after a far jump', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, fromList: true });
  await watchScreen(page);
  await jump(page, '[');
  await landedOn(page, 40);
  expectHiddenRoute(await stopWatching(page), 600, 40);
  await ptt.sendKey(page, 'ArrowLeft');
  await listActive(page);
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
  expect(await server(page)).toMatchObject({ surface: 'list', filter: null, cursor: 600 });
  expect(await page.evaluate(() => window.__app.listSession._selectedNum)).toBe(600);
  await expect(page.locator('.main').first().locator('.listCard[data-list-author="carol"]')).toBeVisible();
});

test('a jump in range lands with one round trip', async ({ page }) => {
  await bootThreadBoard(page, { open: 40 });
  await jump(page, '[');
  await landedOn(page, 1);
  expect(await sent(page)).toEqual(['[\f']);
});

test('a previous-in-thread jump with no earlier article shows the same article again', async ({ page }) => {
  await bootThreadBoard(page, { open: 1 });
  await watchScreen(page);
  await jump(page, '[');
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && (window.__threadSent.length > 1))).toBe(true);
  await expect.poll(async () => (await server(page)).surface).toBe('article');
  const seen = await stopWatching(page);
  expect(seen.every(entry => entry.screen.includes(body(1)) || entry.screen === ''), JSON.stringify(seen)).toBe(true);
  expect(await server(page)).toMatchObject({ open: 1, filter: null, cursor: 1 });
});

test('a next-in-thread jump with no later article returns to the article list', async ({ page }) => {
  await bootThreadBoard(page, { open: 1150 });
  await jump(page, ']');
  await expect.poll(() => server(page)).toMatchObject({ surface: 'list', filter: null, cursor: 1150 });
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
  await expect.poll(() => page.locator('.main').first().innerText()).toContain('dave');
});

// The article slides away over the list it was opened from, as on Back; the
// native list never shows on the way.
test('a next-in-thread jump with no later article slides back to the easy-reading list', async ({ page }) => {
  await bootThreadBoard(page, { open: 1150, fromList: true });
  await watchScreen(page);
  await jump(page, ']');
  await listActive(page);
  await expect.poll(() => page.evaluate(() => window.__app.listSession._selectedNum)).toBe(1150);
  await expect(page.locator('.main').first().locator('.listCard[data-list-author="dave"]')).toBeVisible();
  const seen = await stopWatching(page);
  const real = seen.findIndex(entry => entry.cards && !entry.layer);
  expect(real, JSON.stringify(seen)).toBeGreaterThan(0);
  const route = seen.slice(0, real);
  expect(route.some(entry => entry.layer === 'articleList'), JSON.stringify(seen)).toBe(true);
  for (const entry of route) {
    expect(entry.layer === 'articleList' || entry.screen.includes(body(1150)), JSON.stringify(seen)).toBe(true);
  }
  expect(await server(page)).toMatchObject({ surface: 'list', filter: null });
});

// After a jump in range the list below keeps its live layer (#74): the article
// slides away over it, still without the native list.
test('a next-in-thread jump past the last article after a jump in range slides back to the easy-reading list', async ({ page }) => {
  await bootThreadBoard(page, { open: 1120, fromList: true, thread: NEAR_REPLY_BOARD });
  await jump(page, ']');
  await landedOn(page, 1150);
  await watchScreen(page);
  await jump(page, ']');
  await listActive(page);
  await expect.poll(() => page.evaluate(() => window.__app.listSession._selectedNum)).toBe(1150);
  await expect(page.locator('.main').first().locator('.listCard[data-list-author="dave"]')).toBeVisible();
  const seen = await stopWatching(page);
  const real = seen.findIndex(entry => entry.cards && !entry.layer);
  expect(real, JSON.stringify(seen)).toBeGreaterThan(0);
  const route = seen.slice(0, real);
  expect(route.some(entry => entry.layer === 'articleList'), JSON.stringify(seen)).toBe(true);
  for (const entry of route) {
    expect(entry.layer === 'articleList' || entry.screen.includes(body(1150)), JSON.stringify(seen)).toBe(true);
  }
});

// #193: PTT leaves the article but never answers the thread search. The source
// article stays shown with a message and a bug event, nothing more is sent, and
// pull-to-refresh presents the list PTT shows.
test('a far jump PTT never answers keeps the source article; pull-to-refresh presents the list', async ({ page }) => {
  await bootThreadBoard(page, { open: 600 });
  await watchHold(page);
  await page.evaluate(() => {
    const reply = window.__stubWSSent;
    window.__stubWSSent = data => (data.includes('S') && !window.__answerSearch ? window.__keys.push(data) : reply(data));
  });
  await jump(page, ']');
  await expectArticleHeld(page, { message: ['無法前往同主題文章，下拉重新整理以重試。', 'Could not go to the same-thread article. Pull down to refresh and retry.'], source: 'threadJump', text: body(600) });
  await expect(page.locator('#mobileAppBar .mobileAppBarTitle')).toHaveText('Re: ' + THREAD);
  const before = await keyCount(page);
  await ptt.sendKey(page, 'ArrowDown');
  // The key is answered with the hold's own message, and nothing is sent.
  await expect(page.locator('.ListHint')).toHaveText(/文章操作失敗|The article operation failed/);
  expect(await sentSince(page, before)).toEqual([]);

  await page.evaluate(() => { window.__answerSearch = true; });
  await pullDown(page);
  await listActive(page);
  expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(false);
  await expect(page.locator('[data-stack-layer]', { hasText: body(600) })).toHaveCount(0);
  await expect(page.locator('.main').first().locator('.listCard').first()).toBeVisible();
  expect(await page.evaluate(() => window.__wentNative)).toBe(false);
});
