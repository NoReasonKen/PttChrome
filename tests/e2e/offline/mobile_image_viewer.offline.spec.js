const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { waitPreviewsSettled, waitRectStable } = require('../helpers/layout');
const { doubleTap, touchPinch, touchDrag } = require('../helpers/real_input');
const {
  PREVIEW, VIEWER, VIEWER_IMAGE, bootImageArticle, openPreviewViewer,
  TALL_TRANSPARENT_IMAGE, articleGeometry, collectSent, sentText,
} = require('../helpers/image_viewer');

const center = (page) => {
  const viewport = page.viewportSize();
  return { x: viewport.width / 2, y: viewport.height / 2 };
};

async function expectImageWidth(page, expected) {
  await expect.poll(async () => Math.abs((await page.locator(VIEWER_IMAGE).boundingBox()).width - expected)).toBeLessThan(2);
  return waitRectStable(page, VIEWER_IMAGE);
}

async function swipeImage(page, direction, expectedSource) {
  const { width, height } = page.viewportSize();
  const from = { x: width * (direction === 'next' ? 0.8 : 0.2), y: height * 0.55 };
  const to = { x: width - from.x, y: from.y };
  await touchDrag(page, from, to, 16);
  if (expectedSource) {
    await expect(page.locator(VIEWER_IMAGE)).toHaveAttribute('src', expectedSource);
    await waitRectStable(page, VIEWER_IMAGE);
    await expect.poll(async () => {
      const box = await page.locator(VIEWER_IMAGE).boundingBox();
      return Math.abs(box.x + box.width / 2 - width / 2);
    }).toBeLessThan(2);
  } else {
    await expect(page.locator(VIEWER)).toHaveCount(0);
  }
}

async function expectCenteredPreview(page, selector) {
  const preview = page.locator(selector);
  await expect(preview).toBeVisible();
  await waitPreviewsSettled(page);
  await waitRectStable(page, selector);
  await expect.poll(() => preview.evaluate((image) => {
    const imageRect = image.getBoundingClientRect();
    const readingRect = document.querySelector('.main').getBoundingClientRect();
    return Math.abs(imageRect.top + imageRect.height / 2 - readingRect.top - readingRect.height / 2);
  })).toBeLessThan(3);
}

test('tall transparent previews fit half the mobile viewport and open in the viewer without a white frame', async ({ page }, testInfo) => {
  await bootImageArticle(page, { imageResponse: TALL_TRANSPARENT_IMAGE });
  const preview = page.locator(PREVIEW).first();
  await preview.scrollIntoViewIfNeeded();
  await waitPreviewsSettled(page);
  const rect = await waitRectStable(page, PREVIEW);
  expect(rect.height).toBeGreaterThan(page.viewportSize().height * 0.5 - 2);
  expect(rect.height).toBeLessThanOrEqual(page.viewportSize().height * 0.5 + 1);
  await page.screenshot({ path: testInfo.outputPath('article-tall-preview.png') });
  await openPreviewViewer(page, { touch: true });
  expect(await page.locator(VIEWER_IMAGE).evaluate((image) => {
    const style = getComputedStyle(image);
    return {
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      background: style.backgroundColor,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    };
  })).toEqual({
    padding: ['0px', '0px', '0px', '0px'],
    border: ['0px', '0px', '0px', '0px'],
    background: 'rgba(0, 0, 0, 0)',
    naturalWidth: 1200,
    naturalHeight: 2400,
  });
  const fitted = await waitRectStable(page, VIEWER_IMAGE);
  expect(fitted.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  expect(fitted.height).toBeGreaterThan(rect.height);
  await expect(page.locator(`${VIEWER} .pswp__item[aria-hidden="false"] .pswp__img--placeholder`)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('fitted-transparent-viewer.png') });
});

test('the image viewer skips an ordinary article link when swiping between images', async ({ page }, testInfo) => {
  const articleLink = 'https://www.ptt.cc/bbs/Test/M.1234567890.A.123.html';
  await bootImageArticle(page, { interveningLink: articleLink });
  await expect(page.locator(`#mainContainer a[href="${articleLink}"]`)).toHaveCount(1);
  await expect(page.locator(PREVIEW)).toHaveCount(2);
  await collectSent(page);
  await openPreviewViewer(page, { touch: true });
  await swipeImage(page, 'next', /viewer-two\.png$/);
  await swipeImage(page, 'previous', /viewer-one\.png$/);
  await swipeImage(page, 'next', /viewer-two\.png$/);
  await page.screenshot({ path: testInfo.outputPath('gallery-next.png') });
  await page.getByRole('button', { name: 'Close image viewer', exact: true }).tap();
  await expect(page.locator(VIEWER)).toHaveCount(0);
  await expectCenteredPreview(page, `${PREVIEW}[src$="viewer-two.png"]`);
  await page.screenshot({ path: testInfo.outputPath('article-return.png') });
  expect(await sentText(page)).toBe('');
});

test('left swipes show the next image and right swipes return to the previous image before closing at the start', async ({ page }) => {
  await bootImageArticle(page);
  await page.locator(PREVIEW).first().scrollIntoViewIfNeeded();
  await waitPreviewsSettled(page);
  const before = await articleGeometry(page);
  await collectSent(page);
  await openPreviewViewer(page, { touch: true });
  await swipeImage(page, 'next', /viewer-two\.png$/);
  await swipeImage(page, 'previous', /viewer-one\.png$/);
  await swipeImage(page, 'previous');
  expect(await articleGeometry(page)).toEqual(before);
  expect(await sentText(page)).toBe('');
});

test('the image viewer reaches unmounted images across a long article and centers the last image after swiping past it', async ({ page }) => {
  test.setTimeout(120000);
  await bootImageArticle(page, {
    galleryImages: [
      'https://i.urusai.cc/viewer-one.png',
      'https://i.urusai.cc/viewer-two.png',
      'https://i.urusai.cc/viewer-three.png',
    ],
  });
  await expect(page.locator('#mainContainer .inlinePreviewSlot')).toHaveCount(3);
  await expect(page.locator(`${PREVIEW}[src$="viewer-three.png"]`)).toHaveCount(0);
  const before = await articleGeometry(page);
  await collectSent(page);
  await openPreviewViewer(page, { touch: true });
  await swipeImage(page, 'next', /viewer-two\.png$/);
  await swipeImage(page, 'next', /viewer-three\.png$/);
  expect(await articleGeometry(page)).toEqual(before);
  await swipeImage(page, 'next');
  await expectCenteredPreview(page, `${PREVIEW}[src$="viewer-three.png"]`);
  expect((await articleGeometry(page)).scrollTop).toBeGreaterThan(before.scrollTop + page.viewportSize().height);
  expect(await sentText(page)).toBe('');
});

test('an image that finishes loading while it is the current slide opens fitted to the viewport', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await bootImageArticle(page, {
    galleryImages: [
      'https://i.urusai.cc/viewer-one.png',
      'https://i.urusai.cc/viewer-two.png',
      'https://i.urusai.cc/viewer-three.png',
    ],
  });
  // Hold the third image so the swipe reaches it while its loading placeholder is shown.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/viewer-three.png', async (route) => {
    await gate;
    await route.fulfill(TALL_TRANSPARENT_IMAGE);
  });
  try {
    await openPreviewViewer(page, { touch: true });
    await swipeImage(page, 'next', /viewer-two\.png$/);
    const { width, height } = page.viewportSize();
    await touchDrag(page, { x: width * 0.8, y: height * 0.55 }, { x: width * 0.2, y: height * 0.55 }, 16);
    await expect(page.locator(`${VIEWER} .pswp__item[aria-hidden="false"] .imageViewerLoading`)).toBeVisible();
    release();
    await expect(page.locator(VIEWER_IMAGE)).toHaveAttribute('src', /viewer-three\.png$/);
    const box = await waitRectStable(page, VIEWER_IMAGE);
    // The 1200x2400 image would cover several viewports at natural size.
    expect(box.height).toBeLessThanOrEqual(height + 1);
    expect(box.width).toBeLessThanOrEqual(width + 1);
    expect(Math.abs(box.width * 2 - box.height)).toBeLessThan(3);
    expect(Math.abs(box.left + box.width / 2 - width / 2)).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath('loaded-image-fit.png') });
  } finally {
    release();
  }
});

test('album images follow article order and closing centers the image currently being viewed', async ({ page }) => {
  test.setTimeout(120000);
  await bootImageArticle(page, {
    galleryImages: [
      'https://i.urusai.cc/viewer-one.png',
      'https://imgur.com/a/AbCdE',
      'https://i.urusai.cc/viewer-three.png',
    ],
  });
  await expect(page.locator(`${PREVIEW}[src*="offlineA."]`)).toHaveCount(0);
  await collectSent(page);
  await openPreviewViewer(page, { touch: true });
  await swipeImage(page, 'next', /offlineA\.(?:webp|png)$/);
  await swipeImage(page, 'next', /offlineB\.(?:webp|png)$/);
  await swipeImage(page, 'next', /viewer-three\.png$/);
  await page.getByRole('button', { name: 'Close image viewer', exact: true }).tap();
  await expect(page.locator(VIEWER)).toHaveCount(0);
  await expectCenteredPreview(page, `${PREVIEW}[src$="viewer-three.png"]`);
  expect(await sentText(page)).toBe('');
});

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
