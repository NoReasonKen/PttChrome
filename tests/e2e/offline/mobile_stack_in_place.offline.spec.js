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
    author: card.dataset.listAuthor, title: card.dataset.listTitle,
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
