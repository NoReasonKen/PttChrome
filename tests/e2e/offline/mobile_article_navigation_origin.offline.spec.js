const { test, expect } = require('@playwright/test');
const { bootThreadBoard, FAR_BOARD } = require('../helpers/thread_jump');
const { waitRectStable, waitScrollStable } = require('../helpers/layout');
const { revealArticleDrawer } = require('../helpers/article_gestures');
const { touchDrag } = require('../helpers/real_input');

// Keep the destination's first page taller than the viewport. A short page
// automatically clamps scrollTop to zero and conceals source-position carryover.
for (const [source, target, key] of [[600, 40, '['], [40, 1, '['], [1, 40, ']'], [40, 1, '=']]) {
  test(`a same-thread ${key} jump from scrolled article ${source} opens ${target} at the top`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 412, height: 840 });
    await bootThreadBoard(page, { open: source, thread: FAR_BOARD.map(a => ({ ...a, lines: 100, withHeader: true, wrapBody: true })) });
    await expect.poll(() => page.evaluate(() => window.__app.easyReading.easyReadingReachedPageEnd)).toBe(true);
    const main = '.main:not([data-stack-layer])';
    const box = await waitRectStable(page, main);
    await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => page.evaluate(() => window.__app.view.mainDisplay.scrollTop)).toBeGreaterThan(0);
    await revealArticleDrawer(page);
    await page.locator(`[data-article-shortcut="${key}"]`).tap();
    await expect.poll(() => page.evaluate(() => window.__threadServer.state.open.num)).toBe(target);
    await expect.poll(() => page.evaluate(() => !window.__app.threadJump.active && window.__app.easyReading.easyReadingReachedPageEnd)).toBe(true);
    await waitScrollStable(page, main);
    expect(await page.evaluate(() => window.__app.view.mainDisplay.scrollTop)).toBe(0);
    if (source === 40 && key === '[') {
      const screenshot = await page.screenshot();
      await testInfo.attach('article-origin', { body: screenshot, contentType: 'image/png' });
    }
  });
}

for (const entry of ['tap', 'pull']) {
  test(`opening the next article by ${entry} from a scrolled long article starts at the top`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 840 });
    const thread = [...FAR_BOARD, { num: 39, author: 'alice', title: '[Talk] Source', date: '9/01' }]
      .map(a => ({ ...a, lines: 100, withHeader: true, wrapBody: true }));
    await bootThreadBoard(page, { open: 39, nativeList: true, nextArticle: true, thread });
    await expect.poll(() => page.evaluate(() => window.__app.easyReading.easyReadingReachedPageEnd)).toBe(true);
    const card = page.locator('#nextArticleCard');
    await expect(card).toBeVisible();
    if (entry === 'tap') await card.tap();
    else {
      await page.evaluate(() => { const main = window.__app.view.mainDisplay; main.scrollTop = main.scrollHeight; });
      await waitScrollStable(page, '.main:not([data-stack-layer])');
      const box = await waitRectStable(page, '.main:not([data-stack-layer])');
      await touchDrag(page, { x: box.left + 100, y: box.top + 300 }, { x: box.left + 100, y: box.top + 80 });
    }
    await expect.poll(() => page.evaluate(() => window.__threadServer.state.open.num)).toBe(40);
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && window.__app.easyReading.easyReadingReachedPageEnd)).toBe(true);
    await waitScrollStable(page, '.main:not([data-stack-layer])');
    expect(await page.evaluate(() => window.__app.view.mainDisplay.scrollTop)).toBe(0);
  });
}
