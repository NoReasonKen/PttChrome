// Inline preview geometry stays independent of image-viewer zoom.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { findCassette, bootOffline, replayCassette } = require('../helpers/replay');
const { waitPreviewsSettled, waitRectStable } = require('../helpers/layout');

const article = findCassette('article');
const IMAGE = '[data-e2e-preview-image]';

async function bootImage(page) {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await replayCassette(page, article, { easyReading: true });
  await waitPreviewsSettled(page);
  for (let step = 0; step < 100; step += 1) {
    const result = await page.evaluate(() => {
      const image = Array.from(document.querySelectorAll('#mainContainer img.hyperLinkPreview'))
        .find((img) => img.naturalWidth > 0 && img.offsetHeight > 0);
      if (image) {
        image.setAttribute('data-e2e-preview-image', '1');
        image.scrollIntoView({ block: 'center' });
        return 'found';
      }
      const scroller = document.querySelector('.main');
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) return 'end';
      scroller.scrollTop += scroller.clientHeight * 0.8;
      return 'next';
    });
    await waitPreviewsSettled(page);
    if (result === 'found') {
      await waitRectStable(page, IMAGE);
      return;
    }
    if (result === 'end') break;
  }
  throw new Error('The article cassette must contain a loaded image');
}

test.describe('inline preview sizing', () => {
  test.skip(!article, 'An article cassette is required');

  test('previews preserve aspect ratio within the taller reading bounds', async ({ page }) => {
    await bootImage(page);
    const geometry = await page.locator(IMAGE).evaluate((img) => {
      const em = parseFloat(getComputedStyle(img).fontSize);
      return {
        width: img.offsetWidth,
        height: img.offsetHeight,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        maxHeight: parseFloat(getComputedStyle(img).maxHeight),
        em,
      };
    });
    expect(geometry.maxHeight).toBeCloseTo(geometry.em * 23.75, 1);
    const scale = Math.min(1, geometry.em * 39 / geometry.naturalWidth,
      geometry.em * 23.75 / geometry.naturalHeight);
    expect(Math.abs(geometry.width - geometry.naturalWidth * scale)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.height - geometry.naturalHeight * scale)).toBeLessThanOrEqual(1);
    await expect(page.locator('.previewZoomBar')).toHaveCount(0);
  });

  test('intrinsic placeholders match the inline image without expanding its grid track', async ({ page }) => {
    await bootImage(page);
    const geometry = await page.locator(IMAGE).evaluate((img) => {
      const slot = img.closest('.inlinePreviewSlot');
      const ghost = document.createElement('div');
      ghost.className = 'easyReadingImg inlinePreviewGhost';
      ghost.style.setProperty('--ghost-w', `${img.naturalWidth}px`);
      ghost.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      slot.querySelector('.inlinePreviewSpacer').appendChild(ghost);
      const measured = {
        image: [img.offsetWidth, img.offsetHeight],
        ghost: [ghost.offsetWidth, ghost.offsetHeight],
        slotWidth: slot.clientWidth,
      };
      ghost.remove();
      return measured;
    });
    expect(geometry.ghost[0]).toBeLessThanOrEqual(geometry.slotWidth + 1);
    expect(Math.abs(geometry.image[0] - geometry.ghost[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.image[1] - geometry.ghost[1])).toBeLessThanOrEqual(1);
  });
});
