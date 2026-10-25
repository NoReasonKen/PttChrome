// Another screen copy earlier in the document, as a stacked-page layer will be
// (#25, #26), must not capture anything that belongs to the active screen.
const { test, expect } = require('@playwright/test');
const { waitRectStable } = require('../helpers/layout');
const { PREVIEW, bootImageArticle } = require('../helpers/image_viewer');
const { beginArticleTouch } = require('../helpers/article_gestures');
const ptt = require('../helpers/ptt');
const { bootOffline, loadCassette, replayListCassette } = require('../helpers/replay');
const { ACTIVE_MAIN: MAIN, addScreenCopy } = require('../helpers/screen_copy');

const ownScreen = page => page.evaluate(() => {
  const app = window.__app;
  return !!app.view.mainContainer && app.view.mainDisplay.contains(app.view.mainContainer);
});

test('image previews and the view screen stay on the active screen when a copy comes first', async ({ page }) => {
  await addScreenCopy(page);
  await bootImageArticle(page);
  expect(await ownScreen(page)).toBe(true);
  await expect(page.locator(`${MAIN} ${PREVIEW}`).first()).toBeVisible();
  await expect(page.locator('[data-test-copy] img')).toHaveCount(0);
});

test('the article list keeps its reading position across an article when a copy comes first', async ({ page }) => {
  await addScreenCopy(page);
  const nav = loadCassette('cchat-list-nav');
  await bootOffline(page, ptt, { articleGestures: true });
  await ptt.applyPrefs(page, { enableEasyReading: true, enableEasyReadingList: false, useMouseBrowsing: true, mouseLeftClick: true });
  await replayListCassette(page, nav);
  await page.waitForFunction(() => window.__app.buf.pageState === 2);
  await ptt.applyPrefs(page, { enableEasyReadingList: true, easyReadingListPrefetchCount: 200 });
  await page.waitForFunction(() => window.__app.listSession.state === 'active' &&
    window.__app.commandQueue.idle && window.__app.buf.listLines.length > 50);
  const card = page.locator(`${MAIN} .listCard[data-list-author="kylin936"] .listCardBody`).first();
  await card.scrollIntoViewIfNeeded();
  const before = await waitRectStable(page, `${MAIN} .listCard[data-list-author="kylin936"] .listCardBody`);
  expect(await ownScreen(page)).toBe(true);
  await card.tap();
  await page.waitForFunction(() => window.__app.buf.pageState === 3);
  // Leave by the article swipe exit (the real mobile path).
  const main = await waitRectStable(page, MAIN);
  const exit = await beginArticleTouch(page, { x: 20, y: main.top + 100 });
  await exit.move({ x: page.viewportSize().width - 20, y: main.top + 100 });
  await exit.release();
  await page.waitForFunction(() => window.__app.buf.pageState === 2 && window.__app.listSession.state === 'active');
  const after = await waitRectStable(page, `${MAIN} .listCard[data-list-author="kylin936"] .listCardBody`);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2);
  expect(await page.locator('[data-test-copy]').evaluate(copy => copy.scrollTop)).toBe(0);
  await expect(page.locator('[data-test-copy] [srow="0"]')).toHaveText('copy');
});
