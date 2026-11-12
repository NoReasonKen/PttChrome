// Preview slots and the ResizeObserver loop, fractional heights (#152). A
// slot's size report records its content height as offsetHeight, which rounds:
// at this width an inline image lays out 247.5px tall and the slot's floor
// became 248px. Writing that floor inside the observer callback grew the slot,
// and with it its long-page chunk, by half a pixel while Chrome was recording
// the chunk's remembered size (`contain-intrinsic-height: auto`), so Chrome
// reported "ResizeObserver loop completed with undelivered notifications".
// The width is the phone's; the default desktop viewport lays the same images
// out at whole pixels and hides the bug.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootOffline, replayCassette } = require('../helpers/replay');
const { waitPreviewsSettled } = require('../helpers/layout');

const article = loadCassette('stock-end');

test('images laid out at fractional heights load without a ResizeObserver loop', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 411, height: 840 });
  await page.addInitScript(() => {
    window.__resizeLoops = 0;
    window.addEventListener('error', e => {
      if (/ResizeObserver loop/.test(e.message || '')) window.__resizeLoops++;
    });
  });
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true, enablePicPreview: true });
  await replayCassette(page, article, { easyReading: true });
  await waitPreviewsSettled(page);

  // Walk the article so every image loads once.
  const step = await page.evaluate(() => document.querySelector('.main').clientHeight * 0.8);
  let fractional = 0;
  for (let y = 0, i = 0; i < 100; ++i, y += step) {
    await page.evaluate(top => { document.querySelector('.main').scrollTop = top; }, y);
    await waitPreviewsSettled(page);
    fractional += await page.evaluate(() =>
      Array.from(document.querySelectorAll('.inlinePreviewContent img.easyReadingImg'))
        .filter(img => img.offsetHeight > 0)
        .filter(img => !Number.isInteger(img.closest('.inlinePreviewContent').getBoundingClientRect().height))
        .length
    );
    if (y >= (await page.evaluate(() => document.querySelector('.main').scrollHeight))) break;
  }
  expect(fractional, 'no image laid out at a fractional height: the test cannot catch the bug').toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__resizeLoops)).toBe(0);
});
