const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { waitRectStable, waitPreviewsSettled } = require('../helpers/layout');
const { cdp, touchDrag } = require('../helpers/real_input');
const { pauseClockNow } = require('../helpers/clock');
const { openPreviewViewer, PREVIEW, VIEWER } = require('../helpers/image_viewer');
const {
  DRAWER, PANEL, bootGestureArticle, beginArticleTouch, revealArticleDrawer, gestureSent
} = require('../helpers/article_gestures');

test('article drawer follows the finger, settles at the agreed proportions and dismisses without navigation', async ({ page }, testInfo) => {
  await bootGestureArticle(page);
  const width = page.viewportSize().width;
  const main = await waitRectStable(page, '.main');
  const y = main.top + 100;
  const before = await page.locator('.main').evaluate(el => el.scrollTop);
  const contact = await beginArticleTouch(page, { x: width - 24, y });
  await contact.move({ x: width - 124, y });
  let panel = await waitRectStable(page, PANEL);
  expect(panel.left).toBeCloseTo(width - 100, 0);
  await contact.move({ x: 12, y });
  await contact.release();
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
  panel = await waitRectStable(page, PANEL);
  const toolbar = await waitRectStable(page, '#mobileToolbar');
  expect(panel.width).toBeCloseTo(width * 0.75, 0);
  expect(panel.height).toBeCloseTo(toolbar.top * 0.6, 0);
  expect(panel.top).toBeCloseTo(toolbar.top * 0.2, 0);
  expect(await page.locator(PANEL).evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(20, 20, 24, 0.5)');
  await page.screenshot({ path: testInfo.outputPath('article-drawer.png') });
  await page.touchscreen.tap(10, panel.top + panel.height / 2);
  await expect(page.locator(DRAWER)).toHaveCount(0);
  expect(await page.locator('.main').evaluate(el => el.scrollTop)).toBe(before);
  expect(await gestureSent(page)).toBe('');
});

test('a short drag and touch cancellation restore the closed drawer', async ({ page }) => {
  await bootGestureArticle(page);
  const width = page.viewportSize().width;
  const main = await waitRectStable(page, '.main');
  const y = main.top + 100;
  let contact = await beginArticleTouch(page, { x: width - 24, y });
  await contact.move({ x: width - 124, y });
  await contact.release();
  await expect(page.locator(DRAWER)).toHaveCount(0);
  contact = await beginArticleTouch(page, { x: width - 24, y });
  await contact.move({ x: 12, y });
  await contact.release({ cancel: true });
  await expect(page.locator(DRAWER)).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
});

async function tapDuringOpening(page, target) {
  await page.clock.install();
  const width = page.viewportSize().width;
  const main = await waitRectStable(page, '.main');
  const y = main.top + Math.min(100, main.height / 2);
  const contact = await beginArticleTouch(page, { x: width - 24, y });
  await contact.move({ x: 12, y });
  // The drag already fully extends the panel. Measure before releasing so
  // layout waits cannot consume the opening interval that this test exercises.
  const rect = await waitRectStable(page, target.startsWith('[') ? target : PANEL);
  const point = target === 'left' ? { x: 10, y }
    : target === 'above' ? { x: width / 2, y: rect.top / 2 }
    : target === 'below' ? { x: width / 2, y: rect.top + rect.height + 10 }
    : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  await pauseClockNow(page);
  await (await cdp(page)).send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Deliver the release frames while holding the settling timer in its opening
  // interval, regardless of driver latency. Touch input still goes through CDP.
  await page.clock.runFor(50);
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'opening');
  await page.touchscreen.tap(point.x, point.y);
  await page.clock.resume();
}

async function flingOpenDrawer(page) {
  const width = page.viewportSize().width;
  const main = await waitRectStable(page, '.main');
  const start = { x: width * 0.8, y: main.top + 70 };
  const session = await cdp(page);
  // Supply the contact's time at the input boundary so driver latency cannot
  // turn a quick fling into a slow drag. Do not pause before releasing.
  const timestamp = Date.now() / 1000;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp, touchPoints: [{ id: 0, ...start }] });
  for (let step = 1; step <= 5; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', timestamp: timestamp + step * 0.03,
      touchPoints: [{ id: 0, x: start.x - width * 0.375 * step / 5, y: start.y + 10 * step }]
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: timestamp + 0.16, touchPoints: [] });
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
  return { x: 10, y: start.y };
}

for (const target of ['backdrop', '[']) {
  test(`the first ${target} tap after a short diagonal opening fling responds without another tap`, async ({ page }) => {
    await bootGestureArticle(page);
    const point = await flingOpenDrawer(page);
    if (target === 'backdrop') await page.touchscreen.tap(point.x, point.y);
    else {
      const button = await waitRectStable(page, `[data-article-shortcut="${target}"]`);
      await page.touchscreen.tap(button.left + button.width / 2, button.top + button.height / 2);
    }
    await expect(page.locator(DRAWER)).toHaveCount(0);
    await expect.poll(() => gestureSent(page)).toBe(target === 'backdrop' ? '' : target);
  });
}

for (const side of ['left', 'above', 'below']) {
  test(`the first fresh ${side} backdrop tap during drawer opening dismisses it without navigation`, async ({ page }) => {
    await bootGestureArticle(page);
    await tapDuringOpening(page, side);
    await expect(page.locator(DRAWER)).toHaveCount(0);
    expect(await gestureSent(page)).toBe('');
  });
}

for (const key of ['thread', '[', '=', ']', 'author']) {
  test(`the first fresh ${key} shortcut tap during drawer opening activates it exactly once`, async ({ page }) => {
    await bootGestureArticle(page);
    await tapDuringOpening(page, `[data-article-shortcut="${key}"]`);
    await expect(page.locator(DRAWER)).toHaveCount(0);
    // This article fixture has no URL, so either search first resolves its AID.
    await expect.poll(() => gestureSent(page)).toBe(key === 'thread' || key === 'author' ? 'Q' : key);
  });
}

test('the open drawer consumes vertical and left swipes; a right swipe closes without article exit', async ({ page }) => {
  await bootGestureArticle(page);
  const panel = await revealArticleDrawer(page);
  const before = await page.locator('.main').evaluate(el => el.scrollTop);
  await touchDrag(page, { x: panel.left + 20, y: panel.top + 100 }, { x: panel.left + 20, y: panel.top + 20 });
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
  expect(await page.locator('.main').evaluate(el => el.scrollTop)).toBe(before);
  const contact = await beginArticleTouch(page, { x: panel.left + 10, y: panel.top + 30 });
  await contact.move({ x: panel.left + panel.width - 10, y: panel.top + 30 });
  await contact.release();
  await expect(page.locator(DRAWER)).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
});

test('Back and Escape dismiss the drawer, and an open drawer adapts to a compact viewport', async ({ page }, testInfo) => {
  await bootGestureArticle(page);
  await revealArticleDrawer(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
  const panel = await waitRectStable(page, PANEL);
  expect(panel.width).toBeCloseTo(240, 0);
  await page.screenshot({ path: testInfo.outputPath('article-drawer-compact.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator(DRAWER)).toHaveCount(0);
  await revealArticleDrawer(page);
  await page.goBack();
  await expect(page.locator(DRAWER)).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
});

for (const key of ['[', '=', ']']) {
  test(`the drawer retains the existing ${key} same-thread action`, async ({ page }) => {
    await bootGestureArticle(page);
    await revealArticleDrawer(page);
    await page.locator(`[data-article-shortcut="${key}"]`).tap();
    await expect(page.locator(DRAWER)).toHaveCount(0);
    await expect.poll(() => gestureSent(page)).toContain(key);
  });
}

test('disabling article gestures restores ordinary input; previews remain usable', async ({ page }) => {
  await bootGestureArticle(page);
  await ptt.applyPrefs(page, { articleHorizontalGestures: false });
  await expect(page.locator('.main')).not.toHaveClass(/articleHorizontalGestures/);
  const main = await waitRectStable(page, '.main');
  const width = page.viewportSize().width;
  await touchDrag(page, { x: width - 24, y: main.top + 100 }, { x: 12, y: main.top + 100 });
  await expect(page.locator(DRAWER)).toHaveCount(0);
  await waitPreviewsSettled(page);
  expect(await gestureSent(page)).toBe('');
});

test('a preview tap still opens the viewer while a horizontal preview drag opens only the drawer', async ({ page }) => {
  await bootGestureArticle(page);
  await openPreviewViewer(page, { touch: true });
  await expect(page.locator(DRAWER)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close image viewer', exact: true }).tap();
  await expect(page.locator(VIEWER)).toHaveCount(0);
  const image = await waitRectStable(page, PREVIEW);
  const from = { x: Math.min(image.left + image.width - 4, page.viewportSize().width - 24), y: image.top + image.height / 2 };
  const contact = await beginArticleTouch(page, from);
  // Past half the width and held still: the drag opens the drawer by distance,
  // whatever the machine's speed. A fling depends on how fast the events land.
  await contact.move({ x: Math.max(8, from.x - page.viewportSize().width * 0.6), y: from.y });
  await contact.release();
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
  await expect(page.locator(VIEWER)).toHaveCount(0);
});

test('a second contact and a viewport change cancel an unfinished drawer reveal', async ({ page }) => {
  await bootGestureArticle(page);
  let width = page.viewportSize().width;
  const main = await waitRectStable(page, '.main');
  const y = main.top + 100;
  let contact = await beginArticleTouch(page, { x: width - 24, y });
  await contact.move({ x: 20, y });
  await contact.second({ x: 20, y });
  await contact.release();
  await expect(page.locator(DRAWER)).toHaveCount(0);
  contact = await beginArticleTouch(page, { x: width - 24, y });
  await contact.move({ x: 20, y });
  await page.setViewportSize({ width: 360, height: 450 });
  await contact.release();
  await expect(page.locator(DRAWER)).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
});

test('vertical reading retains browser scrolling without opening article shortcuts', async ({ page }) => {
  await bootGestureArticle(page);
  const main = await waitRectStable(page, '.main');
  const before = await page.locator('.main').evaluate(el => el.scrollTop);
  await touchDrag(page, { x: 60, y: main.top + main.height - 30 }, { x: 60, y: main.top + 20 }, 12);
  await expect.poll(() => page.locator('.main').evaluate(el => el.scrollTop)).toBeGreaterThan(before);
  await expect(page.locator(DRAWER)).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
});

for (const imageProfile of ['slow', 'broken', 'mixed']) {
  test(`drawer gestures coexist with ${imageProfile} inline images`, async ({ page }) => {
    await bootGestureArticle(page, { imageProfile, waitForPreviews: false });
    if (imageProfile === 'slow') {
      await expect(page.locator('#mainContainer .previewLoading').first()).toBeVisible();
    }
    await revealArticleDrawer(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(DRAWER)).toHaveCount(0);
    await waitPreviewsSettled(page);
    expect(await gestureSent(page)).toBe('');
  });
}
