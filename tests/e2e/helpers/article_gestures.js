const { expect } = require('@playwright/test');
const { bootImageArticle } = require('./image_viewer');
const { cdp, nextFrames } = require('./real_input');
const { waitRectStable } = require('./layout');

const DRAWER = '[data-article-drawer]';
const PANEL = `${DRAWER} [role="dialog"]`;

async function bootGestureArticle(page, options = {}) {
  await bootImageArticle(page, { ...options, articleGestures: true });
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
  await page.evaluate(() => {
    window.__gestureSent = [];
    window.__stubWSSent = bytes => window.__gestureSent.push(bytes);
  });
}

async function beginArticleTouch(page, point) {
  const session = await cdp(page);
  const points = point => [{ id: 0, x: point.x, y: point.y }];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(point) });
  return {
    async move(point) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(point) });
      await nextFrames(page);
    },
    async release({ cancel = false, pause = true } = {}) {
      // Hold still past the velocity window to test distance without a fling.
      if (pause) await page.evaluate(async () => {
        const start = performance.now();
        while (performance.now() - start < 130) await new Promise(requestAnimationFrame);
      });
      await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      await nextFrames(page);
    },
    async second(point) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 0, ...point }, { id: 1, x: point.x + 30, y: point.y + 30 }]
      });
      await nextFrames(page);
    }
  };
}

async function revealArticleDrawer(page) {
  const width = page.viewportSize().width;
  const main = await waitRectStable(page, '.main');
  const y = main.top + Math.min(100, main.height / 2);
  const contact = await beginArticleTouch(page, { x: width - 24, y });
  await contact.move({ x: 12, y });
  await contact.release();
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
  return waitRectStable(page, PANEL);
}

const gestureSent = page => page.evaluate(() => (window.__gestureSent || []).join(''));

module.exports = { DRAWER, PANEL, bootGestureArticle, beginArticleTouch, revealArticleDrawer, gestureSent };
