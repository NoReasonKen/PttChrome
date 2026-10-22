const { test, expect } = require('@playwright/test');
const { waitRectStable } = require('../helpers/layout');
const { doubleTap, touchPinch, touchDrag } = require('../helpers/real_input');
const { PREVIEW, VIEWER, VIEWER_IMAGE, bootImageArticle, openPreviewViewer } = require('../helpers/image_viewer');

test('small images can be enlarged beyond the viewport width', async ({ page }) => {
  await bootImageArticle(page, {
    imageResponse: {
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#589fcb"/></svg>',
    },
  });
  await openPreviewViewer(page, { touch: true });
  const fitted = await waitRectStable(page, VIEWER_IMAGE);
  expect(fitted.width).toBe(64);
  const center = { x: page.viewportSize().width / 2, y: page.viewportSize().height / 2 };
  await doubleTap(page, center);
  await expect.poll(async () => (await page.locator(VIEWER_IMAGE).boundingBox()).width).toBeCloseTo(128, 0);
  await touchPinch(page, center, 25, 110);
  await expect.poll(async () => (await page.locator(VIEWER_IMAGE).boundingBox()).width)
    .toBeGreaterThan(page.viewportSize().width);
});

test('the viewer survives viewport rotation and remains fitted at its initial zoom', async ({ page }) => {
  await bootImageArticle(page);
  await openPreviewViewer(page, { touch: true });
  await page.setViewportSize({ width: 720, height: 412 });
  await expect(page.locator(VIEWER)).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator(VIEWER_IMAGE).boundingBox();
    return box.width > 500 && box.x >= -1 && box.y >= -1 &&
      box.x + box.width <= 721 && box.y + box.height <= 413;
  }).toBe(true);
  await page.getByRole('button', { name: 'Close image viewer', exact: true }).tap();
  await expect(page.locator(VIEWER)).toHaveCount(0);
});

test('scrolling from a preview does not open the viewer, and disconnecting closes an open viewer', async ({ page }) => {
  await bootImageArticle(page);
  const image = page.locator(PREVIEW).first();
  await image.scrollIntoViewIfNeeded();
  const box = await image.boundingBox();
  const start = { x: box.x + box.width / 2, y: Math.min(box.y + box.height / 2, 300) };
  await touchDrag(page, start, { x: start.x, y: start.y - 100 });
  await expect(page.locator(VIEWER)).toHaveCount(0);
  await openPreviewViewer(page, { touch: true });
  await page.evaluate(() => window.__stubWS.close());
  await expect(page.locator(VIEWER)).toHaveCount(0);
  await expect(page.locator('#BBSWindow')).not.toHaveAttribute('inert');
});
