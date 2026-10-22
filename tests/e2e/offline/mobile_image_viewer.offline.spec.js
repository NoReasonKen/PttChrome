const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { waitPreviewsSettled, waitRectStable } = require('../helpers/layout');
const { doubleTap, touchPinch, touchDrag } = require('../helpers/real_input');
const {
  PREVIEW, VIEWER, VIEWER_IMAGE, bootImageArticle, openPreviewViewer,
  articleGeometry, collectSent, sentText,
} = require('../helpers/image_viewer');

const center = (page) => {
  const viewport = page.viewportSize();
  return { x: viewport.width / 2, y: viewport.height / 2 };
};

async function expectImageWidth(page, expected) {
  await expect.poll(async () => Math.abs((await page.locator(VIEWER_IMAGE).boundingBox()).width - expected)).toBeLessThan(2);
  return waitRectStable(page, VIEWER_IMAGE);
}

test('double tapping alternates fitted and twice-fitted size without resizing the article', async ({ page }) => {
  await bootImageArticle(page);
  await page.locator(PREVIEW).first().scrollIntoViewIfNeeded();
  await waitPreviewsSettled(page);
  await waitRectStable(page, PREVIEW);
  const before = await articleGeometry(page);
  await collectSent(page);
  await openPreviewViewer(page, { touch: true });
  const fitted = await waitRectStable(page, VIEWER_IMAGE);
  expect(fitted.width).toBeLessThanOrEqual(page.viewportSize().width + 1);

  await doubleTap(page, center(page));
  const zoomed = await expectImageWidth(page, fitted.width * 2);
  expect(zoomed.width).toBeGreaterThan(page.viewportSize().width);
  expect(Math.abs(zoomed.height - fitted.height * 2)).toBeLessThan(2);
  await doubleTap(page, center(page));
  await expectImageWidth(page, fitted.width);
  expect(await articleGeometry(page)).toEqual(before);

  await page.getByRole('button', { name: 'Close image viewer', exact: true }).tap();
  await expect(page.locator(VIEWER)).toHaveCount(0);
  expect(await articleGeometry(page)).toEqual(before);
  expect(await sentText(page)).toBe('');
});

test('diagonal pinch fine-tunes double-tap zoom and one-finger dragging pans the image', async ({ page }) => {
  await bootImageArticle(page);
  await openPreviewViewer(page, { touch: true });
  const fitted = await waitRectStable(page, VIEWER_IMAGE);
  await collectSent(page);
  await doubleTap(page, center(page));
  await expectImageWidth(page, fitted.width * 2);

  await touchPinch(page, center(page), 45, 76);
  await expect.poll(async () => (await page.locator(VIEWER_IMAGE).boundingBox()).width).toBeGreaterThan(fitted.width * 2.5);
  const enlarged = await waitRectStable(page, VIEWER_IMAGE);
  expect(enlarged.width).toBeGreaterThan(page.viewportSize().width);
  await expect(page.locator(VIEWER)).toBeVisible();

  await touchDrag(page, center(page), { x: center(page).x + 55, y: center(page).y + 45 }, 16);
  await expect.poll(async () => Math.abs((await page.locator(VIEWER_IMAGE).boundingBox()).x - enlarged.left)).toBeGreaterThan(20);
  const panned = await waitRectStable(page, VIEWER_IMAGE);
  expect(Math.abs(panned.width - enlarged.width)).toBeLessThan(2);
  await expect(page.locator(VIEWER)).toBeVisible();

  await touchPinch(page, center(page), 76, 45);
  await expect.poll(async () => (await page.locator(VIEWER_IMAGE).boundingBox()).width).toBeLessThan(enlarged.width * 0.8);
  await expect(page.locator(VIEWER)).toBeVisible();
  expect(await sentText(page)).toBe('');
});

test('browser Back closes the viewer before navigating the article', async ({ page }) => {
  await bootImageArticle(page);
  await openPreviewViewer(page, { touch: true });
  await page.waitForFunction(() => window.history.state?.pttchromeBackGuard);
  const before = await articleGeometry(page);
  await collectSent(page);
  await page.goBack();
  await expect(page.locator(VIEWER)).toHaveCount(0);
  expect(await articleGeometry(page)).toEqual(before);
  expect(await sentText(page)).toBe('');
  await page.waitForFunction(() => window.history.state?.pttchromeBackGuard);
});

test('Android host Back closes the viewer before sending terminal navigation', async ({ page }) => {
  await page.addInitScript(() => { window.__PTT_ANDROID__ = { version: 'test', site: 'wstelnet://localhost:8080/bbs' }; });
  await bootImageArticle(page);
  await openPreviewViewer(page, { touch: true });
  await collectSent(page);
  // This is the native host's documented JavaScript entry point, not a synthetic DOM event.
  await page.evaluate(() => window.pttHostBack());
  await expect(page.locator(VIEWER)).toHaveCount(0);
  expect(await sentText(page)).toBe('');
});

for (const [setting, prefs] of [
  ['terminal Back mapping', { mouseBackNav: 0 }],
  ['mouse browsing', { useMouseBrowsing: false }],
]) {
  test(`Back closes the viewer with ${setting} disabled and leaves no extra history step`, async ({ page }) => {
    await bootImageArticle(page);
    await ptt.applyPrefs(page, prefs);
    await page.locator(PREVIEW).first().scrollIntoViewIfNeeded();
    await waitPreviewsSettled(page);
    await waitRectStable(page, PREVIEW);
    const entryBefore = await page.evaluate(() => window.navigation.currentEntry.key);
    const before = await articleGeometry(page);
    await collectSent(page);

    await openPreviewViewer(page, { touch: true });
    await page.waitForFunction(() => window.history.state?.pttchromeBackGuard);
    await page.goBack();
    await expect(page.locator(VIEWER)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.navigation.currentEntry.key)).toBe(entryBefore);
    expect(await articleGeometry(page)).toEqual(before);
    expect(await sentText(page)).toBe('');

    await openPreviewViewer(page, { touch: true });
    await page.getByRole('button', { name: 'Close image viewer', exact: true }).tap();
    await expect(page.locator(VIEWER)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.navigation.currentEntry.key)).toBe(entryBefore);
    expect(await articleGeometry(page)).toEqual(before);
    expect(await sentText(page)).toBe('');
  });
}

test('Android host Back closes the viewer with mouse browsing disabled', async ({ page }) => {
  await page.addInitScript(() => { window.__PTT_ANDROID__ = { version: 'test', site: 'wstelnet://localhost:8080/bbs' }; });
  await bootImageArticle(page);
  await ptt.applyPrefs(page, { useMouseBrowsing: false });
  const entryBefore = await page.evaluate(() => window.navigation.currentEntry.key);
  await collectSent(page);
  await openPreviewViewer(page, { touch: true });
  await page.evaluate(() => window.pttHostBack());
  await expect(page.locator(VIEWER)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.navigation.currentEntry.key)).toBe(entryBefore);
  expect(await sentText(page)).toBe('');
});
