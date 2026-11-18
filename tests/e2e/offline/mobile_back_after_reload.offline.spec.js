const { test, expect } = require('@playwright/test');
const {
  bootNestedShortcutSearch, nestedSessionAfterLogin, waitArticle
} = require('../helpers/article_shortcut_search');
const { waitConnected } = require('../helpers/replay');
const { pauseClockNow } = require('../helpers/clock');

// Browser history entries outlive a page reload (#19): the first Back after a
// reload must still run the normal Back action, not be taken for the guard's
// own entry because an earlier document used the same sentinel identity.

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
});

const more = page => page.locator('[data-sheet="more"]');
const guardState = page => page.evaluate(() => window.history.state && window.history.state.pttchromeBackGuard);

async function openArticle(page) {
  await page.evaluate(() => window.__app.aidNavigation.startResume({
    kind: 'article', board: 'Test', aid: '1gIeu-3A'
  }));
  await waitArticle(page, 'Alpha');
}

test('the first browser Back after a reload dismisses the open overlay', async ({ page }) => {
  await bootNestedShortcutSearch(page, { loggedIn: true });
  await openArticle(page);
  await page.locator('[data-key="__more"]').tap();
  await expect(more(page)).toBeVisible();
  await expect.poll(() => guardState(page)).toBeTruthy();

  await pauseClockNow(page);
  await page.reload();
  await page.clock.resume();
  await waitConnected(page);
  await nestedSessionAfterLogin(page);
  await waitArticle(page, 'Alpha');

  await page.locator('[data-key="__more"]').tap();
  await expect(more(page)).toBeVisible();
  await expect.poll(() => guardState(page)).toBeTruthy();
  await page.goBack();
  await expect(more(page)).toHaveCount(0, { timeout: 3000 });
});
