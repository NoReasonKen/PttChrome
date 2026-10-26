// Leaving an article reveals the real article list it was opened from (#28):
// the list stays alive underneath, is usable at once, and PTT's real list takes
// over at the same reading position once it is presented and the reader is idle.
const { test, expect } = require('@playwright/test');
const { installPaintedFrameProbe, waitRectStable } = require('../helpers/layout');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { touchDrag } = require('../helpers/real_input');
const ptt = require('../helpers/ptt');
const { bootOffline, loadCassette, replayListCassette } = require('../helpers/replay');

const MAIN = '.main:not([data-stack-layer])';
const LAYER = '[data-stack-layer]';
const UNDERLAY = '[data-article-exit-underlay]';
const CARD = `${MAIN} .listCard[data-list-author="kylin936"] .listCardBody`;
const BACK_DELAY_MS = 700;

async function enterArticleFromList(page) {
  const nav = loadCassette('cchat-list-nav');
  await bootOffline(page, ptt, { articleGestures: true });
  await ptt.applyPrefs(page, { enableEasyReading: true, enableEasyReadingList: false, useMouseBrowsing: true, mouseLeftClick: true });
  await replayListCassette(page, nav);
  await page.waitForFunction(() => window.__app.buf.pageState === 2);
  await ptt.applyPrefs(page, { enableEasyReadingList: true, easyReadingListPrefetchCount: 200 });
  await page.waitForFunction(() => window.__app.listSession.state === 'active' &&
    window.__app.commandQueue.idle && window.__app.buf.listLines.length > 50);
  await page.locator(CARD).first().scrollIntoViewIfNeeded();
  await waitRectStable(page, CARD);
  await page.locator(CARD).first().tap();
  await expect(page.locator(MAIN)).toHaveClass(/articleHorizontalGestures/);
  await waitRectStable(page, MAIN);
}

// PTT's reply to ← arrives late, so the in-between frames are observable.
async function delayBackReply(page, delay) {
  await page.evaluate((delay) => {
    const send = window.__stubWSSent;
    window.__stubWSSent = (data) => {
      if (data.indexOf('\x1b[D') < 0) return send(data);
      window.__backSent = performance.now();
      setTimeout(() => send(data), delay);
    };
  }, delay);
}

// Every painted frame from now on: is the old article on screen? Sampled just
// before paint (helpers/layout.js#installPaintedFrameProbe).
async function sampleFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(() => {
    window.__frames = [];
    const sample = () => {
      const main = document.querySelector('.main:not([data-stack-layer])');
      const underlay = document.querySelector('[data-article-exit-underlay]');
      const listShown = window.__app.buf.pageState === 2 && !!main.querySelector('.listBodyView');
      window.__frames.push({ left: Math.round(main.getBoundingClientRect().left), underlay: !!underlay, listShown });
      const done = window.__frames.length >= 600 || (!underlay && listShown && window.__frames.length >= 5);
      if (done) window.__paintedFrame.remove(sample);
    };
    window.__paintedFrame.add(sample);
  });
}

async function swipeOut(page) {
  const main = await waitRectStable(page, MAIN);
  const y = main.top + 100;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  return contact;
}

test('with a delayed list reply, no frame between release and the swap shows the old article', async ({ page }) => {
  await enterArticleFromList(page);
  await delayBackReply(page, BACK_DELAY_MS);
  const contact = await swipeOut(page);
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'layer');
  await sampleFrames(page);
  await contact.release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(`${MAIN} .listBodyView`)).toBeVisible();
  const frames = await page.evaluate(() => window.__frames);
  const width = page.viewportSize().width;
  // Each frame shows the article sliding away over the revealed layer, or the
  // presented real list; the article never comes back.
  const bad = frames.filter((f, i) => f.underlay ? i > 0 && f.left < frames[i - 1].left - 1 : !f.listShown);
  expect(frames.length).toBeGreaterThan(10);
  expect(bad).toEqual([]);
  expect(frames.some(f => f.underlay && f.left >= width - 5)).toBe(true);
});

// The entry at the top of a list's view and its offset from the view's top.
const topEntry = (page, root) => page.locator(root).evaluate((el) => {
  const top = el.getBoundingClientRect().top;
  const card = [...el.querySelectorAll('.listCard')].find(c => c.getBoundingClientRect().bottom > top + 1);
  return { author: card.dataset.listAuthor, title: card.dataset.listTitle, offset: Math.round(card.getBoundingClientRect().top - top) };
});

async function swipeOutWithSlowBack(page, delay) {
  await enterArticleFromList(page);
  await delayBackReply(page, delay);
  const contact = await swipeOut(page);
  await contact.release();
  await expect.poll(() => page.evaluate(() => !!window.__backSent)).toBe(true);
  return waitRectStable(page, LAYER);
}

test('the revealed list scrolls at once, and the real list takes over at the same entry and offset', async ({ page }) => {
  const box = await swipeOutWithSlowBack(page, 1500);
  const before = await topEntry(page, LAYER);
  const x = box.left + box.width / 2;
  await touchDrag(page, { x, y: box.top + box.height - 40 }, { x, y: box.top + 80 }, 10);
  // Let momentum come to rest before reading the reading position.
  let scrolled = await topEntry(page, LAYER);
  for (;;) {
    await page.waitForTimeout(100); // sleep-ok: sampling until momentum scrolling stops
    const now = await topEntry(page, LAYER);
    if (JSON.stringify(now) === JSON.stringify(scrolled)) break;
    scrolled = now;
  }
  expect(scrolled).not.toEqual(before);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(3);
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  const after = await topEntry(page, MAIN);
  expect(after.author).toBe(scrolled.author);
  expect(after.title).toBe(scrolled.title);
  expect(Math.abs(after.offset - scrolled.offset)).toBeLessThanOrEqual(1);
});

test('a finger still down when the list becomes ready defers the swap until the reader is idle', async ({ page }) => {
  const box = await swipeOutWithSlowBack(page, 1000);
  const x = box.left + box.width / 2;
  const contact = await beginArticleTouch(page, { x, y: box.top + box.height - 40 });
  await contact.move({ x, y: box.top + box.height - 120 });
  // The real list is presented while the finger is still down.
  await page.waitForFunction(() => window.__app.buf.pageState === 2 && window.__app.listSession.state === 'active' &&
    window.__app.commandQueue.idle, null, { timeout: 10000 });
  await page.waitForTimeout(400); // sleep-ok: the swap must not happen while the finger stays down
  await expect(page.locator(UNDERLAY)).toHaveCount(1);
  await contact.move({ x, y: box.top + 80 });
  await contact.release({ pause: false });
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 5000 });
});

test('without a matching lower page the article stays off screen over the dark fallback until the list is presented', async ({ page }) => {
  await enterArticleFromList(page);
  // A width change re-lays out the list, so the kept copy no longer matches it.
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width: width - 52, height });
  await waitRectStable(page, MAIN);
  await delayBackReply(page, BACK_DELAY_MS);
  const contact = await swipeOut(page);
  await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'fallback');
  await sampleFrames(page);
  await contact.release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(`${MAIN} .listBodyView`)).toBeVisible();
  const frames = await page.evaluate(() => window.__frames);
  const bad = frames.filter((f, i) => f.underlay ? i > 0 && f.left < frames[i - 1].left - 1 : !f.listShown);
  expect(frames.some(f => f.underlay && f.left >= width - 52 - 5)).toBe(true);
  expect(bad).toEqual([]);
});

test('a reply that never arrives ends the handoff within a bounded time with a notice', async ({ page }) => {
  await enterArticleFromList(page);
  await page.evaluate(() => {
    const send = window.__stubWSSent;
    window.__stubWSSent = (data) => { if (data.indexOf('\x1b[D') < 0) send(data); };
  });
  const contact = await swipeOut(page);
  await contact.release();
  await page.waitForTimeout(2000); // sleep-ok: still waiting well inside the bound
  await expect(page.locator(UNDERLAY)).toHaveCount(1);
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 6000 });
  await expect(page.locator('.ListHint')).toBeVisible();
  expect((await waitRectStable(page, MAIN)).left).toBeCloseTo(0, 0);
});

test('a disconnect during the handoff ends it at once', async ({ page }) => {
  await enterArticleFromList(page);
  await delayBackReply(page, 3000);
  const contact = await swipeOut(page);
  await contact.release();
  await expect.poll(() => page.evaluate(() => !!window.__backSent)).toBe(true);
  await page.evaluate(() => window.__stubWS.close());
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 1000 });
});

test('a leave that cannot be sent brings the article back and sends nothing', async ({ page }) => {
  await enterArticleFromList(page);
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  // Stand-in for any gate that refuses the Back key at that moment.
  await page.evaluate(() => { window.__app.sendNavKeyAsUser = () => false; });
  const contact = await swipeOut(page);
  await contact.release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 3000 });
  expect((await waitRectStable(page, MAIN)).left).toBeCloseTo(0, 0);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(3);
  const sent = await page.evaluate(n => window.__replay.sent.slice(n).join(''), sentBefore);
  expect(sent).not.toContain('\x1b[D');
});

test('an unexpected reply ends the handoff at once and shows what PTT shows', async ({ page }) => {
  await enterArticleFromList(page);
  await page.evaluate(() => {
    const send = window.__stubWSSent;
    window.__stubWSSent = (data) => {
      if (data.indexOf('\x1b[D') < 0) return send(data);
      // PTT answers with a prompt instead of the article list.
      setTimeout(() => window.__app.onData('\x1b[H\x1b[2J\x1b[24;1H\x1b[1;37;44m 請按任意鍵繼續 \x1b[m'), 300);
    };
  });
  const contact = await swipeOut(page);
  await contact.release();
  await page.waitForFunction(() => window.__app.buf.pageState !== 3, null, { timeout: 5000 });
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 1000 });
  // The screen is back in place (a native screen may be centered, so compare
  // its slide offset rather than its left edge).
  expect(await page.locator(MAIN).evaluate(el => getComputedStyle(el).translate)).toBe('none');
});

const BACKS = {
  '←': page => page.keyboard.press('ArrowLeft'),
  'system Back': page => page.goBack(),
};

for (const [name, back] of Object.entries(BACKS)) {
  test(`${name} reveals the same list as the swipe, with no frame of the old article`, async ({ page }) => {
    await enterArticleFromList(page);
    await delayBackReply(page, BACK_DELAY_MS);
    const sentBefore = await page.evaluate(() => window.__replay.sent.length);
    await sampleFrames(page);
    await back(page);
    await expect(page.locator(UNDERLAY)).toHaveAttribute('data-preview', 'layer');
    await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator(`${MAIN} .listBodyView`)).toBeVisible();
    const frames = await page.evaluate(() => window.__frames);
    const width = page.viewportSize().width;
    // Before the key the article is shown; from the first frame that moves it,
    // it only slides away until the real list is presented.
    const start = frames.findIndex(f => f.underlay);
    expect(start).toBeGreaterThanOrEqual(0);
    const moving = frames.slice(start);
    const bad = moving.filter((f, i) => f.underlay ? i > 0 && f.left < moving[i - 1].left - 1 : !f.listShown);
    expect(bad).toEqual([]);
    expect(moving.some(f => f.underlay && f.left >= width - 5)).toBe(true);
    const sent = await page.evaluate(n => window.__replay.sent.slice(n).join(''), sentBefore);
    expect(sent.match(/\x1b\[D/g) || []).toHaveLength(1);
  });
}

test("the toolbar offers the list's actions only once the real list is usable", async ({ page }) => {
  // "To the end" acts on the article or the list; neither is usable meanwhile.
  const END = '#mobileToolbar [data-key="__end"]';
  const box = await swipeOutWithSlowBack(page, 600);
  await expect(page.locator(END)).toBeDisabled();
  const x = box.left + box.width / 2;
  const contact = await beginArticleTouch(page, { x, y: box.top + box.height - 40 });
  await contact.move({ x, y: box.top + box.height - 80 });
  // PTT's list has arrived, but the reader still holds the revealed copy.
  await page.waitForFunction(() => window.__app.buf.pageState === 2 && window.__app.commandQueue.idle, null, { timeout: 10000 });
  await expect(page.locator(UNDERLAY)).toHaveCount(1);
  await expect(page.locator(END)).toBeDisabled();
  await contact.release({ pause: false });
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator(END)).toBeEnabled();
});
