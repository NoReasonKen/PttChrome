// An article replaced in place by another one (#74): the article list below
// keeps its live layer. Each layer is independent, like a tab the reader
// returns to (#123): Back reveals the list with the article opened from it
// still selected and its reading position unchanged, PTT's selection is moved
// back to that article by its number, and every article read on the way shows
// as read, even when the current article is outside the layer's rows (#127).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { revealArticleDrawer } = require('../helpers/article_gestures');
const { THREAD, NEAR_REPLY_BOARD, bootThreadBoard, listActive, sent } = require('../helpers/thread_jump');

const MAIN = '.main:not([data-stack-layer])';
const LIST_LAYER = '[data-stack-layer="articleList"]:not([data-stack-parked])';
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

// The card at the top of the real list's view and its offset from that top.
const topEntry = page => page.locator(`${MAIN} .listBodyView`).evaluate(el => {
  const top = el.getBoundingClientRect().top;
  const card = [...el.querySelectorAll('.listCard')].find(c => c.getBoundingClientRect().bottom > top + 1);
  return { num: card.querySelector('.listCardNum').textContent, offset: Math.round(card.getBoundingClientRect().top - top) };
});

// The read mark the real list shows on article `num`.
const markOf = (page, num) => page.locator(MAIN).evaluate((el, num) => {
  const card = [...el.querySelectorAll('.listCard')].find(c => c.querySelector('.listCardNum')?.textContent === num);
  return card ? card.querySelector('.listCardMark')?.textContent ?? '' : null;
}, String(num));

// Boots on the list and opens `open` from it, keeping where the list was.
async function openFromList(page, options) {
  let before = null;
  await bootThreadBoard(page, {
    fromList: true, ...options,
    beforeOpen: async page => { before = { top: await topEntry(page), selected: await selected(page, MAIN) }; }
  });
  return before;
}

// PTT's selection ends on article `num`, moved there by its number.
async function pttSelects(page, num, from) {
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
  expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ surface: 'list', cursor: num });
  expect((await sent(page)).slice(from).some(bytes => bytes.startsWith(num + '\r'))).toBe(true);
}

test('Back after a next-in-thread jump shows the list as it was left, and PTT\'s selection moves back', async ({ page }) => {
  const before = await openFromList(page, { open: 1120, thread: NEAR_REPLY_BOARD });
  expect(before.selected).toMatchObject({ author: 'erin', visible: true });
  await jump(page, ']', 1150);
  const from = (await sent(page)).length;
  await backOverList(page, { author: 'erin' });
  expect(await topEntry(page)).toEqual(before.top);
  expect((await selected(page, MAIN)).top).toBe(before.selected.top);
  await pttSelects(page, 1120, from);
  expect(await markOf(page, 1120)).toBe('');
  expect(await markOf(page, 1150)).toBe('');
});

// A thread within one list page: the list holds the rows from the page of the
// article opened from it on.
const PAGE_THREAD = [
  { num: 1101, author: 'alice', title: THREAD, date: '11/20' },
  { num: 1110, author: 'bob', title: 'Re: ' + THREAD, date: '11/21' }
];

// A thread of four articles on one list page.
const CHAIN_THREAD = [
  { num: 1101, author: 'alice', title: THREAD, date: '11/20' },
  { num: 1105, author: 'bob', title: 'Re: ' + THREAD, date: '11/21' },
  { num: 1110, author: 'carol', title: 'Re: ' + THREAD, date: '11/22' },
  { num: 1115, author: 'dave', title: 'Re: ' + THREAD, date: '11/23' }
];

test('Back after several jumps keeps the article opened from the list selected, and every article read shows read', async ({ page }) => {
  const before = await openFromList(page, { open: 1105, thread: CHAIN_THREAD });
  await jump(page, ']', 1110);
  await jump(page, ']', 1115);
  await jump(page, '[', 1110);
  const from = (await sent(page)).length;
  await backOverList(page, { author: 'bob' });
  expect(await topEntry(page)).toEqual(before.top);
  await pttSelects(page, 1105, from);
  for (const num of [1105, 1110, 1115]) expect(await markOf(page, num), String(num)).toBe('');
  expect(await markOf(page, 1101)).toBe('+');
});

test('Back after several next-article pulls keeps the article opened from the list selected', async ({ page }) => {
  const before = await openFromList(page, { open: 1110, nextArticle: true, thread: PAGE_THREAD });
  for (const num of [1111, 1112]) {
    await page.locator('#nextArticleCard').tap();
    await expect.poll(() => page.locator(MAIN).innerText()).toContain(`Body of article ${num} by`);
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.aidNavigation.active)).toBe(true);
  }
  const from = (await sent(page)).length;
  await backOverList(page, { author: 'bob' });
  expect(await topEntry(page)).toEqual(before.top);
  await pttSelects(page, 1110, from);
  for (const num of [1110, 1111, 1112]) expect(await markOf(page, num), String(num)).toBe('');
});

// While the reader is in the thread, the article opened from the list is
// deleted, so every later article is renumbered.
test('when the article opened from the list was deleted meanwhile, the list stays and opening it says the list changed', async ({ page }) => {
  const before = await openFromList(page, { open: 1110, thread: PAGE_THREAD });
  await jump(page, '[', 1101);
  await page.evaluate(() => {
    const { articles } = window.__threadServer;
    articles.splice(1110 - 1, 1);
    articles.forEach((article, i) => { article.num = i + 1; });
  });
  await backOverList(page, { author: 'bob' });
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
  await listActive(page);
  expect(await topEntry(page)).toEqual(before.top);
  expect(await selected(page, MAIN)).toMatchObject({ author: 'bob', top: before.selected.top });
  await expect(page.locator('.ListHint')).toHaveCount(0);
  await page.locator(`${MAIN} .listCard[data-list-author="bob"]`).tap();
  await expect(page.locator('.ListHint')).toContainText('這個位置已經不是剛剛點的文章');
  await listActive(page);
  expect(await page.evaluate(() => window.__threadServer.state.surface)).toBe('list');
});

for (const key of ['[', '=']) {
  test(`Back after a ${key === '[' ? 'previous' : 'first'}-in-thread jump keeps the article opened from the list selected`, async ({ page }) => {
    await bootThreadBoard(page, { open: 1110, fromList: true, thread: PAGE_THREAD });
    await jump(page, key, 1101);
    const from = (await sent(page)).length;
    await backOverList(page, { author: 'bob' });
    await pttSelects(page, 1110, from);
  });
}

// A far jump lands with PTT's selection hundreds of rows from the layer's
// (#127): the list is still the one left, and only PTT's selection moves.
test('Back after a jump to an article outside the layer shows the list as it was left, and PTT\'s selection moves back', async ({ page }) => {
  const before = await openFromList(page, { open: 600 });
  await jump(page, '[', 40);
  const from = (await sent(page)).length;
  await backOverList(page, { author: 'carol' });
  expect(await topEntry(page)).toEqual(before.top);
  expect((await selected(page, MAIN)).top).toBe(before.selected.top);
  await pttSelects(page, 600, from);
  expect(await markOf(page, 600)).toBe('');
  // Paging up past the kept rows still loads older ones from PTT.
  const oldest = () => page.locator(MAIN).evaluate(el =>
    Math.min(...[...el.querySelectorAll('.listCardNum')].map(n => Number(n.textContent)).filter(Number.isFinite)));
  const kept = await oldest();
  for (let i = 0; i < 5; i++) await ptt.sendKey(page, 'PageUp');
  await expect.poll(oldest).toBeLessThan(kept);
});

// The next reply in the thread, hundreds of rows below the layer's (#123).
test('Back after a next-in-thread jump to an article outside the layer shows the list as it was left', async ({ page }) => {
  const before = await openFromList(page, { open: 600 });
  await jump(page, ']', 1150);
  const from = (await sent(page)).length;
  await backOverList(page, { author: 'carol' });
  expect(await topEntry(page)).toEqual(before.top);
  await pttSelects(page, 600, from);
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

// Back `count` times: each reveals a live layer, never the dark fallback.
async function backWalk(page, count) {
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => {
      window.__reveals = { layer: false, fallback: false };
      window.__revealWatch?.disconnect();
      const has = (node, selector) => node.nodeType === 1 && (node.matches(selector) || !!node.querySelector(selector));
      window.__revealWatch = new MutationObserver(records => {
        if (document.querySelector('[data-stack-layer]:not([data-stack-parked])')) window.__reveals.layer = true;
        records.forEach(record => record.addedNodes.forEach(node => {
          if (has(node, '[data-article-exit-underlay][data-preview="fallback"]')) window.__reveals.fallback = true;
        }));
      });
      window.__revealWatch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-stack-parked'] });
    });
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.articleGestures.stack.handingOff &&
      !document.querySelector('[data-stack-layer]:not([data-stack-parked]), [data-article-exit-underlay]'))).toBe(true);
    expect(await page.evaluate(() => window.__reveals), `Back ${i + 1}`).toEqual({ layer: true, fallback: false });
  }
}

// From the author results, Back to the article the author search started from
// and on to the thread's results. (This fake PTT rebuilds the thread's results
// under the author search too, so the walk stops there.)
async function backToThreadResults(page) {
  await backWalk(page, 2);
  expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ filter: '[Talk] Far topic', surface: 'list' });
}

// Back from search results reopens their source out of sight, through the
// native mirror's smaller font: the revealed article keeps its own layout, and
// its App Bar shows in full until the article takes over.
test('Back from author results reveals the source article at its own layout under its whole App Bar', async ({ page }) => {
  const thread = SEARCH_THREAD.map(article => ({ ...article, url: true }));
  await bootThreadBoard(page, { open: 1100, fromList: true, legacy: true, thread });
  await search(page, 'author', 'byAuthor');
  await page.evaluate(() => {
    const frames = window.__frames = [];
    const gapIn = root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let mark = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!mark && node.data.includes('※')) mark = [node, node.data.indexOf('※')];
        const at = node.data.indexOf('文章網址');
        if (mark && at >= 0) {
          const box = (n, i) => { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); return r.getBoundingClientRect(); };
          return Math.round((box(node, at).left - box(...mark).right) * 10) / 10;
        }
      }
      return null;
    };
    const sample = () => {
      const layer = document.querySelector('[data-stack-layer="article"]');
      const heading = document.querySelector('.stackUnderlayTitle');
      if (layer && heading) frames.push({ gap: gapIn(layer), heading: heading.textContent });
      if (!document.querySelector('.main:not([data-stack-layer]).mobileReflow') || layer) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goBack();
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.articleGestures.stack.handingOff &&
    !document.querySelector('[data-stack-layer]:not([data-stack-parked])'))).toBe(true);
  expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ surface: 'article', open: { num: 1100 } });
  const frames = await page.evaluate(() => window.__frames);
  expect(frames.length).toBeGreaterThan(5);
  expect(new Set(frames.map(f => f.gap)).size).toBe(1);
  expect(frames[0].gap).not.toBeNull();
  for (const { heading } of frames) expect(heading).toContain('dave (dave)');
});

// Two articles by one author share their first header row, and ptt.cc articles
// end with their AID line: each search starts from the article on screen.
test('Back from thread results searched from an article of author results returns to that article', async ({ page }) => {
  const thread = SEARCH_THREAD.map(article => ({ ...article, url: true }));
  await bootThreadBoard(page, { open: 1100, fromList: true, legacy: true, thread });
  await search(page, 'author', 'byAuthor');
  await openResult(page, DAVE(page).filter({ hasText: 'Far topic' }).last(), 1150);
  await search(page, 'thread', 'filter');
  await backWalk(page, 1);
  expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ surface: 'article', open: { num: 1150 } });
  await backWalk(page, 2);
  expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ surface: 'article', open: { num: 1100 } });
});

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

// dave's replies share author and subject: the results keep the reply opened
// from them selected, and PTT's selection moves back to it.
for (const [key, num] of [['[', 1120], ['=', 1100]]) {
  test(`Back after a ${key === '[' ? 'previous' : 'first'}-in-thread jump in author results keeps the reply opened from them selected`, async ({ page }) => {
    await daveFromAuthorResults(page, 1150);
    await jump(page, key, num);
    await inAuthorResults(page, num);
    await backOverList(page, { text: expect.stringContaining('11/30') });
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
    await inAuthorResults(page, num);
    expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ surface: 'list', cursor: 3 });
    await backToThreadResults(page);
  });
}
