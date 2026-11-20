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

  // The board's entry screen: PTT shows it on a session's first entry to a board.
  // A multi-line note in pmore's auto-exit mode draws no footer, so the last row
  // stays blank and the cursor parks there. PTT answers the board jump and every
  // plain probe with the same screen until a key dismisses it.
  test('the entry screen of a board that has notes is dismissed, not taken for a miss', async ({ page }) => {
    await page.evaluate(() => {
      const rows = window.__app.buf.rows;
      let screen = '\x1b[0m\x1b[2J';
      for (let r = 2; r <= 10; ++r) screen += `\x1b[${r};1H` + `  note line ${r} of the board`;
      screen += `\x1b[${rows};1H`;
      window.__entryScreen = screen;
      let seen = window.__replay.sent.length;
      window.__entryTimer = setInterval(() => {
        const now = window.__replay.sent;
        const fresh = now.slice(seen).join('');
        seen = now.length;
        if (/sSteam/.test(fresh) || fresh === '\f') window.__app.onData(screen);
      }, 50);
    });
    await ptt.sendKey(page, 's');
    const input = sheet(page).locator('input[name="searchKeyword"]');
    await input.fill('Steam');
    await input.press('Enter');
    // The entry screen is dismissed with one left arrow before the run goes on.
    await expect
      .poll(() => page.evaluate(() => window.__replay.sent.some((k) => k.startsWith('\x1b[D'))), { timeout: 15000 })
      .toBe(true);
    await expect(page.locator('.ListHint[data-level="error"]')).toHaveCount(0);
  });
});

