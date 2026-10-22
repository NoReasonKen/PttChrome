// Lazy preview round trips must preserve content without blank gaps or skipped images.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootOffline, replayCassette } = require('../helpers/replay');
const { waitPreviewsSettled } = require('../helpers/layout');

const article = loadCassette('stock-end');
const readGeometry = (page) => page.evaluate(() => {
  const scroller = document.querySelector('.main');
  return { top: scroller.scrollTop, height: scroller.scrollHeight, viewport: scroller.clientHeight };
});

async function scrollTo(page, top) {
  await page.evaluate((value) => { document.querySelector('.main').scrollTop = value; }, top);
  await waitPreviewsSettled(page);
}

test('scrolling through images and back keeps every measured preview readable', async ({ page }) => {
  test.setTimeout(300000);
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true, enablePicPreview: true });
  await replayCassette(page, article, { easyReading: true });
  await waitPreviewsSettled(page);
  const count = await page.evaluate(() => {
    const slots = document.querySelectorAll('.inlinePreviewSlot');
    slots.forEach((slot, index) => { slot.dataset.e2eSlot = String(index); });
    return slots.length;
  });
  expect(count).toBeGreaterThan(0);
  let geometry = await readGeometry(page);
  const step = Math.max(150, geometry.viewport * 0.5);
  for (let top = 0; top <= geometry.height; top += step) {
    await scrollTo(page, top);
    geometry = await readGeometry(page);
  }
  await scrollTo(page, geometry.height);
  const measured = await page.evaluate(() => Array.from(document.querySelectorAll('.inlinePreviewSlot'))
    .filter((slot) => parseFloat(slot.querySelector('.inlinePreviewSpacer').style.minHeight) > 0)
    .map((slot) => Number(slot.dataset.e2eSlot)));
  expect(measured.length, 'The article must contain measured preview slots').toBeGreaterThan(0);

  const seen = new Set();
  const trace = [];
  let worstBlank = 0;
  let geometryNow = await readGeometry(page);
  while (true) {
    const visible = await page.evaluate(() => {
      const view = document.querySelector('.main').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.inlinePreviewSlot')).flatMap((slot) => {
        const rect = slot.getBoundingClientRect();
        if (rect.bottom <= view.top || rect.top >= view.bottom) return [];
        const media = slot.querySelector('img.hyperLinkPreview, video.easyReadingVideo, iframe');
        return [{ index: Number(slot.dataset.e2eSlot), blank: slot.offsetHeight - (media?.offsetHeight || 0) }];
      });
    });
    visible.forEach(({ index, blank }) => {
      seen.add(index);
      worstBlank = Math.max(worstBlank, blank);
    });
    if (geometryNow.top === 0) break;
    const previousTop = geometryNow.top;
    await scrollTo(page, Math.max(0, previousTop - step));
    geometryNow = await readGeometry(page);
    trace.push([previousTop, geometryNow.top]);
    expect(geometryNow.top, JSON.stringify(trace)).toBeLessThan(previousTop);
  }
  expect(worstBlank, 'Loaded previews must not retain image-sized empty space').toBeLessThan(80);
  expect(measured.filter((index) => !seen.has(index)), 'No measured image may be skipped while scrolling back').toEqual([]);
});
