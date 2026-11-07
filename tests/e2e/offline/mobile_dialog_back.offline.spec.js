// Real browser Back traversals through the product's history guard. Only the
// PTT server and the unavailable clipboard capability are controlled boundaries.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, loadCassette, replayListCassette, waitScreenSettled } = require('../helpers/replay');
const { rightClickElement, rightClickPlainText } = require('../helpers/real_input');
const { drawMainMenu } = require('../helpers/main_menu');

const text = (page, key) => page.evaluate(key => window.__i18n(key), key);
const sent = page => page.evaluate(() => window.__dialogSent.join(''));
const collect = page => page.evaluate(() => {
  window.__dialogSent = [];
  window.__stubWSSent = bytes => window.__dialogSent.push(bytes);
});
const titleBlacklist = page => page.evaluate(() =>
  JSON.parse(localStorage.getItem('pttchrome.pref.v1')).values.titleBlacklist,
);
async function back(page) {
  await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
  await page.goBack();
  await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
}

const FOOTER = '  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~23 行  (y)回應(X%)推文(h)說明(←)離開 ';
const ARTICLE = {
  0: '作者  testuser (Reader) 看板 Test',
  1: '標題  [Test] Dialog Back',
  2: '時間  Mon Sep  1 12:00:00 2025',
  4: 'Article text.',
  20: '※ 文章網址: https://www.ptt.cc/bbs/Test/M.1756700000.A.ABC.html',
  23: FOOTER,
};
async function draw(page, rows) {
  await page.evaluate(rows => {
    const encode = text => [...text].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    let data = '\x1b[2J';
    for (const [row, line] of Object.entries(rows)) data += `\x1b[${Number(row) + 1};1H${encode(line)}`;
    window.__app.onData(data);
  }, rows);
  await waitScreenSettled(page, rows);
}

test('title blacklist Back cancels without changing preferences or sending bytes', async ({ page }) => {
  await bootOffline(page, ptt);
  await replayListCassette(page, loadCassette('cchat-list-nav'));
  await page.waitForFunction(() => window.__app.listSession.state === 'active' && window.__app.commandQueue.idle);
  await rightClickElement(page, '#mainContainer .listCardTitle');
  await page.locator('[data-sheet="context"] [data-cmenu="addTitleBlacklist"]').tap();
  const input = page.locator('[name="titleBlacklistKeyword"]');
  await expect(input).toBeVisible();
  await input.fill('Do not save this keyword');
  const before = await titleBlacklist(page);
  await collect(page);
  await back(page);
  await expect(input).toBeHidden();
  expect(await sent(page)).toBe('');
  expect(await titleBlacklist(page)).toEqual(before);
  await expect.poll(() => page.evaluate(() => window.__app._sheetDismissers.length)).toBe(0);
});

test('paste-shortcut alert Back unmounts the dialog and releases its registration', async ({ page }) => {
  await bootOffline(page, ptt);
  await drawMainMenu(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { readText: () => Promise.reject(new Error('Unavailable')) },
  }));
  await rightClickPlainText(page);
  await page.locator('[data-sheet="context"] [data-cmenu="paste"]').tap();
  const dialog = page.getByRole('dialog', { name: await text(page, 'alert_pasteShortcutHeader') });
  await expect(dialog).toBeVisible();
  await collect(page);
  await back(page);
  await expect(dialog).toHaveCount(0);
  expect(await sent(page)).toBe('');
  await expect.poll(() => page.evaluate(() => window.__app.modalShown)).toBe(false);
  expect(await page.evaluate(() => window.__app._sheetDismissers.length)).toBe(0);
});

test('progress consumes Back; explicit cancel and error Back preserve the draft', async ({ page }, testInfo) => {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true, enableEasyReadingList: false });
  await draw(page, ARTICLE);
  await page.evaluate(() => window.__app.easyReading.enterEasyReading());
  await collect(page);
  await page.locator('[data-key="X"]').tap();
  const progress = page.getByTestId('longPushProgressStatus');
  await expect(progress).toBeVisible();
  await expect.poll(() => sent(page)).toBe('X');
  // Complete the real preflight through server frames, then type a draft.
  const typeMenu = '您覺得這篇文章 1.值得推薦 2.給它噓聲 3.只加→註解 [1]? ';
  const prompt = '推 testuser: ';
  await draw(page, { 23: typeMenu });
  await draw(page, { 23: prompt });
  await draw(page, { 23: FOOTER });
  await draw(page, ARTICLE);
  const draft = 'First unsent comment\nSecond unsent comment';
  await page.locator('[name="longPushText"]').fill(draft);
  await collect(page);
  await page.getByRole('button', { name: await text(page, 'longPushModal_confirm'), exact: true }).tap();
  await expect(progress).toBeVisible();
  await expect.poll(() => sent(page)).toBe('X');
  for (let i = 0; i < 2; ++i) {
    await back(page);
    await expect(progress).toBeVisible();
    expect(await sent(page)).toBe('X');
    expect(await page.evaluate(() => window.__app.longPush.active)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('blocking-progress.png') });
  // Cancellation remains an explicit button action, not a side effect of Back.
  await draw(page, { 23: typeMenu });
  await draw(page, { 23: prompt });
  const dialog = page.getByRole('dialog', { name: await text(page, 'longPushProgress_title') });
  await dialog.getByRole('button', { name: await text(page, 'longPushProgress_cancel'), exact: true }).tap();
  await expect.poll(() => sent(page)).toMatch(/\x03$/);
  // draw clears the entire terminal. Restore the article, not just its footer:
  // a headerless reply starts an unrelated identity lookup and timeout probe.
  await draw(page, ARTICLE);
  await expect(progress).toHaveCount(0);
  const error = page.getByTestId('longPushErrorMessage');
  await expect(error).toBeVisible();
  await expect(page.locator('[name="longPushRest"]')).toHaveValue(draft);
  await page.screenshot({ path: testInfo.outputPath('unsent-draft.png') });
  await collect(page);
  await back(page);
  await expect(error).toHaveCount(0);
  expect(await sent(page)).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('pttchrome.longPush.draft.v1'))).toBe(draft);
  await expect.poll(() => page.evaluate(() => window.__app.modalShown)).toBe(false);
  expect(await page.evaluate(() => window.__app._sheetDismissers.length)).toBe(0);
});
