// Jumping to an article by its code (AID) from an easy-reading article (#281).
// `#` and a pasted code (or a PTT article link) use the same input and the same
// serialized AID navigation as the article list (#253). The pager does not take
// `#`, so the run leaves the article for its board's list first (`s<board>`, as
// the board switch does, #262), then `#<aid>⏎` and `⏎` open the article found
// in easy reading. A code the board does not have brings the reader back to the
// article they were reading. A mail refuses both. The controlled PTT board is
// helpers/article_shortcut_search.js. Mobile: mobile_article_aid_jump.offline.spec.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, waitArticle, waitIdle, visibleText } = require('../helpers/article_shortcut_search');
const { recordHints, recordedHints } = require('../helpers/stack_routes');
const { bootMailbox, mailListActive } = require('../helpers/mail_box');

const DIALOG = '[data-aid-jump]';
const INPUT = 'input[name="aidCode"]';
const UNSUPPORTED_KEY = '好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）';
const UNSUPPORTED_PASTE = '好讀模式目前不支援在文章貼上文字';

// Alpha, opened from its board's easy-reading list, as a reader does.
async function bootArticle(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true });
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    server.state.cursor = 0;
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await ptt.sendKey(page, 'Enter');
  await waitArticle(page, 'Alpha');
  await page.waitForFunction(() => window.__app.buf.startedEasyReading && window.__app.listSession.state === 'suspended');
  await recordHints(page);
}

const sent = (page) => page.evaluate(() => window.__gestureSent.join(''));
const hinted = (page, text) => recordedHints(page).then((hints) => hints.some((h) => h.includes(text)));
const opened = (page) => page.evaluate(() => window.__shortcutServer.state.open.body);

test.describe('jump to an article by its code from an easy-reading article (#281)', () => {
  test('# opens the input and sends nothing; confirming opens the article found in easy reading', async ({ page }) => {
    await bootArticle(page);
    const before = (await sent(page)).length;
    await ptt.sendKey(page, '#');
    await expect(page.locator(DIALOG)).toBeVisible();
    expect((await sent(page)).length).toBe(before);
    await expect(page.locator('.ListHint[data-level="error"]')).toHaveCount(0);

    await page.locator(INPUT).fill('1gIeu-3D');
    await page.locator(INPUT).press('Enter');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    // The article is left for its list first: the pager takes no `#`.
    await expect.poll(async () => (await sent(page)).slice(before)).toMatch(/sTest\r[^]*#1gIeu-3D\r[^]*\r/);
    await waitArticle(page, 'Delta');
    expect(await opened(page)).toBe('Delta');
    expect(await page.evaluate(() => window.__app.buf.startedEasyReading)).toBe(true);
  });

  test('a full article link typed into the input opens the article found in easy reading', async ({ page }) => {
    await bootArticle(page);
    const link = 'https://www.ptt.cc/bbs/Test/M.1783270974.A.0CD.html';
    await ptt.sendKey(page, '#');
    await expect(page.locator(DIALOG)).toBeVisible();
    // Typed key by key, as a reader does: the input takes the whole link.
    await page.locator(INPUT).pressSequentially(link);
    expect(await page.locator(INPUT).inputValue()).toBe(link);
    await page.locator(INPUT).press('Enter');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect.poll(() => sent(page)).toMatch(/sTest\r[^]*#1gIeu-3D\r[^]*\r/);
    await waitArticle(page, 'Delta');
    expect(await opened(page)).toBe('Delta');
    expect(await page.evaluate(() => window.__app.buf.startedEasyReading)).toBe(true);
  });

  for (const pasted of ['#1gIeu-3D', 'https://www.ptt.cc/bbs/Test/M.1783270974.A.0CD.html']) {
    test(`pasting "${pasted}" over the article runs the same jump`, async ({ page }) => {
      await bootArticle(page);
      await page.evaluate((text) => window.__app.onPasteDone(text), pasted);
      await expect.poll(() => sent(page)).toContain('#1gIeu-3D\r');
      await waitArticle(page, 'Delta');
      expect(await hinted(page, UNSUPPORTED_PASTE)).toBe(false);
    });
  }

  test('other pasted text is still refused with the hint and sends nothing', async ({ page }) => {
    await bootArticle(page);
    const before = (await sent(page)).length;
    await page.evaluate(() => window.__app.onPasteDone('hello world'));
    await expect.poll(() => hinted(page, UNSUPPORTED_PASTE)).toBe(true);
    expect((await sent(page)).length).toBe(before);
    expect(await visibleText(page)).toContain('Alpha line 04:');
  });

  test('Esc closes the input, sends nothing and stays on the article', async ({ page }) => {
    await bootArticle(page);
    const before = (await sent(page)).length;
    await ptt.sendKey(page, '#');
    await page.locator(INPUT).fill('1gIeu-3D');
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await waitIdle(page);
    expect((await sent(page)).length).toBe(before);
    expect(await visibleText(page)).toContain('Alpha line 04:');
    expect(await page.evaluate(() => window.__app.buf.startedEasyReading)).toBe(true);
  });

  test('a code the board does not have says so and leaves the reader on the article', async ({ page }) => {
    await bootArticle(page);
    await ptt.sendKey(page, '#');
    await page.locator(INPUT).fill('1gIeu-9Z');
    await page.locator(INPUT).press('Enter');
    await expect.poll(() => hinted(page, '1gIeu-9Z')).toBe(true);
    await waitArticle(page, 'Alpha');
    expect(await opened(page)).toBe('Alpha');
    expect(await page.evaluate(() => window.__app.buf.startedEasyReading)).toBe(true);
    expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(false);
  });

  test('over a mail # and a pasted code are refused with the hint and nothing is sent', async ({ page }) => {
    await bootMailbox(page);
    await page.locator('[data-home-mail]').click();
    await mailListActive(page);
    await ptt.sendKey(page, 'Enter');
    await page.waitForFunction(() => {
      const app = window.__app;
      return app.buf.pageState === 3 && app.view.useEasyReadingMode && app.commandQueue.idle &&
        !app.buf.timerUpdate && !app.buf._settleTimer;
    });
    const before = await page.evaluate(() => window.__mailSent.length);
    await ptt.sendKey(page, '#');
    await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await page.evaluate(() => window.__app.onPasteDone('#1gIeu-3D'));
    await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_PASTE);
    expect(await page.evaluate(() => window.__mailSent.length)).toBe(before);
  });
});
