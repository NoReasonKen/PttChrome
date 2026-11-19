// Jumping to an article by its code (AID) on the phone (#253): the More sheet
// offers it on the easy-reading article list, in the same bottom-sheet shell
// as the search sheet. Runs only in the offline-mobile project. The controlled
// PTT board is helpers/article_shortcut_search.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, waitIdle } = require('../helpers/article_shortcut_search');
const { recordHints, recordedHints } = require('../helpers/stack_routes');

const SHEET = '[data-sheet="aidJump"]';
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
  await recordHints(page);
}

const sent = (page) => page.evaluate(() => window.__gestureSent.join(''));
const selected = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const hinted = (page, text) => recordedHints(page).then((hints) => hints.some((h) => h.includes(text)));

async function openSheet(page) {
  await page.locator('[data-key="__more"]').tap();
  await page.locator('[data-key="__aidJump"]').tap();
  await expect(page.locator(SHEET)).toBeVisible();
}

test.describe('手機：用文章代碼跳到文章 (#253)', () => {
  test('More sheet opens the input; confirming selects the article without opening it', async ({ page }) => {
    await bootList(page);
    await openSheet(page);
    expect(await sent(page)).not.toContain('#');
    await page.locator(INPUT).fill('1gIeu-3C');
    await page.locator(INPUT).press('Enter');
    await expect(page.locator(SHEET)).toHaveCount(0);
    await expect.poll(() => sent(page)).toContain('#1gIeu-3C\r');
    await waitIdle(page);
    await expect.poll(() => selected(page)).toBe(103);
    expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('list');
  });

  test('a code that does not exist leaves the list where it was and says so', async ({ page }) => {
    await bootList(page);
    const from = await selected(page);
    await openSheet(page);
    await page.locator(INPUT).fill('1gIeu-9Z');
    await page.locator(INPUT).press('Enter');
    await expect.poll(() => hinted(page, '1gIeu-9Z')).toBe(true);
    await waitIdle(page);
    await expect.poll(() => page.evaluate(() => window.__app.listSession.state)).toBe('active');
    await expect.poll(() => selected(page)).toBe(from);
  });

  test('cancelling the sheet sends nothing', async ({ page }) => {
    await bootList(page);
    const from = await selected(page);
    await openSheet(page);
    await page.locator(INPUT).fill('1gIeu-3C');
    await page.locator(`${SHEET} button`, { hasText: /取消|Cancel/ }).tap();
    await expect(page.locator(SHEET)).toHaveCount(0);
    await waitIdle(page);
    expect(await sent(page)).not.toContain('#');
    expect(await selected(page)).toBe(from);
  });

  test('the entrance is offered on the article list only', async ({ page }) => {
    await bootNestedShortcutSearch(page, { startAtMain: true });
    await ptt.applyPrefs(page, { enableEasyReading: true });
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-panel="more"]')).toBeVisible();
    await expect(page.locator('[data-key="__aidJump"]')).toHaveCount(0);
  });
});
