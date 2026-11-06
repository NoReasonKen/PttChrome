const { test, expect } = require('@playwright/test');
const { installPixivBridge } = require('../helpers/pixiv_lookup');

// This explicit developer-only startup mode cannot run alongside ordinary
// replay cases: its server must have PIXIV_TEST_ARTICLE=1. It never connects PTT.
test.skip(process.env.PIXIV_TEST_ARTICLE !== '1', 'Requires the opt-in local test article server.');

test('the local test article preserves saved settings and uses the real chooser without a PTT connection', async ({ page }, testInfo) => {
  const sockets = [];
  const errors = [];
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('pageerror', error => errors.push(error.message));
  await installPixivBridge(page, { automatic: true });
  await page.addInitScript(() => {
    window.__originalPixivTestStorage = window.localStorage;
    window.localStorage.setItem('pixiv-test-preserve', 'original');
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-pixiv-test-article', 'ready');
  for (const id of ['117918634', '105176734', '65964428', '65847159', '151615046', '151656533', '146814133']) {
    await expect(page.locator(`#mainContainer [data-pixiv-id="${id}"]`).first()).toBeVisible();
  }
  await page.locator('#mainContainer [data-pixiv-id="117918634"]').first().tap();
  await expect(page.locator('.PixivLookup')).toBeVisible();
  await expect(page.locator('[data-pixiv-kind="user"] img')).toBeVisible();
  await expect(page.locator('[data-pixiv-kind="user"] a')).toHaveAttribute('href', 'https://www.pixiv.net/users/117918634');
  await page.goBack();
  await expect(page.locator('.PixivLookup')).not.toBeVisible();
  await page.locator('#mainContainer [data-pixiv-id="146814133"]').tap();
  await expect(page.locator('.PixivLookup')).toHaveAttribute('data-pixiv-query', '146814133');
  expect(await page.evaluate(() => window.pttHostBack())).toBe(true);
  await expect(page.locator('.PixivLookup')).not.toBeVisible();
  await expect(page.locator('#mainContainer [data-pixiv-id="146814133"]')).toBeVisible();
  expect(await page.evaluate(() => ({
    connection: window.__app.connectState,
    saved: window.__originalPixivTestStorage.getItem('pixiv-test-preserve'),
    temporary: window.localStorage.getItem('pixiv-test-preserve'),
    isolated: window.localStorage !== window.__originalPixivTestStorage,
  }))).toEqual({ connection: 0, saved: 'original', temporary: null, isolated: true });
  expect(sockets.filter(url => new URL(url).pathname === '/bbs')).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('pixiv-test-article.png') });
});
