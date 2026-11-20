// Article information on the desktop (#261): `Q` and 文章資訊 in a row's
// context menu on the easy-reading article list, `Q` and 文章資訊 in the
// context menu of an easy-reading article. Each sends PTT's `Q`
// (bbs.c#view_postinfo) with no repaint, reads the box into the app's dialog
// and dismisses PTT's box with one space (and opens the article again with
// Enter, as PTT left the pager for the list). The code and the address copy,
// an article without a code shows a hint, and after the dialog the next key
// goes to the list or the article. The phone's entrances are in
// mobile_post_info.offline.spec.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, waitArticle, hinted } = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');
const { rightClickElement } = require('../helpers/real_input');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const dialog = (page) => page.getByRole('dialog');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const rawSentSinceMark = (page) => page.evaluate(() => window.__gestureSent.slice(window.__sentMark));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.postInfo.busy)).toBe(true);
const idle = (page) => page.waitForFunction(() => !window.__app.postInfo.busy && window.__app.commandQueue.idle);
const menuItem = (page, label) =>
  page.locator('.DropdownMenu').first().getByRole('menuitem').filter({ hasText: label });

async function stubClipboard(page) {
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } }
    });
  });
}

async function openList(page) {
  await stubClipboard(page);
  await bootNestedShortcutSearch(page, { startAtMain: true });
  // No background reads: the keys sent are the sequence's alone.
  await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await listActive(page);
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => window.__app.commandQueue.idle ? window.__gestureSent.length : -1);
    const quiet = n >= 0 && n === last;
    last = n;
    return quiet;
  }, { intervals: [400] }).toBe(true);
  await recordHints(page);
}

async function openAlpha(page) {
  await openList(page);
  await page.keyboard.press('Enter');
  await waitArticle(page, 'Alpha');
  await page.waitForFunction(() => window.__app.postInfo.articleAvailable());
}

test.describe('article information on the desktop', () => {
  test('Q on the list shows the selected article\'s information; Esc returns with the selection kept', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(103);
    await markSent(page);
    await page.keyboard.press('Shift+Q');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('[data-post-info-field="code"] [data-post-info-value]')).toHaveText('#1gIeu-3C (Test)');
    await expect(dialog(page).locator('[data-post-info-field="url"] [data-post-info-value]'))
      .toHaveText('https://www.ptt.cc/bbs/Test/M.1783270974.A.0CC.html');
    await expect(dialog(page).locator('[data-post-info-field="detail"]')).toHaveText(['這一篇文章值 30 Ptt幣']);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['103\r', 'Q', ' ']);
    // Opened by a key, focus is on the information, not a copy button (no
    // focus ring); Tab reaches the buttons.
    await expect(dialog(page).locator('[data-post-info]')).toBeFocused();
    expect(await dialog(page).locator('[data-post-info-copy]:focus-visible').count()).toBe(0);
    await page.keyboard.press('Tab');
    await expect(dialog(page).locator('[data-post-info-copy="code"]')).toBeFocused();
    // No repaint behind Q: its pressanykey would eat it.
    expect(await rawSentSinceMark(page)).toContain('Q');
    await dialog(page).locator('[data-post-info-copy="code"]').click();
    await dialog(page).locator('[data-post-info-copy="url"]').click();
    await expect.poll(() => page.evaluate(() => window.__copied)).toEqual([
      '#1gIeu-3C (Test)', 'https://www.ptt.cc/bbs/Test/M.1783270974.A.0CC.html'
    ]);
    await markSent(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await sentSinceMark(page)).toEqual([]);
    await listActive(page);
    expect(await selectedNum(page)).toBe(103);
    // The next key goes to the list.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(104);
  });

  test('文章資訊 in a row\'s context menu shows that row\'s information', async ({ page }) => {
    await openList(page);
    expect(await selectedNum(page)).toBe(101);
    await rightClickElement(page, 'span[type="bbsrow"][data-list-title*="Delta topic"]');
    const item = menuItem(page, await text(page, 'postInfo_title'));
    await expect(item).toBeVisible();
    await markSent(page);
    await item.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('[data-post-info]')).toHaveAttribute('data-post-info', '1gIeu-3D');
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['104\r', 'Q', ' ']);
    expect(await selectedNum(page)).toBe(104);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await listActive(page);
  });

  test('Q in an article shows its information and opens the article again', async ({ page }) => {
    await openAlpha(page);
    await markSent(page);
    await page.keyboard.press('Shift+Q');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('[data-post-info-field="code"] [data-post-info-value]')).toHaveText('#1gIeu-3A (Test)');
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['Q', ' ', '\r']);
    expect((await rawSentSinceMark(page))[0]).toBe('Q');
    await expect(dialog(page).locator('[data-post-info]')).toBeFocused();
    expect(await dialog(page).locator('[data-post-info-copy]:focus-visible').count()).toBe(0);
    await waitArticle(page, 'Alpha');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    // The article has its keys again.
    await markSent(page);
    await page.keyboard.press('ArrowLeft');
    await waitList(page, { has: ['Alpha topic'] });
  });

  test('文章資訊 in an article\'s context menu, and an article without a code', async ({ page }) => {
    await openAlpha(page);
    await page.evaluate(() => { window.__shortcutServer.state.open.noAid = true; });
    await rightClickElement(page, '#mainContainer [type="bbsrow"][srow="5"]');
    const item = menuItem(page, await text(page, 'postInfo_title'));
    await expect(item).toBeVisible();
    await markSent(page);
    await item.click();
    await expect.poll(async () => hinted(page, await text(page, 'postInfo_none'))).toBe(true);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['Q', ' ', '\r']);
    await expect(dialog(page)).toHaveCount(0);
    await waitArticle(page, 'Alpha');
  });

});
