const { test, expect } = require('@playwright/test');
const { waitRectStable } = require('../helpers/layout');
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

test('entering from a real list preserves only a bounded inert matching preview and exits to that list', async ({ page }, testInfo) => {
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
  await page.locator('.listCard[data-list-author="kylin936"] .listCardBody').first().tap();
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  const main = await waitRectStable(page, '.main');
  const y = main.top + 100;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  const underlay = page.locator('[data-article-exit-underlay]');
  await expect(underlay).toHaveAttribute('data-preview', 'list');
  await expect(underlay).toHaveAttribute('inert', '');
  expect(await underlay.locator('[id], a, img, iframe, button, input, [src], [href], [data-row]').count()).toBe(0);
  expect(await underlay.locator('.articleExitListPreview > span').count()).toBeLessThanOrEqual(64);
  await expect(underlay.locator('.articleExitListTitle')).toHaveText('C_Chat');
  await page.screenshot({ path: testInfo.outputPath('article-exit-matching-list.png') });
  await contact.release();
  await expect(page.locator('#mainContainer .listBodyView')).toBeVisible();
  const outgoing = await page.evaluate(n => window.__replay.sent.slice(n).join(''), sentBefore);
  expect(outgoing.match(/\x1b\[D/g) || []).toHaveLength(1);
});
