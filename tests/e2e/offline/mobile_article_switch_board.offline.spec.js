// Switch board from an easy-reading article on the phone (#262): the article's
// More sheet has the entrance, Cancel sends nothing, and a mail refuses `s`
// with the hint without sending anything (RMAIL takes the letters as shortcuts).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootGestureArticle, gestureSent } = require('../helpers/article_gestures');
const { bootMailbox, mailListActive, mailSurface } = require('../helpers/mail_box');

const UNSUPPORTED_KEY = '好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）';
const sheet = (page) => page.locator('[data-search-modal]');
const openMore = async (page) => {
  await page.locator('#mobileToolbar [data-key="__more"]').tap();
  await expect(page.locator('[data-key="__switchBoard"]')).toBeVisible();
};

test('the More sheet of an article switches board; Cancel sends nothing', async ({ page }) => {
  await bootGestureArticle(page);
  await openMore(page);
  await page.locator('[data-key="__switchBoard"]').tap();
  await expect(sheet(page)).toBeVisible();
  expect(await gestureSent(page)).toBe('');
  await sheet(page).getByRole('button', { name: /Cancel|取消/  }).tap();
  await expect(sheet(page)).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
  expect(await page.evaluate(() => window.__app.buf.startedEasyReading)).toBe(true);
});

test('choosing a board from the More sheet enters it through s<board>', async ({ page }) => {
  await bootGestureArticle(page);
  await openMore(page);
  await page.locator('[data-key="__switchBoard"]').tap();
  const input = sheet(page).locator('input[name="searchKeyword"]');
  await input.fill('Gossiping');
  await input.press('Enter');
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => gestureSent(page), { timeout: 15000 }).toContain('sGossiping');
});

test('over a mail s is refused with the hint and nothing is sent, and More has no entrance', async ({ page }) => {
  await bootMailbox(page);
  await page.locator('[data-home-mail]').tap();
  await mailListActive(page);
  await ptt.sendKey(page, 'Enter');
  await page.waitForFunction(() => {
    const app = window.__app;
    return app.buf.pageState === 3 && app.view.useEasyReadingMode && app.commandQueue.idle &&
      !app.buf.timerUpdate && !app.buf._settleTimer;
  });
  const before = await page.evaluate(() => window.__mailSent.length);
  await ptt.sendKey(page, 's');
  await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
  await expect(page.locator('.ListHint')).toHaveAttribute('data-level', 'error');
  await expect(sheet(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__mailSent.length)).toBe(before);
  expect(await mailSurface(page)).toBe('mail');
  await page.locator('#mobileToolbar [data-key="__more"]').tap();
  await expect(page.locator('[data-key="__select"]')).toBeVisible();
  await expect(page.locator('[data-key="__switchBoard"]')).toHaveCount(0);
});
