const { test, expect } = require('@playwright/test');
const { bootGestureArticle, beginArticleTouch, PANEL } = require('../helpers/article_gestures');
const { waitRectStable, installPaintedFrameProbe } = require('../helpers/layout');
const { MAIN, ARTICLE_CARD, bootArticleListAtCard, waitArticleOpened } = require('../helpers/stack_routes');
const { bootNestedShortcutSearch, waitList, waitArticle, tapCard, tapShortcut, nativeBack } = require('../helpers/article_shortcut_search');
const ptt = require('../helpers/ptt');

for (const operation of ['drawer', 'article']) {
  test(`${operation} records bounded startup timing and moves by the next painted frame`, async ({ page }) => {
    await bootGestureArticle(page);
    await page.evaluate(() => {
      window.__app.setDebugMode(true);
      window.__app.toggleDebugRecording();
    });
    const main = await waitRectStable(page, '.main');
    const width = page.viewportSize().width;
    await installPaintedFrameProbe(page);
    await page.evaluate(({ operation, panel, width, left }) => {
      const app = window.__app;
      const samples = window.__gestureLatency = [];
      window.__paintedFrame.add(() => {
        const gesture = app.articleGestures.track?.gesture;
        if (!gesture?.operation || samples.some(sample => sample.expected === gesture.distance)) return;
        const node = document.querySelector(operation === 'drawer' ? panel : '.main');
        const rect = node?.getBoundingClientRect();
        samples.push({
          expected: gesture.distance,
          actual: rect ? operation === 'drawer' ? width - rect.left : rect.left - left : 0
        });
      });
    }, { operation, panel: PANEL, width, left: main.left });
    const start = { x: width / 2, y: main.top + 50 };
    const contact = await beginArticleTouch(page, start);
    for (const distance of [4, 12, 20, 40]) {
      await contact.move({ x: start.x + (operation === 'drawer' ? -distance : distance), y: start.y });
    }
    const samples = await page.evaluate(() => window.__gestureLatency);
    const timing = await page.evaluate(() => JSON.parse(window.__app.debugRecorder.stop()).events
      .filter(event => event.tag === '[DEBUG-69-latency]').map(event => event.info));
    await contact.release({ cancel: true });
    expect(samples).toHaveLength(4);
    for (const sample of samples) expect(sample.actual).toBeCloseTo(sample.expected, 1);
    expect(timing.map(sample => sample.distance)).toEqual([4, 12, 20]);
    expect(timing.map(sample => sample.move)).toEqual([1, 2, 3]);
    for (const sample of timing) {
      expect(sample.operation).toBe(operation === 'drawer' ? 'open' : 'exit');
      for (const name of ['eventLagMs', 'contactMs', 'prepareMs', 'handlerMs', 'frameWaitMs']) {
        expect(Number.isFinite(sample[name])).toBe(true);
        expect(sample[name]).toBeGreaterThanOrEqual(0);
      }
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
  await bootNestedShortcutSearch(page, { easyList: true });
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
