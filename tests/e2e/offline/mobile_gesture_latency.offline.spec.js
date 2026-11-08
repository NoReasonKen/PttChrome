const { test, expect } = require('@playwright/test');
const { bootGestureArticle, beginArticleTouch, PANEL } = require('../helpers/article_gestures');
const { waitRectStable, installPaintedFrameProbe } = require('../helpers/layout');
const { MAIN, ARTICLE_CARD, bootArticleListAtCard, waitArticleOpened } = require('../helpers/stack_routes');
const { bootNestedShortcutSearch, waitList, waitArticle, tapCard, tapShortcut, nativeBack } = require('../helpers/article_shortcut_search');
const ptt = require('../helpers/ptt');

for (const operation of ['drawer', 'article']) {
  test(`${operation} stays still through intent confirmation and follows later movement by the next painted frame`, async ({ page }) => {
    await page.addInitScript(() => {
      // Observe input before the controller consumes a confirmed drag.
      window.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch') window.__gestureLatencyInput = { x: event.clientX, eventTime: event.timeStamp };
      }, { capture: true, passive: true });
    });
    await bootGestureArticle(page);
    const main = await waitRectStable(page, '.main');
    const width = page.viewportSize().width;
    const start = { x: width / 2, y: main.top + 50 };
    await installPaintedFrameProbe(page);
    await page.evaluate(({ operation, panel, width, left, startX }) => {
      const app = window.__app;
      const samples = window.__gestureLatency = [];
      window.__paintedFrame.add(() => {
        const gesture = app.articleGestures.track?.gesture;
        const input = window.__gestureLatencyInput;
        if (!gesture || !input || samples.some(sample => sample.eventTime === input.eventTime)) return;
        const node = document.querySelector(operation === 'drawer' ? panel : '.main');
        const rect = node?.getBoundingClientRect();
        samples.push({
          finger: Math.abs(input.x - startX), eventTime: input.eventTime,
          axis: gesture.axis, operation: gesture.operation, distance: gesture.distance,
          actual: rect ? operation === 'drawer' ? width - rect.left : rect.left - left : 0
        });
      });
    }, { operation, panel: PANEL, width, left: main.left, startX: start.x });
    const contact = await beginArticleTouch(page, start);
    for (const distance of [4, 12, 15, 16, 20, 40]) {
      await contact.move({ x: start.x + (operation === 'drawer' ? -distance : distance), y: start.y });
    }
    const samples = await page.evaluate(() => window.__gestureLatency);
    await contact.release({ cancel: true });
    expect(samples.map(sample => sample.finger)).toEqual([4, 12, 15, 16, 20, 40]);
    for (const sample of samples) {
      const confirmed = sample.finger >= 16;
      const distance = Math.max(0, sample.finger - 16);
      expect(sample.axis).toBe(confirmed ? 'horizontal' : null);
      expect(sample.operation).toBe(confirmed ? operation === 'drawer' ? 'open' : 'exit' : null);
      expect(sample.distance).toBe(distance);
      expect(sample.actual).toBeCloseTo(distance, 1);
    }
  });
}

test('first and repeated article drags reuse a prepared list without synchronous scroll restoration', async ({ page }) => {
  await bootArticleListAtCard(page);
  await page.locator(ARTICLE_CARD).first().tap();
  await waitArticleOpened(page);
  const parked = page.locator('[data-stack-parked]');
  await expect(parked).toHaveCount(1);
  await expect(parked).toHaveCSS('opacity', '0');
  await expect(parked).toHaveCSS('pointer-events', 'none');
  await expect(parked).toHaveJSProperty('inert', true);
  await expect(parked).toHaveAttribute('aria-hidden', 'true');
  const before = await page.evaluate(() => window.__app.articleGestures.stack.revealable().screen.getListScrollTop());
  await page.evaluate(() => {
    const app = window.__app;
    const layer = app.articleGestures.stack.revealable();
    window.__restoreCalls = 0;
    const restore = layer.screen.setListScrollTop;
    layer.screen.setListScrollTop = function (...args) {
      window.__restoreCalls++;
      return restore.apply(this, args);
    };
  });
  const main = await waitRectStable(page, MAIN);
  for (let attempt = 0; attempt < 3; attempt++) {
    const contact = await beginArticleTouch(page, { x: 100, y: main.top + 50 });
    await contact.move({ x: 104, y: main.top + 50 });
    expect(await page.locator(MAIN).evaluate(node => node.getBoundingClientRect().left) - main.left).toBeCloseTo(0, 1);
    await expect(parked).toHaveCount(1);
    await contact.move({ x: 116, y: main.top + 50 });
    expect(await page.locator(MAIN).evaluate(node => node.getBoundingClientRect().left) - main.left).toBeCloseTo(0, 1);
    await expect(parked).toHaveCount(0);
    await contact.move({ x: 120, y: main.top + 50 });
    expect((await waitRectStable(page, MAIN)).left - main.left).toBeCloseTo(4, 1);
    await expect(parked).toHaveCount(0);
    expect(await page.evaluate(() => window.__app.articleGestures.stack.revealable().screen.getListScrollTop())).toBe(before);
    await contact.release({ cancel: true });
    await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
    await expect(parked).toHaveCount(1);
  }
  // Restoring a newly attached list's scroll position forced a full layout
  // inside the first pointer move. Assert its absence without a wall-clock
  // budget that would depend on runner speed.
  expect(await page.evaluate(() => window.__restoreCalls)).toBe(0);
});

test('nested Back prepares the next list and destroying the stack removes all prepared DOM', async ({ page }) => {
  await bootNestedShortcutSearch(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await expect(page.locator('[data-stack-parked]')).toHaveCount(1);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await expect(page.locator('[data-stack-parked]')).toHaveCount(1);
  await nativeBack(page);
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  await expect(page.locator('[data-stack-parked]')).toHaveCount(1);
  const prepared = await page.evaluate(() => {
    const layer = window.__app.articleGestures.stack.revealable();
    return { connected: layer.el.isConnected, parked: layer.el.hasAttribute('data-stack-parked') };
  });
  expect(prepared).toEqual({ connected: true, parked: true });
  await page.evaluate(() => window.__app.articleGestures.stack.clear());
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0);
});
