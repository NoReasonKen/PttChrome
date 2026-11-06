const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { installPixivBridge, feedPixivArticle, IMAGE } = require('../helpers/pixiv_lookup');
const { collectSent, sentText } = require('../helpers/image_viewer');
const { waitRectStable } = require('../helpers/layout');

const link = (page, id) => page.locator(`#mainContainer [data-pixiv-id="${id}"]`).first();
const chooser = page => page.locator('.PixivLookup');
async function boot(page, { enabled = true, supported = true, merged = true } = {}) {
  await installPixivBridge(page, { supported });
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enablePixivLookup: enabled, enableEasyReading: true,
    enableEasyReadingList: false, mergeSameAuthorComments: merged });
  await feedPixivArticle(page);
}
async function reply(page, kind, result, complete = true) {
  await expect(chooser(page)).toBeVisible();
  const query = await chooser(page).getAttribute('data-pixiv-query');
  await expect.poll(() => page.evaluate(({kind, query}) => window.__pixivRequests.some(x =>
    x.op === 'pixivLookup' && x.kind === kind && x.query === query), {kind, query})).toBe(true);
  await page.evaluate(({ kind, result, complete }) => {
    const query = document.querySelector('.PixivLookup').dataset.pixivQuery;
    const request = window.__pixivRequests.findLast(x => x.op === 'pixivLookup' && x.kind === kind && x.query === query);
    window.__pixivReply(request, result, complete);
  }, { kind, result, complete });
}

test('only opted-in supported article text is linked, without prefetching', async ({ page }) => {
  await boot(page);
  for (const id of ['65964428', '117918634', '65847159', '105176734']) await expect(link(page, id)).toHaveCount(1);
  await expect(page.locator('#mainContainer [data-pixiv-id="65964428"]')).toHaveCount(1);
  for (const id of ['146814133', '12345678', '2026', '12', '127']) await expect(link(page, id)).toHaveCount(0);
  expect(await page.evaluate(() => window.__pixivRequests.filter(x => x.op === 'pixivLookup'))).toEqual([]);
  await ptt.applyPrefs(page, { enablePixivLookup: false });
  await expect(page.locator('[data-pixiv-id]')).toHaveCount(0);
});

test('a real tap opens independent metadata-first cards and closing cancels without PTT keys', async ({ page }, testInfo) => {
  await boot(page);
  await collectSent(page);
  await link(page, '65964428').tap();
  await expect(chooser(page)).toBeVisible();
  await reply(page, 'user', { name: 'User name '.repeat(20), description: 'Biography '.repeat(100) }, false);
  const user = page.locator('[data-pixiv-kind="user"]');
  await expect(user.locator('a')).toHaveAttribute('href', 'https://www.pixiv.net/users/65964428');
  await expect(user.locator('[data-pixiv-image-state="loading"]')).toBeVisible();
  await reply(page, 'artwork', { name: 'Artwork title '.repeat(20), author: 'Author '.repeat(30),
    description: 'Plain text <script> is never executed. '.repeat(50), imageData: IMAGE, width: 383, height: 540 });
  await reply(page, 'user', { name: 'User name '.repeat(20), description: 'Biography '.repeat(100), imageData: IMAGE, imageDefault: true });
  await expect(user.locator('img')).toBeVisible();
  expect(await user.locator('img').evaluate(image => {
    const style = getComputedStyle(image);
    return { padding: style.padding, background: style.backgroundColor, fit: style.objectFit };
  })).toEqual({ padding: '0px', background: 'rgba(0, 0, 0, 0)', fit: 'contain' });
  const clamps = await page.locator('.PixivLookupCard__Description').evaluateAll(nodes => nodes.map(node => ({
    clamp: getComputedStyle(node).webkitLineClamp,
    clipped: node.scrollHeight > node.clientHeight,
  })));
  expect(clamps.every(x => x.clamp === '3' && x.clipped)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pixiv-mobile-cards.png') });
  await page.locator('[data-pixiv-kind="artwork"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pixiv-mobile-artwork.png') });
  await page.touchscreen.tap(12, 12);
  await expect(chooser(page)).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pixivRequests.filter(x => x.op === 'pixivCancel').length)).toBe(1);
  expect(await sentText(page)).toBe('');
});

test('dismissal ignores late replies and Android Back closes the next lookup', async ({ page }) => {
  await boot(page); await collectSent(page);
  await link(page, '65964428').tap();
  await expect(chooser(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chooser(page)).not.toBeVisible();
  await link(page, '117918634').tap();
  await expect(chooser(page)).toHaveAttribute('data-pixiv-query', '117918634');
  await page.evaluate(() => {
    const old = window.__pixivRequests.find(x => x.op === 'pixivLookup');
    window.__pixivReply(old, { name: 'Stale result' });
  });
  await expect(page.getByText('Stale result', { exact: true })).toHaveCount(0);
  // The actual host calls this public entry point for Android system Back.
  await page.evaluate(() => window.pttHostBack());
  await expect(chooser(page)).not.toBeVisible();
  expect(await sentText(page)).toBe('');
});

test('missing metadata and image failure keep separate outcomes', async ({ page }) => {
  await boot(page, { merged: false });
  await link(page, '65847159').tap();
  await reply(page, 'user', { state: 'missing' });
  await reply(page, 'artwork', { name: 'Found artwork', imageError: true });
  await expect(page.locator('[data-pixiv-kind="user"]')).toHaveCount(0);
  await expect(page.locator('[data-pixiv-kind="user"] a')).toHaveCount(0);
  await expect(page.locator('[data-pixiv-kind="artwork"] a')).toHaveAttribute('href', 'https://www.pixiv.net/artworks/65847159');
  await expect(page.locator('[data-pixiv-image-state="unavailable"]')).toBeVisible();
});

test('restriction and site messages explain unavailable previews without hiding usable metadata', async ({ page }) => {
  await boot(page);
  await link(page, '65847159').tap();
  await reply(page, 'user', { state: 'unavailable', message: 'Sign in to view this user.' });
  await reply(page, 'artwork', { name: 'Restricted artwork', restriction: 'r18', imageError: true });
  await expect(page.locator('[data-pixiv-kind="user"]')).toContainText('Sign in to view this user.');
  await expect(page.locator('[data-pixiv-kind="artwork"]')).toContainText('Unable to view R-18 works');
  await expect(page.locator('[data-pixiv-kind="artwork"] a')).toHaveAttribute('href', 'https://www.pixiv.net/artworks/65847159');
  await expect(page.locator('[data-pixiv-kind="artwork"] img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(chooser(page)).not.toBeVisible();
});

test('compact cards fill three description lines and keep tall images and the popup within viewport limits', async ({ page }, testInfo) => {
  await boot(page);
  await link(page, '65964428').tap();
  const description = 'Short first.\n\nShort third.\n\n' + 'A continuous description fills the available width. '.repeat(30);
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 1800;
    return canvas.toDataURL();
  });
  await reply(page, 'user', { name: 'User name', description, imageData: IMAGE });
  await reply(page, 'artwork', { name: 'Artwork title', author: 'Artist', description,
    imageData, width: 300, height: 1800 });
  await expect(page.locator('[data-pixiv-kind="artwork"] img')).toHaveJSProperty('naturalHeight', 1800);
  await waitRectStable(page, '[data-sheet="pixivLookup"]', { fullRect: true });
  const geometry = await page.evaluate(() => {
    const popup = document.querySelector('[data-sheet="pixivLookup"]');
    const image = document.querySelector('[data-pixiv-kind="artwork"] img').getBoundingClientRect();
    const name = document.querySelector('.PixivLookupCard__Name');
    const description = document.querySelector('.PixivLookupCard__Description');
    const box = description.getBoundingClientRect();
    const node = description.firstChild;
    let lastRight = box.left;
    for (let index = 0; index < node.length; index++) {
      const range = document.createRange();
      range.setStart(node, index); range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      if (rect.top >= box.bottom - 17 && rect.top < box.bottom - 1) lastRight = Math.max(lastRight, rect.right);
    }
    return { height: innerHeight, popupHeight: popup.getBoundingClientRect().height,
      imageHeight: image.height, imageRatio: image.width / image.height,
      titleFont: getComputedStyle(name).fontSize,
      appTitleFont: getComputedStyle(document.querySelector('.mobileAppBarTitle')).fontSize,
      descriptionFont: getComputedStyle(description).fontSize,
      appSubtitleFont: getComputedStyle(document.querySelector('.mobileAppBarSubtitle')).fontSize,
      lastLineFill: (lastRight - box.left) / box.width,
      headingLinked: !!name.closest('a'), closeButtons: popup.querySelectorAll('button').length };
  });
  expect(geometry.popupHeight).toBeLessThanOrEqual(geometry.height * 0.5 + 1);
  expect(geometry.imageHeight).toBeGreaterThan(0);
  expect(geometry.imageHeight).toBeLessThanOrEqual(geometry.height * 0.5 + 1);
  expect(geometry.imageRatio).toBeCloseTo(1 / 6, 2);
  expect(geometry.titleFont).toBe(geometry.appTitleFont);
  expect(geometry.descriptionFont).toBe(geometry.appSubtitleFont);
  expect(geometry.lastLineFill).toBeGreaterThan(0.8);
  expect(geometry.headingLinked).toBe(true);
  expect(geometry.closeButtons).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('pixiv-compact-cards.png') });
});

test('both missing types show one empty result while temporary errors remain visible', async ({ page }) => {
  await boot(page);
  await link(page, '65964428').tap();
  await reply(page, 'user', { state: 'missing' });
  await expect(page.locator('[data-pixiv-kind="user"]')).toHaveCount(0);
  await expect(page.locator('[data-pixiv-kind="artwork"]')).toBeVisible();
  await reply(page, 'artwork', { state: 'missing' });
  await expect(page.locator('[data-pixiv-kind]')).toHaveCount(0);
  await expect(page.locator('[data-pixiv-empty]')).toBeVisible();
  await page.keyboard.press('Escape');
  await link(page, '117918634').tap();
  await reply(page, 'user', { state: 'unavailable' });
  await expect(page.locator('[data-pixiv-kind="user"]')).toHaveAttribute('data-pixiv-state', 'unavailable');
});

test('a corrupt downloaded image preserves its link and an outside tap closes the chooser', async ({ page }) => {
  await boot(page); await collectSent(page);
  await link(page, '65964428').tap();
  await reply(page, 'user', { state: 'missing' });
  await reply(page, 'artwork', { imageData: 'data:image/png;base64,YmFk', name: 'Image decode failure' });
  const artwork = page.locator('[data-pixiv-kind="artwork"]');
  await expect(artwork.locator('[data-pixiv-image-state="unavailable"]')).toBeVisible();
  await expect(artwork.locator('a')).toHaveAttribute('href', 'https://www.pixiv.net/artworks/65964428');
  await waitRectStable(page, '[data-sheet="pixivLookup"]', { fullRect: true });
  await page.touchscreen.tap(12, 12);
  await expect(chooser(page)).not.toBeVisible();
  expect(await sentText(page)).toBe('');
});

test('old APKs leave numbers inert even with a synchronized enabled preference', async ({ page }) => {
  await boot(page, { supported: false });
  await expect(page.locator('[data-pixiv-id]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pixivRequests.filter(x => x.op === 'pixivLookup'))).toEqual([]);
});

test('the enhancement setting defaults off and is available only on supported APKs', async ({ page }, testInfo) => {
  await installPixivBridge(page);
  await bootOffline(page, ptt);
  await page.locator('[data-key="__more"]').tap();
  await page.locator('[data-key="__settings"]').tap();
  const settings = page.locator('.PrefModal');
  await expect(settings).toBeVisible();
  await settings.locator('[data-pref-category="enhance"]').tap();
  const option = settings.locator('input[name="enablePixivLookup"]');
  await expect(option).not.toBeChecked();
  await expect(option).toBeEnabled();
  await settings.locator('label[for="pref-check-enablePixivLookup"]').tap();
  await expect(option).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('pixiv-enhancement-setting.png') });
});
