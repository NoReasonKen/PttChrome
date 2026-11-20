// Jumping to an article by its code (AID) from the easy-reading article list
// (#253). `#` and a pasted code open PttChrome's own input / run the jump; the
// jump itself is the serialized AID navigation, so PTT's `#` prompt and its
// result screens never reach the grid. The controlled PTT board is
// helpers/article_shortcut_search.js (its `#<aid>⏎` selects the row, or shows
// the not-found box). Mobile: mobile_aid_jump.offline.spec.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, waitIdle, waitListAtRest } = require('../helpers/article_shortcut_search');
const { recordHints, recordedHints } = require('../helpers/stack_routes');

const DIALOG = '[data-aid-jump]';
const INPUT = 'input[name="aidCode"]';

async function bootList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true });
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await expect.poll(() => page.evaluate(() => window.__app.listSession.state)).toBe('active');
  // Measure from a list at rest: its own reads must not count against a test's
  // sent-byte baseline.
  await waitListAtRest(page);
  await recordHints(page);
}

const sent = (page) => page.evaluate(() => window.__gestureSent.join(''));
const selected = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const hinted = (page, text) => recordedHints(page).then((hints) => hints.some((h) => h.includes(text)));

test.describe('jump to an article by its code from the easy-reading list (#253)', () => {
  test('# opens the input; confirming selects the article on the current board without opening it', async ({ page }) => {
    await bootList(page);
    const from = await selected(page);
    await ptt.sendKey(page, '#');
    await expect(page.locator(DIALOG)).toBeVisible();
    // Opening the input sends nothing: PTT's prompt is not on the wire yet.
    expect(await sent(page)).not.toContain('#');

    await page.locator(INPUT).fill('1gIeu-3C');
    await page.locator(INPUT).press('Enter');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect.poll(() => sent(page)).toContain('#1gIeu-3C\r');
    await waitIdle(page);
    await expect.poll(() => selected(page)).toBe(103);
    expect(from).not.toBe(103);
    // Selected, not opened.
    expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('list');
    expect(await page.evaluate(() => window.__app.listSession.state)).toBe('active');
  });

  test('a code that does not exist leaves the list where it was and says so; no guessed keys follow', async ({ page }) => {
    await bootList(page);
    const from = await selected(page);
    await ptt.sendKey(page, '#');
    await page.locator(INPUT).fill('1gIeu-9Z');
    await page.locator(INPUT).press('Enter');
    await expect.poll(() => hinted(page, '1gIeu-9Z')).toBe(true);
    await waitIdle(page);
    await expect.poll(() => page.evaluate(() => window.__app.listSession.state)).toBe('active');
    await expect.poll(() => selected(page)).toBe(from);
    // One `#` step went out; PTT's box was closed and no article was opened.
    expect((await sent(page)).split('#').length - 1).toBe(1);
    expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('list');
  });

  test('the input stops at the longest article code', async ({ page }) => {
    await bootList(page);
    await ptt.sendKey(page, '#');
    await page.locator(INPUT).fill('#1gIeu-3C (Test)');
    await page.locator(INPUT).pressSequentially('x'.repeat(80));
    const typed = await page.locator(INPUT).inputValue();
    expect(typed.length).toBe(await page.evaluate(() => Number(document.querySelector('input[name="aidCode"]').maxLength)));
    expect(typed.length).toBeLessThanOrEqual(32);
  });

  test('cancelling the input leaves the list as it was and sends nothing', async ({ page }) => {
    await bootList(page);
    const from = await selected(page);
    await ptt.sendKey(page, '#');
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.locator(INPUT).fill('1gIeu-3C');
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await waitIdle(page);
    expect(await sent(page)).not.toContain('#');
    expect(await selected(page)).toBe(from);
  });

  test('a code that is not an article code stays in the input and sends nothing', async ({ page }) => {
    await bootList(page);
    await ptt.sendKey(page, '#');
    await page.locator(INPUT).fill('not a code');
    await page.locator(INPUT).press('Enter');
    await expect(page.locator(DIALOG)).toBeVisible();
    expect(await sent(page)).not.toContain('#');
  });

  for (const pasted of ['#1gIeu-3D', '1gIeu-3D', '#1gIeu-3D (Test)', 'Test #1gIeu-3D']) {
    test(`pasting "${pasted}" over the list selects the article`, async ({ page }) => {
      await bootList(page);
      await page.evaluate((text) => window.__app.onPasteDone(text), pasted);
      await expect.poll(() => sent(page)).toContain('#1gIeu-3D\r');
      await waitIdle(page);
      await expect.poll(() => selected(page)).toBe(104);
      expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('list');
    });
  }

  test('other pasted text is still refused with the hint', async ({ page }) => {
    await bootList(page);
    const before = (await sent(page)).length;
    const from = await selected(page);
    await page.evaluate(() => window.__app.onPasteDone('hello world'));
    await expect.poll(() => hinted(page, '好讀模式目前不支援在列表貼上文字')).toBe(true);
    expect((await sent(page)).length).toBe(before);
    expect(await selected(page)).toBe(from);
  });
});
