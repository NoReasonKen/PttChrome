// Prepared-list lifecycle through real entry, touch, Back and native IME facts.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { bootNestedShortcutSearch, waitList, waitArticle, tapCard } = require('../helpers/article_shortcut_search');
const { MAIN } = require('../helpers/stack_routes');
const { waitRectStable } = require('../helpers/layout');

const BOARD = { has: ['Alpha topic', 'Delta topic'] };
const PREPARED = '[data-stack-parked]';
const SHOWN_LIST = '[data-stack-layer="articleList"]:not([data-stack-parked])';

// A screenshot observes paint order even when inert layers cannot be hit-tested.
async function pixelAt(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css' });
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return [...context.getImageData(0, 0, 1, 1).data];
  }, png.toString('base64'));
}

async function enterAlpha(page, { portrait = false } = {}) {
  await bootNestedShortcutSearch(page, { dynamicRows: true, extraArticles: 40 });
  if (portrait) {
    // The image fixture starts at a deliberately short viewport. Give the
    // keyboard and key panel a real article area in which a touch can start.
    await page.setViewportSize({ width: 412, height: 850 });
    await expect.poll(async () => (await page.locator(MAIN).boundingBox()).height).toBeGreaterThan(600);
    await page.waitForFunction(() => !window.__app.buf.easyReadingResizeInFlight && window.__app.commandQueue.idle);
  }
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, BOARD);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await expect(page.locator('[data-stack-entry-underlay]')).toHaveCount(0);
  await expect(page.locator(PREPARED)).toHaveCount(1);
}

test('entry with a mismatched article board discards its list without reviving a destroyed layer', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await bootNestedShortcutSearch(page);
  // The controlled server returns a different board's list, then an article
  // whose header still says Test. The real navigation owner rejects the pair.
  await page.evaluate(() => { window.__shortcutServer.state.board = 'Other'; });
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, BOARD);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await expect(page.locator('[data-stack-entry-underlay]')).toHaveCount(0);
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keyboard changes keep a prepared list intact and reveal it at the real list geometry', async ({ page }, testInfo) => {
  // Substitute only the Android host fact; input and layout stay real.
  await page.addInitScript(() => { window.__PTT_ANDROID__ = { version: 'test' }; });
  await enterAlpha(page, { portrait: true });
  const before = await page.locator(PREPARED).boundingBox();
  await page.locator('[data-key="__keys"]').tap();
  await page.locator('[data-key="__keyboard"]').tap();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pttandroid:ime', { detail: { inset: 200 } })));
  await expect.poll(() => page.evaluate(() => window.__app.view.keyboardInset)).toBeGreaterThanOrEqual(200);
  const article = await waitRectStable(page, MAIN, { fullRect: true });
  expect(article.height).toBeLessThan(before.height);
  expect((await page.locator(PREPARED).boundingBox()).height).toBe(before.height);
  await page.screenshot({ path: testInfo.outputPath('keyboard-article.png') });
  const contact = await beginArticleTouch(page, { x: 20, y: article.top + 50 });
  await contact.move({ x: 36, y: article.top + 50 });
  await contact.move({ x: page.viewportSize().width - 12, y: article.top + 50 });
  const revealed = await waitRectStable(page, SHOWN_LIST, { fullRect: true });
  const heading = await page.locator('.stackUnderlayTitle').boundingBox();
  // Away from the short title and the moving foreground, the lower App Bar's
  // opaque background must cover the list, just as the real App Bar does.
  expect(await pixelAt(page, Math.floor(heading.x + heading.width / 2), Math.floor(heading.y + heading.height / 2)))
    .toEqual([20, 20, 24, 255]);
  await page.screenshot({ path: testInfo.outputPath('keyboard-revealed.png') });
  await contact.release();
  await waitList(page, BOARD);
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  const real = await waitRectStable(page, MAIN, { fullRect: true });
  expect(real.height).toBeCloseTo(revealed.height, 0);
  expect(real.top).toBeCloseTo(revealed.top, 0);
  await page.screenshot({ path: testInfo.outputPath('keyboard-list.png') });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pttandroid:ime', { detail: { inset: 0 } })));
});

test('rotation prepares the list viewport at its new width before the next drag', async ({ page }) => {
  await enterAlpha(page);
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width: height, height: width });
  await expect.poll(async () => (await page.locator(MAIN).boundingBox()).width).toBeCloseTo(height, 0);
  await page.waitForFunction(() => {
    const app = window.__app;
    const layer = document.querySelector('[data-stack-parked]');
    return !app.buf.easyReadingResizeInFlight && layer &&
      layer.clientWidth === app.view.mainDisplay.clientWidth &&
      layer.querySelector('.listBodyView').clientHeight === app.view.listCardViewportPx();
  });
  const article = await waitRectStable(page, MAIN, { fullRect: true });
  const contact = await beginArticleTouch(page, { x: 100, y: article.top + 50 });
  await contact.move({ x: 116, y: article.top + 50 });
  await contact.move({ x: 120, y: article.top + 50 });
  const revealed = await waitRectStable(page, SHOWN_LIST, { fullRect: true });
  expect(revealed.width).toBeCloseTo(height, 0);
  await contact.release({ cancel: true });
  await expect(page.locator(PREPARED)).toHaveCount(1);
});
