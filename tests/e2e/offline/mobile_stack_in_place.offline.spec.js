// An article replaced in place by another one (#74): the article list below
// keeps its live layer, and Back reveals it with the article now open
// selected, where PTT's selection is; the real list then takes over with no
// jump. A current article outside the layer's rows reveals the dark underlay.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { beginArticleTouch, revealArticleDrawer } = require('../helpers/article_gestures');
const { waitRectStable } = require('../helpers/layout');
const { THREAD, NEAR_REPLY_BOARD, bootThreadBoard, listActive } = require('../helpers/thread_jump');

const MAIN = '.main:not([data-stack-layer])';
const LIST_LAYER = '[data-stack-layer="articleList"]';
const UNDERLAY = '[data-article-exit-underlay]';

async function jump(page, key, num) {
  await revealArticleDrawer(page);
  await page.locator(`[data-article-shortcut="${key}"]`).tap();
  await expect.poll(() => page.locator(MAIN).innerText()).toContain(`Body of article ${num} by`);
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.threadJump.active)).toBe(true);
}

// The selected card of the list in `root` and its place in the scroll viewport.
const selected = (page, root) => page.locator(root).evaluate(el => {
  const view = el.querySelector('.listBodyView').getBoundingClientRect();
  const card = [...el.querySelectorAll('.listCard')]
    .find(c => c.querySelector('.listCardTitle .listCardCursor')?.textContent === '>');
  if (!card) return null;
  const box = card.getBoundingClientRect();
  return {
    author: card.dataset.listAuthor, title: card.dataset.listTitle, text: card.textContent,
    top: Math.round(box.top - view.top), visible: box.top >= view.top - 1 && box.bottom <= view.bottom + 1
  };
});

// PTT answers Back late, so the revealed layer can be read before the swap.
async function delayBack(page, delay) {
  await page.evaluate(delay => {
    const send = window.__stubWSSent;
    window.__stubWSSent = bytes => bytes.includes('\x1b[D') ? setTimeout(() => send(bytes), delay) : send(bytes);
  }, delay);
}

// Back reveals the list with the article of `card` ({ author } or { title })
// selected, and the real list takes over with that article at the same place.
async function backOverList(page, card) {
  await delayBack(page, 700);
  await ptt.sendKey(page, 'ArrowLeft');
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'layer');
  await expect.poll(() => selected(page, LIST_LAYER)).toMatchObject({ ...card, visible: true });
  const revealed = await selected(page, LIST_LAYER);
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await listActive(page);
  const real = await selected(page, MAIN);
  expect(real).toMatchObject({ ...card, visible: true });
  expect(Math.abs(real.top - revealed.top)).toBeLessThanOrEqual(1);
}

test('Back after a next-in-thread jump in range reveals the list at the article now open', async ({ page }) => {
  await bootThreadBoard(page, { open: 1120, fromList: true, thread: NEAR_REPLY_BOARD });
  await jump(page, ']', 1150);
  await backOverList(page, { author: 'dave' });
});

test('Back after the next-article card reveals the list at the article now open', async ({ page }) => {
  await bootThreadBoard(page, { open: 1110, fromList: true, nextArticle: true, thread: PAGE_THREAD });
  await page.locator('#nextArticleCard').tap();
  await expect.poll(() => page.locator(MAIN).innerText()).toContain('Body of article 1111 by');
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.aidNavigation.active)).toBe(true);
  await backOverList(page, { title: '□ [Talk] Filler 1111' });
});

// A thread within one list page: the list holds the rows from the page of the
// article opened from it on.
const PAGE_THREAD = [
  { num: 1101, author: 'alice', title: THREAD, date: '11/20' },
  { num: 1110, author: 'bob', title: 'Re: ' + THREAD, date: '11/21' }
];

for (const key of ['[', '=']) {
  test(`Back after a ${key === '[' ? 'previous' : 'first'}-in-thread jump in range reveals the list at the article now open`, async ({ page }) => {
    await bootThreadBoard(page, { open: 1110, fromList: true, thread: PAGE_THREAD });
    await jump(page, key, 1101);
    await backOverList(page, { author: 'alice' });
  });
}

// A far jump lands with PTT's selection hundreds of rows from the layer's.
test('a swipe back after a jump to an article outside the layer reveals the dark underlay, and the list lands on PTT\'s selection', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, fromList: true });
  await jump(page, '[', 40);
  const main = await waitRectStable(page, MAIN);
  const contact = await beginArticleTouch(page, { x: 20, y: main.top + 100 });
  await contact.move({ x: page.viewportSize().width - 20, y: main.top + 100 });
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'fallback');
  await contact.release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await listActive(page);
  await expect.poll(() => page.evaluate(() => window.__app.listSession._selectedNum)).toBe(40);
  expect(await selected(page, MAIN)).toMatchObject({ author: 'bob', visible: true });
});

// A thread whose replies by dave also show in his author search results,
// with another subject of his after them. The results show under the legacy
// caption, as an ordinary list can: only the verified search tells them apart.
const SEARCH_THREAD = [
  { num: 1, author: 'alice', title: THREAD, date: '9/01' },
  { num: 600, author: 'carol', title: 'Re: ' + THREAD, date: '10/20' },
  { num: 1100, author: 'dave', title: 'Re: ' + THREAD, date: '11/28' },
  { num: 1120, author: 'dave', title: 'Re: ' + THREAD, date: '11/29' },
  { num: 1150, author: 'dave', title: 'Re: ' + THREAD, date: '11/30' },
  { num: 1160, author: 'dave', title: '[Talk] Other topic', date: '12/01' }
];
const DAVE = page => page.locator(`${MAIN} .listCard[data-list-author="dave"]`);

async function search(page, shortcut, field) {
  await revealArticleDrawer(page);
  await page.locator(`[data-article-shortcut="${shortcut}"]`).tap();
  await expect.poll(async () => (await page.evaluate(() => window.__threadServer.state))[field]).not.toBeNull();
  await listActive(page);
}

async function openResult(page, card, num) {
  await card.tap();
  await expect.poll(() => page.locator(MAIN).innerText()).toContain(`Body of article ${num} by`);
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
}

// Carol's reply, the thread's results, dave's last reply, his author results,
// and his reply `num` (1100 or 1150) from them.
async function daveFromAuthorResults(page, num) {
  await bootThreadBoard(page, { open: 600, fromList: true, legacy: true, thread: SEARCH_THREAD });
  await search(page, 'thread', 'filter');
  await openResult(page, DAVE(page).last(), 1150);
  await search(page, 'author', 'byAuthor');
  const replies = DAVE(page).filter({ hasText: 'Far topic' });
  await openResult(page, num === 1100 ? replies.first() : replies.last(), num);
}

const inAuthorResults = async (page, open) =>
  expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ byAuthor: 'dave', open: { num: open } });

// From the author results, Back to the article the author search started from
// and on to the thread's results: each reveals a live layer, never the dark
// fallback. (This fake PTT rebuilds the thread's results under the author
// search too, so the walk stops there.)
async function backToThreadResults(page) {
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      window.__reveals = { layer: false, fallback: false };
      window.__revealWatch?.disconnect();
      const has = (node, selector) => node.nodeType === 1 && (node.matches(selector) || !!node.querySelector(selector));
      window.__revealWatch = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (has(node, '[data-stack-layer]')) window.__reveals.layer = true;
        if (has(node, '[data-article-exit-underlay][data-preview="fallback"]')) window.__reveals.fallback = true;
      })));
      window.__revealWatch.observe(document.body, { childList: true, subtree: true });
    });
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.articleGestures.stack.handingOff &&
      !document.querySelector('[data-stack-layer], [data-article-exit-underlay]'))).toBe(true);
    expect(await page.evaluate(() => window.__reveals), `Back ${i + 1}`).toEqual({ layer: true, fallback: false });
  }
  expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ filter: '[Talk] Far topic', surface: 'list' });
}

test('a next-in-thread jump past the last article of author results slides back to those results', async ({ page }) => {
  await daveFromAuthorResults(page, 1150);
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="]"]').tap();
  await listActive(page);
  await expect.poll(() => page.evaluate(() => !window.__app.threadJump.active && !window.__app.articleGestures.stack.handingOff)).toBe(true);
  await inAuthorResults(page, 1150);
  expect(await page.evaluate(() => window.__threadServer.state.surface)).toBe('list');
  expect(await selected(page, MAIN)).toMatchObject({ text: expect.stringContaining('11/30'), visible: true });
  // The article the author search started from stays below its results.
  await backToThreadResults(page);
});

test('a previous-in-thread jump with no earlier article in author results stays on the article', async ({ page }) => {
  await daveFromAuthorResults(page, 1100);
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="["]').tap();
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.threadJump.active)).toBe(true);
  await inAuthorResults(page, 1100);
  expect(await page.evaluate(() => window.__threadServer.state.surface)).toBe('article');
  await backOverList(page, { text: expect.stringContaining('11/28') });
  await backToThreadResults(page);
});

// dave's replies share author and subject: the selection moves as PTT's does.
for (const [key, num, date] of [['[', 1120, '11/29'], ['=', 1100, '11/28']]) {
  test(`Back after a ${key === '[' ? 'previous' : 'first'}-in-thread jump in author results reveals them at the article now open`, async ({ page }) => {
    await daveFromAuthorResults(page, 1150);
    await jump(page, key, num);
    await inAuthorResults(page, num);
    await backOverList(page, { text: expect.stringContaining(date) });
    await backToThreadResults(page);
  });
}
