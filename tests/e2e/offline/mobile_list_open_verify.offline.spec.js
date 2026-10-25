// Opening an article from article-list easy reading opens only the article that
// was tapped (#27). If PTT's entry at that number is a different article (the
// list changed underneath), nothing is opened and the list is refreshed.
const { test, expect } = require('@playwright/test');
const { waitRectStable } = require('../helpers/layout');
const ptt = require('../helpers/ptt');
const { bootOffline, loadCassette, replayListCassette } = require('../helpers/replay');

const CARD = '.listCard[data-list-author="kylin936"] .listCardBody';

async function bootList(page) {
  const nav = loadCassette('cchat-list-nav');
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true, enableEasyReadingList: false, useMouseBrowsing: true, mouseLeftClick: true });
  await replayListCassette(page, nav);
  await page.waitForFunction(() => window.__app.buf.pageState === 2);
  await ptt.applyPrefs(page, { enableEasyReadingList: true, easyReadingListPrefetchCount: 200 });
  await page.waitForFunction(() => window.__app.listSession.state === 'active' &&
    window.__app.commandQueue.idle && window.__app.buf.listLines.length > 50);
  await page.locator(CARD).first().scrollIntoViewIfNeeded();
  await waitRectStable(page, CARD);
}

// When PTT answers the open's number jump, its entry under the cursor shows
// `author` instead of the article the reader tapped.
async function replaceLandedAuthor(page, author) {
  await page.evaluate((author) => {
    const send = window.__stubWSSent;
    window.__stubWSSent = (data) => {
      send(data);
      if (!/^\d+\r/.test(data)) return;
      const buf = window.__app.buf;
      const y = buf.cur_y;
      const col = buf.lines[y].map(c => c.ch).join('').indexOf('kylin936');
      if (col < 0) return;
      window.__app.onData(`\x1b[${y + 1};${col + 1}H${author}\x1b[${y + 1};1H`);
    };
  }, author);
}

test('an entry that still matches the tapped article opens it', async ({ page }) => {
  await bootList(page);
  await page.locator(CARD).first().tap();
  await page.waitForFunction(() => window.__app.buf.pageState === 3);
});

test('a different article at the tapped number is not opened; the list is refreshed with a notice', async ({ page }) => {
  await bootList(page);
  await replaceLandedAuthor(page, 'someone8');
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  await page.locator(CARD).first().tap();
  await expect(page.locator('.ListHint')).toBeVisible();
  await expect(page.locator('.listCard[data-list-author="someone8"]')).toHaveCount(1);
  await page.waitForTimeout(1500); // sleep-ok: 確認之後也沒有送出開文的 Enter，否定式斷言只能等時間
  // Still on the list and usable. (On the recorded older server a number jump
  // leaves PTT's footer empty, so the screen is not classified until redrawn.)
  expect(await page.evaluate(() => window.__app.buf.pageState)).not.toBe(3);
  expect(await page.evaluate(() => window.__app.listSession.state)).toBe('active');
  await expect(page.locator('.listBodyView')).toBeVisible();
  const sent = await page.evaluate((n) => window.__replay.sent.slice(n), sentBefore);
  // The number jump was sent, the Enter that would open the article was not.
  expect(sent.some(d => /^\d+\r/.test(d))).toBe(true);
  expect(sent).not.toContain('\r');
});
