const { test, expect } = require('@playwright/test');
const { waitPreviewsSettled, waitRectStable } = require('../helpers/layout');
const {
  PREVIEW, VIEWER, bootImageArticle, openPreviewViewer,
  articleGeometry, collectSent, sentText,
} = require('../helpers/image_viewer');

test('opening an image uses a separate viewer and preserves the article reading position', async ({ page }) => {
  await bootImageArticle(page);
  await page.locator(PREVIEW).first().scrollIntoViewIfNeeded();
  await waitPreviewsSettled(page);
  await waitRectStable(page, PREVIEW);
  const before = await articleGeometry(page);
  await collectSent(page);

  await openPreviewViewer(page);
  expect(await articleGeometry(page)).toEqual(before);
  await expect(page.locator('#mainContainer .previewZoomBar')).toHaveCount(0);
  await expect(page.locator('#mainContainer')).not.toHaveClass(/imagesEnlarged|imagesZoomed/);
  expect(await sentText(page)).toBe('');

  await page.getByRole('button', { name: 'Close image viewer', exact: true }).click();
  await expect(page.locator(VIEWER)).toHaveCount(0);
  expect(await articleGeometry(page)).toEqual(before);
  expect(await sentText(page)).toBe('');
});

test('keyboard opening isolates background controls and terminal keys, and restores focus after closing', async ({ page }) => {
  await bootImageArticle(page);
  const preview = page.locator(PREVIEW).first();
  await preview.scrollIntoViewIfNeeded();
  await waitPreviewsSettled(page);
  await waitRectStable(page, PREVIEW);
  await preview.focus();
  await collectSent(page);

  for (let cycle = 0; cycle < 2; ++cycle) {
    await page.keyboard.press('Enter');
    await expect(page.locator(VIEWER)).toBeVisible();
    for (let step = 0; step < 5; ++step) {
      await page.keyboard.press('Tab');
      // Tab may enter browser chrome, as with a native modal dialog, but never the background app.
      await expect.poll(() => page.evaluate(() => document.activeElement === document.body ||
        !!document.activeElement.closest('.pswp'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body ||
      !!document.activeElement.closest('.pswp'))).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('PageDown');
    await page.keyboard.press('a');
    await expect(page.locator(VIEWER)).toBeVisible();
    expect(await sentText(page)).toBe('');
    await page.keyboard.press('Escape');
    await expect(page.locator(VIEWER)).toHaveCount(0);
    await expect(preview).toBeFocused();
    expect(await sentText(page)).toBe('');
  }
});
