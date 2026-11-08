// The connection alert after a disconnect must stay reachable over every in-page
// layer (home dashboard, split reader, comment bar, article tools). Those layers
// are opaque and fixed over the terminal: an alert under them hides the only
// reconnect button a phone has (there is no Enter key). Runs in the
// offline-mobile project (Pixel 7 emulation).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');

test('reconnect from the alert while the home dashboard covers the main menu', async ({ page }) => {
  await bootOffline(page, ptt);
  // The dashboard fetches favorites 600ms after it shows: mark them fresh.
  await page.evaluate(() => { window.__app.homeDashboard._state.fetchedAt = Date.now(); });
  await drawMainMenu(page);
  await expect(page.locator('#homeDashboard')).toBeVisible();

  await page.evaluate(() => window.__stubWS.close());
  const reconnect = page.locator('#reactAlert').getByRole('button', {
    name: await page.evaluate(() => window.__i18n('alert_connectionReconnect')), exact: true,
  });
  await reconnect.click({ timeout: 5000 });
  await page.waitForFunction(() => window.__app.connectState === 1);
  await expect(page.locator('#reactAlert').getByRole('button')).toHaveCount(0);
});
