// Switch board (`s`) from an easy-reading article (#262): the key opens the board
// sheet the lists and home use (without PTT's own prompt, so cancelling sends
// nothing), and choosing a board goes through the safe `s<board>` navigation.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootOffline, replayCassette } = require('../helpers/replay');

const CASSETTE = 'ask-aid-wrap';
const sheet = (page) => page.locator('[data-search-modal]');
const sent = (page) => page.evaluate(() => window.__replay.sent.join(''));

test.describe('switch board from an article (offline replay)', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    await bootOffline(page, ptt);
    await ptt.applyPrefs(page, { enableEasyReading: true });
    await replayCassette(page, loadCassette(CASSETTE), { easyReading: true });
    await page.waitForFunction(() => window.__app.buf.startedEasyReading);
  });

  test('s opens the board sheet and sends nothing; Esc goes back to the article', async ({ page }) => {
    const before = await sent(page);
    await ptt.sendKey(page, 's');
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('input[name="searchKeyword"]')).toBeFocused();
    await expect(page.locator('.mantine-Modal-title, .mantine-Modal-header').first()).toContainText(/Switch board|切換看板/);
    expect(await sent(page)).toBe(before);
    await expect(page.locator('.ListHint')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    expect(await sent(page)).toBe(before);
    expect(await page.evaluate(() => window.__app.buf.startedEasyReading)).toBe(true);
  });

  test('choosing a board enters it through s<board>', async ({ page }) => {
    const before = (await sent(page)).length;
    await ptt.sendKey(page, 's');
    const input = sheet(page).locator('input[name="searchKeyword"]');
    await input.fill('Gossiping');
    await input.press('Enter');
    await expect(sheet(page)).toHaveCount(0);
    await expect
      .poll(async () => (await sent(page)).slice(before), { timeout: 15000 })
      .toContain('sGossiping');
  });
});
