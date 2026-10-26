const { test, expect } = require('@playwright/test');
const { waitRectStable } = require('../helpers/layout');
const { nextFrames } = require('../helpers/real_input');
const { bootGestureArticle, beginArticleTouch, gestureSent } = require('../helpers/article_gestures');
const ptt = require('../helpers/ptt');
const { bootOffline, loadCassette, replayListCassette } = require('../helpers/replay');

test('right dragging retracts title and content together above a dark fallback while the toolbar stays fixed', async ({ page }, testInfo) => {
  await bootGestureArticle(page);
  const main = await waitRectStable(page, '.main');
  const title = await waitRectStable(page, '#mobileAppBar');
  const toolbar = await waitRectStable(page, '#mobileToolbar');
  const y = main.top + 100;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 140, y });
  expect((await waitRectStable(page, '.main')).left - main.left).toBeCloseTo(120, 0);
  expect((await waitRectStable(page, '#mobileAppBar')).left - title.left).toBeCloseTo(120, 0);
  expect((await waitRectStable(page, '#mobileToolbar')).left).toBe(toolbar.left);
  await expect(page.locator('[data-article-exit-underlay]')).toHaveAttribute('data-preview', 'fallback');
  expect(await gestureSent(page)).toBe('');
  await page.screenshot({ path: testInfo.outputPath('article-exit-fallback.png') });
  await contact.release({ cancel: true });
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  expect((await waitRectStable(page, '.main')).left).toBeCloseTo(main.left, 0);
  expect((await waitRectStable(page, '#mobileAppBar')).left).toBeCloseTo(title.left, 0);
  expect(await gestureSent(page)).toBe('');
});

test('a committed right drag sends one article exit only after release', async ({ page }) => {
  await bootGestureArticle(page);
  const main = await waitRectStable(page, '.main');
  const y = main.top + 100;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  expect(await gestureSent(page)).toBe('');
  await contact.release();
  await expect.poll(() => gestureSent(page)).toBe('\x1b[D');
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
});

test('short retractions, a second contact and resizing never exit the article', async ({ page }) => {
  await bootGestureArticle(page);
  const main = await waitRectStable(page, '.main');
  const y = main.top + 100;
  let contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 120, y });
  await contact.release();
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  expect((await waitRectStable(page, '.main')).left).toBeCloseTo(main.left, 0);
  contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.second({ x: 80, y });
  await contact.release();
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  await page.setViewportSize({ width: 360, height: 480 });
  await contact.release();
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
});

test('resizing during the accepted exit animation cancels navigation and restores the article', async ({ page }) => {
  await bootGestureArticle(page);
  const main = await waitRectStable(page, '.main');
  const y = main.top + 100;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.release();
  await page.setViewportSize({ width: 360, height: 480 });
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  await nextFrames(page, 20);
  expect(await gestureSent(page)).toBe('');
  expect((await waitRectStable(page, '.main')).left).toBeCloseTo(0, 0);
  expect((await waitRectStable(page, '#mobileAppBar')).left).toBeCloseTo(0, 0);
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
});

async function enterArticleFromList(page, beforeOpen = async () => {}) {
  const nav = loadCassette('cchat-list-nav');
  await bootOffline(page, ptt, { articleGestures: true });
  await ptt.applyPrefs(page, {
    enableEasyReading: true,
    enableEasyReadingList: false,
    useMouseBrowsing: true,
    mouseLeftClick: true,
  });
  await replayListCassette(page, nav);
  await page.waitForFunction(() => window.__app.buf.pageState === 2);
  await ptt.applyPrefs(page, {
    enableEasyReadingList: true,
    easyReadingListPrefetchCount: 200,
  });
  await page.waitForFunction(() => window.__app.listSession.state === 'active' &&
    window.__app.commandQueue.idle && window.__app.buf.listLines.length > 50);
  await expect(page.locator('#mainContainer .listBodyView')).toBeVisible();
  await page.locator('.listCard[data-list-author="kylin936"] .listCardBody').first().scrollIntoViewIfNeeded();
  await waitRectStable(page, '.listCard[data-list-author="kylin936"] .listCardBody');
  await beforeOpen();
  await page.locator('.listCard[data-list-author="kylin936"] .listCardBody').first().tap();
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
}

async function visibleTextMetrics(page, selector) {
  return page.locator(selector).evaluate(root => {
    const viewport = root.getBoundingClientRect();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const samples = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (!rect.height || rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
      samples.push({ text: node.textContent, width: rect.width, height: rect.height,
        fontSize: getComputedStyle(node.parentElement).fontSize,
        font: getComputedStyle(node.parentElement).font,
        textSizeAdjust: getComputedStyle(node.parentElement).textSizeAdjust });
    }
    return samples;
  });
}

test('the revealed list layer preserves the original rendered text size', async ({ page }, testInfo) => {
  let original;
  await enterArticleFromList(page, async () => {
    original = await visibleTextMetrics(page, '.main');
    await page.screenshot({ path: testInfo.outputPath('original-list.png') });
  });
  const main = await waitRectStable(page, '.main');
  const contact = await beginArticleTouch(page, { x: 20, y: main.top + 100 });
  await contact.move({ x: page.viewportSize().width - 20, y: main.top + 100 });
  const preview = await visibleTextMetrics(page, '[data-stack-layer]');
  await testInfo.attach('text-metrics', { body: JSON.stringify({ original, preview }, null, 2), contentType: 'application/json' });
  expect(preview.length).toBeGreaterThan(10);
  const originalByText = new Map(original.map(sample => [sample.text, sample]));
  const shared = preview.filter(sample => sample.text.trim().length > 2 && originalByText.has(sample.text));
  expect(shared.length).toBeGreaterThan(10);
  // The layer is a second instance of the same renderer; computed sizes may
  // differ only in sub-pixel rounding.
  const sizes = ({ font, fontSize, ...box }) => ({ box, font: parseFloat(fontSize), line: parseFloat(font.split('/')[1]) });
  for (const sample of shared) {
    const copy = sizes(sample);
    const original = sizes(originalByText.get(sample.text));
    expect(copy.box).toEqual(original.box);
    expect(Math.abs(copy.font - original.font)).toBeLessThan(0.01);
    expect(Math.abs(copy.line - original.line)).toBeLessThan(0.01);
  }
  await contact.release({ cancel: true });
});

test('entering from a real list keeps that list as an inert layer while dragging and exits to it', async ({ page }, testInfo) => {
  await enterArticleFromList(page);
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  const main = await waitRectStable(page, '.main');
  const y = main.top + 100;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  const underlay = page.locator('[data-article-exit-underlay]');
  await expect(underlay).toHaveAttribute('data-preview', 'layer');
  // Until the release commits, the revealed list takes no input.
  await expect(page.locator('[data-stack-layer]')).toHaveAttribute('inert', '');
  await expect(page.locator('[data-stack-layer]')).toBeVisible();
  await expect(underlay.locator('.articleExitListTitle')).toHaveText('C_Chat');
  await page.screenshot({ path: testInfo.outputPath('article-exit-matching-list.png') });
  await contact.release();
  await expect(underlay).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.main #mainContainer .listBodyView')).toBeVisible();
  const outgoing = await page.evaluate(n => window.__replay.sent.slice(n).join(''), sentBefore);
  expect(outgoing.match(/\x1b\[D/g) || []).toHaveLength(1);
});

test('browser bar height changes keep the matching list layer, while a width change discards it', async ({ page }, testInfo) => {
  await enterArticleFromList(page);
  const { width, height } = page.viewportSize();
  const underlay = page.locator('[data-article-exit-underlay]');
  const dragToPreview = async () => {
    const main = await waitRectStable(page, '.main');
    const y = main.top + 100;
    const contact = await beginArticleTouch(page, { x: 20, y });
    await contact.move({ x: 200, y });
    return contact;
  };

  // Mobile browsers show and hide their address bar while the article scrolls.
  for (const change of [-56, 56]) {
    await page.setViewportSize({ width, height: height + change });
    await nextFrames(page, 4);
    const contact = await dragToPreview();
    await expect(underlay).toHaveAttribute('data-preview', 'layer');
    await expect(underlay.locator('.articleExitListTitle')).toHaveText('C_Chat');
    if (change < 0) await page.screenshot({ path: testInfo.outputPath('article-exit-preview-after-resize.png') });
    await contact.release({ cancel: true });
    await expect(underlay).toHaveCount(0);
  }

  // Rotation re-lays out the list, so the kept layer no longer matches it.
  await page.setViewportSize({ width: width - 52, height });
  await nextFrames(page, 4);
  const contact = await dragToPreview();
  await expect(underlay).toHaveAttribute('data-preview', 'fallback');
  await contact.release({ cancel: true });
  await expect(underlay).toHaveCount(0);
});
