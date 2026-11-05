const { test, expect } = require('@playwright/test');
const { bootGestureArticle, beginArticleTouch, revealArticleDrawer, DRAWER, PANEL } = require('../helpers/article_gestures');
const { waitRectStable } = require('../helpers/layout');
const { MAIN, ARTICLE_CARD, bootArticleListAtCard, waitArticleOpened, listActive } = require('../helpers/stack_routes');
const ptt = require('../helpers/ptt');

async function bootSurface(page, operation) {
  if (operation === 'returned article list') {
    await bootArticleListAtCard(page);
    await page.locator(ARTICLE_CARD).first().tap();
    await waitArticleOpened(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await listActive(page);
    await expect(page.locator('[data-stack-layer]')).toHaveCount(0);
  } else await bootGestureArticle(page);
}

async function surfaceMotion(page, operation, main) {
  return page.evaluate(({ operation, panel, left }) => {
    const node = document.querySelector(operation === 'drawer' ? panel : '.main:not([data-stack-layer])');
    if (!node) return 0;
    const rect = node.getBoundingClientRect();
    return operation === 'drawer' ? innerWidth - rect.left : rect.left - left;
  }, { operation, panel: PANEL, left: main.left });
}

async function gestureState(page) {
  return page.evaluate(() => {
    const gesture = window.__app.articleGestures.track?.gesture;
    return gesture && { axis: gesture.axis, operation: gesture.operation, distance: gesture.distance };
  });
}

for (const operation of ['drawer', 'article', 'returned article list']) {
  test(`${operation} waits for 16px of intent and follows later horizontal movement without a jump`, async ({ page }) => {
    await bootSurface(page, operation);
    const main = await waitRectStable(page, MAIN);
    const width = page.viewportSize().width;
    const direction = operation === 'drawer' ? -1 : 1;
    const start = { x: width / 2, y: main.top + 50 };
    const contact = await beginArticleTouch(page, start);
    const samples = [];
    for (const distance of [4, 12, 15, 16, 20, 40]) {
      await contact.move({ x: start.x + direction * distance, y: start.y });
      const actual = await surfaceMotion(page, operation, main);
      samples.push({ finger: distance, surface: Math.round(actual * 100) / 100 });
      expect(await gestureState(page)).toEqual({
        axis: distance < 16 ? null : 'horizontal',
        operation: distance < 16 ? null : operation === 'drawer' ? 'open' : 'exit',
        distance: Math.max(0, distance - 16)
      });
    }
    await contact.release({ cancel: true });
    expect(samples).toEqual(samples.map(({ finger }) => ({ finger, surface: Math.max(0, finger - 16) })));
  });

  test(`${operation} anchors motion at the actual first sample beyond 16px`, async ({ page }) => {
    await bootSurface(page, operation);
    const main = await waitRectStable(page, MAIN);
    const direction = operation === 'drawer' ? -1 : 1;
    const start = { x: page.viewportSize().width / 2, y: main.top + 50 };
    const contact = await beginArticleTouch(page, start);
    await contact.move({ x: start.x + direction * 40, y: start.y });
    expect(await gestureState(page)).toEqual({ axis: 'horizontal', operation: operation === 'drawer' ? 'open' : 'exit', distance: 0 });
    expect(await surfaceMotion(page, operation, main)).toBeCloseTo(0, 1);
    await contact.move({ x: start.x + direction * 44, y: start.y });
    expect(await surfaceMotion(page, operation, main)).toBeCloseTo(4, 1);
    await contact.release({ cancel: true });
  });

  for (const angle of [39, 41]) {
    for (const vertical of [-1, 1]) {
      test(`${operation} treats a ${angle}-degree ${vertical < 0 ? 'upward' : 'downward'} diagonal as ${angle < 40 ? 'horizontal motion' : 'vertical scrolling'}`, async ({ page }, testInfo) => {
        await bootSurface(page, operation);
        const main = await waitRectStable(page, MAIN);
        const width = page.viewportSize().width;
        const direction = operation === 'drawer' ? -1 : 1;
        const start = {
          x: direction < 0 ? width - 24 : 24,
          y: vertical < 0 ? main.top + main.height - 24 : main.top + 24
        };
        const contact = await beginArticleTouch(page, start);
        const samples = [];
        const endDistance = operation === 'drawer' && angle < 40 ? Math.ceil(width / 2) + 32 : 220;
        for (const distance of [1, 4, 12, 16, 40, 100, 160, endDistance]) {
          await contact.move({
            x: start.x + direction * distance,
            y: start.y + vertical * distance * Math.tan(angle * Math.PI / 180)
          });
          samples.push({ finger: distance, surface: Math.round(await surfaceMotion(page, operation, main)) });
        }
        await testInfo.attach('diagonal-progress', { body: JSON.stringify(samples), contentType: 'application/json' });
        expect(samples).toEqual(samples.map(({ finger }) => ({ finger, surface: angle < 40 ? Math.max(0, finger - 16) : 0 })));
        await contact.release({ cancel: operation !== 'drawer' });
        if (operation === 'drawer') {
          if (angle < 40) await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
          else await expect(page.locator(DRAWER)).toHaveCount(0);
        }
      });
    }
  }
}

for (const angle of [39, 41]) {
  for (const vertical of [-1, 1]) {
    test(`an open drawer uses the same ${angle}-degree ${vertical < 0 ? 'upward' : 'downward'} boundary when closing`, async ({ page }) => {
      await bootGestureArticle(page);
      const panel = await revealArticleDrawer(page);
      const start = { x: panel.left + 24, y: vertical < 0 ? panel.top + panel.height - 24 : panel.top + 24 };
      const contact = await beginArticleTouch(page, start);
      for (const distance of [1, 4, 12, 16, 40, 100, 160, 220]) {
        await contact.move({ x: start.x + distance, y: start.y + vertical * distance * Math.tan(angle * Math.PI / 180) });
        const left = await page.locator(PANEL).evaluate(node => node.getBoundingClientRect().left);
        expect(left - panel.left).toBeCloseTo(angle < 40 ? Math.max(0, distance - 16) : 0, 0);
      }
      await contact.release();
      if (angle < 40) await expect(page.locator(DRAWER)).toHaveCount(0);
      else await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
    });
  }
}

for (const operation of ['drawer', 'article']) {
  test(`${operation} lets a tiny horizontal start turn vertical before 16px of intent`, async ({ page }) => {
    await bootGestureArticle(page);
    await page.evaluate(async () => {
      const Recorder = await window.__loadDebugRecorder();
      window.__app.debugRecorder = new Recorder(window.__app, { detailedGestures: true });
      window.__app.debugRecorder.start();
    });
    const main = await waitRectStable(page, MAIN);
    const direction = operation === 'drawer' ? -1 : 1;
    const start = { x: page.viewportSize().width / 2, y: main.top + 50 };
    const contact = await beginArticleTouch(page, start);
    await contact.move({ x: start.x + direction, y: start.y });
    expect(await gestureState(page)).toEqual({ axis: null, operation: null, distance: 0 });
    await contact.move({ x: start.x + direction * 8, y: start.y + 8 });
    expect(await gestureState(page)).toEqual({ axis: null, operation: null, distance: 0 });
    expect(await surfaceMotion(page, operation, main)).toBeCloseTo(0, 0);
    await contact.move({ x: start.x + direction * 13, y: start.y + 13 });
    await contact.move({ x: start.x + direction * 100, y: start.y + 100 * Math.tan(40 * Math.PI / 180) });
    expect(await surfaceMotion(page, operation, main)).toBeCloseTo(0, 0);
    await contact.release({ cancel: true });
    const recording = await page.evaluate(() => JSON.parse(window.__app.debugRecorder.stop()));
    const locks = recording.events.filter(event => event.tag === 'articleGestures.move' && event.info.lockedNow);
    expect(locks.map(event => event.info)).toEqual([
      expect.objectContaining({ dx: direction * 13, dy: 13, axis: 'vertical', operation: null, distance: 0 })
    ]);
  });
}

for (const detailedGestures of [false, true]) {
  test(`${detailedGestures ? 'detailed' : 'standard'} recording captures only its intended gesture detail`, async ({ page }) => {
    await bootGestureArticle(page);
    await page.evaluate(async detailedGestures => {
      const Recorder = await window.__loadDebugRecorder();
      window.__app.debugRecorder = new Recorder(window.__app, { detailedGestures });
      window.__app.debugRecorder.start();
    }, detailedGestures);
    const main = await waitRectStable(page, MAIN);
    const start = { x: page.viewportSize().width / 2, y: main.top + 50 };
    const contact = await beginArticleTouch(page, start);
    await contact.move({ x: start.x - 1, y: start.y });
    await contact.move({ x: start.x - 12, y: start.y });
    await contact.move({ x: start.x - 16, y: start.y });
    await contact.move({ x: start.x - 100, y: start.y + 100 * Math.tan(40 * Math.PI / 180) });
    await contact.release({ cancel: true });
    const recording = await page.evaluate(() => JSON.parse(window.__app.debugRecorder.stop()));
    expect(recording.meta.detailedGestures).toBe(detailedGestures);
    const points = recording.events.filter(event => event.tag === 'touch' && event.info.type === 'touchmove');
    const moves = recording.events.filter(event => event.tag === 'articleGestures.move');
    if (detailedGestures) {
      expect(points.length).toBeGreaterThan(0);
      expect(points.every(event => Number.isFinite(event.info.x) && Number.isFinite(event.info.y) && Number.isFinite(event.info.eventTime))).toBe(true);
      expect(moves.length).toBeGreaterThanOrEqual(4);
      expect(moves[0].info).toMatchObject({ dx: -1, dy: 0, axis: null, direction: null, lockedNow: false, operation: null, distance: 0 });
      expect(moves.filter(event => event.info.lockedNow).map(event => event.info)).toEqual([
        expect.objectContaining({ dx: -16, dy: 0, axis: 'horizontal', direction: 'left', operation: 'open', distance: 0 })
      ]);
      expect(moves.at(-1).info).toMatchObject({ axis: 'horizontal', lockedNow: false, operation: 'open', distance: 84 });
      expect(moves.at(-1).info.angleFromHorizontal).toBeCloseTo(40, 1);
    } else {
      expect(points).toEqual([]);
      expect(moves).toEqual([]);
    }
    const count = await page.evaluate(() => window.__app.debugRecorder.events.length);
    const afterStop = await beginArticleTouch(page, start);
    await afterStop.move({ x: start.x - 40, y: start.y });
    await afterStop.release({ cancel: true });
    expect(await page.evaluate(() => window.__app.debugRecorder.events.length)).toBe(count);
  });
}

test('detailed recording keeps the touch trajectory after native scrolling takes pointer ownership', async ({ page }) => {
  await bootGestureArticle(page);
  await page.evaluate(async () => {
    const Recorder = await window.__loadDebugRecorder();
    window.__app.debugRecorder = new Recorder(window.__app, { detailedGestures: true });
    window.__app.debugRecorder.start();
    window.__pointerCancels = 0;
    window.addEventListener('pointercancel', () => window.__pointerCancels++, { passive: true });
  });
  const main = await waitRectStable(page, MAIN);
  const start = { x: page.viewportSize().width / 2, y: main.top + main.height - 24 };
  const contact = await beginArticleTouch(page, start);
  for (const distance of [4, 12, 16, 40, 100, 160]) {
    await contact.move({ x: start.x - distance * 0.5, y: start.y - distance });
  }
  await contact.release();
  expect(await page.evaluate(() => window.__pointerCancels)).toBeGreaterThan(0);
  const recording = await page.evaluate(() => JSON.parse(window.__app.debugRecorder.stop()));
  const moves = recording.events.filter(event => event.tag === 'articleGestures.move');
  const points = recording.events.filter(event => event.tag === 'touch' && event.info.type === 'touchmove');
  expect(moves[0].info).toMatchObject({ axis: null, direction: null, lockedNow: false, operation: null, distance: 0 });
  expect(moves.filter(event => event.info.lockedNow).map(event => event.info)).toEqual([
    expect.objectContaining({ dx: -8, dy: -16, axis: 'vertical', direction: 'up', operation: null, distance: 0 })
  ]);
  expect(points.at(-1).info.eventTime).toBeGreaterThan(moves.at(-1).info.eventTime);
  expect(points.at(-1).info.y).toBeCloseTo(start.y - 160, 1);
  await expect(page.locator(DRAWER)).toHaveCount(0);
});
