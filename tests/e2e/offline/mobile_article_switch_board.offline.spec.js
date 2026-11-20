// Switch board from an easy-reading article on the phone (#262): the article's
// More sheet has the entrance, Cancel sends nothing, and a mail refuses `s`
// with the hint without sending anything (RMAIL takes the letters as shortcuts).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootGestureArticle, gestureSent } = require('../helpers/article_gestures');
const { drawMainMenu } = require('../helpers/main_menu');
const { drawArticleList } = require('../helpers/home_screens');
const { bootOffline, waitScreenSettled } = require('../helpers/replay');
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

// PTT's own screens never show while the board is switched: the article stays on
// screen (held) until the board's list is presented, whether the board answers
// with its entry screen first (a footerless note, or one ending in pressanykey)
// or lands on its list at once. The native grid guard (installed by the replay
// helper) fails on offline-mobile; the hits are asserted too.
// An article opened from its board's list, as a reader does: the list session
// waits suspended behind it, which a bare article screen does not give.
async function feedArticleScreen(page) {
  await page.evaluate(() => {
    const big5 = (str) => {
      let out = '';
      for (const ch of str) {
        const c = ch.charCodeAt(0);
        out += c < 0x80 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c]) + String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
      }
      return out;
    };
    const rows = {
      1: '作者  test (Reader) 看板 Test',
      2: '標題  [Test] Switching board',
      3: '時間  Mon Sep  1 12:00:00 2025',
      5: 'Article text.',
      20: '※ 文章網址: https://www.ptt.cc/bbs/Test/M.1795087264.A.B38.html',
      24: '  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~23 行  (y)回應(X%)推文(h)說明(←)離開 ',
    };
    let screen = '\x1b[H\x1b[2J';
    for (const r of Object.keys(rows)) screen += `\x1b[${r};1H` + big5(rows[r]);
    window.__app.onData(screen);
  });
}
async function bootListArticle(page) {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true, useMouseBrowsing: true, mouseLeftClick: true });
  await drawArticleList(page, 'Test', [[100, ' '], [101, ' ']]);
  await ptt.sendKey(page, 'Enter');
  await feedArticleScreen(page);
  await page.evaluate(() => {
    window.__stubWSSent = (bytes) => window.__gestureSent.push(bytes);
    window.__gestureSent = [];
  });
  await waitScreenSettled(page, { 23: '瀏覽' });
  await page.waitForFunction(() => window.__app.buf.startedEasyReading && window.__app.listSession.state === 'suspended');
}
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const feedRaw = (page, data) => page.evaluate((d) => window.__app.onData(d), data);
const entryScreen = (page, pressAnyKey) => page.evaluate((press) => {
  const rows = window.__app.buf.rows;
  let screen = '\x1b[0m\x1b[2J';
  for (let r = 2; r <= 10; ++r) screen += `\x1b[${r};1H  note line ${r} of the board`;
  // pressanykey draws its bar on the last row (vtuikit.c#vshowmsg), in Big5.
  if (press) {
    let bar = '';
    for (const ch of '請按任意鍵繼續') {
      const c = ch.charCodeAt(0);
      bar += String.fromCharCode(window.lib.u2bArray[2 * c]) + String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
    }
    screen += `\x1b[${rows};1H\x1b[44;37m  ${bar}  \x1b[0m`;
  }
  return screen + `\x1b[${rows};1H`;
}, pressAnyKey);
const sentHas = (page, text) => expect.poll(async () => (await gestureSent(page)).includes(text), { timeout: 15000 }).toBe(true);

for (const variant of ['footerless entry screen', 'pressanykey entry screen', 'no entry screen']) {
  test(`switching to a board with ${variant === 'no entry screen' ? 'no entry screen' : 'a ' + variant} never shows PTT's grid`, async ({ page }) => {
    await bootListArticle(page);
    await page.evaluate(() => { window.__nativeGridGuard.loggedIn = true; window.__nativeGridGuard.reset(); });
    await openMore(page);
    await page.locator('[data-key="__switchBoard"]').tap();
    const input = sheet(page).locator('input[name="searchKeyword"]');
    await input.fill('Steam');
    await input.press('Enter');
    await sentHas(page, 'sSteam');
    if (variant !== 'no entry screen') {
      await feedRaw(page, await entryScreen(page, variant.startsWith('pressanykey')));
      await sentHas(page, '\x1b[D');
    }
    await drawArticleList(page, 'Steam', [[1, ' '], [2, ' ']]);
    // The board's list layer is up (easy reading presents it).
    await expect.poll(() => page.evaluate(() => window.__app.listSession?.state), { timeout: 10000 }).toBe('active');
    expect(await guardHits(page)).toEqual([]);
  });
}

// A jump that misses on a screen PTT shows and nothing recognises must not leave
// the app stuck: the article stays covered with the error while the app brings
// PTT back to it (escape to the main menu, then the board and AID), and then it
// works as before. No native screen shows at any point.
async function serve(page, script) {
  let seen = 0;
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      let sent;
      try { sent = await page.evaluate(() => window.__gestureSent.slice()); } catch { return; }
      const fresh = sent.slice(seen).join('');
      seen = sent.length;
      for (const step of script) if (step.when.test(fresh)) await step.then();
      // sleep-ok: the poll interval of the scripted server
      await page.waitForTimeout(40);
    }
  })();
  return async () => { stop = true; await loop; };
}

test('a jump that misses on an unreadable screen is recovered: the article comes back covered, no grid', async ({ page }) => {
  await bootListArticle(page);
  await page.evaluate(() => { window.__nativeGridGuard.loggedIn = true; window.__nativeGridGuard.reset(); });
  const stop = await serve(page, [
    { when: /sSteam/, then: () => feedRaw(page, '\x1b[0m\x1b[2J\x1b[6;1H  something nothing recognises') },
    { when: /\x1b\[D/, then: () => drawMainMenu(page) },
    { when: /sTest/, then: () => drawArticleList(page, 'Test', [[100, ' '], [101, ' ']]) },
    { when: /#/, then: () => drawArticleList(page, 'Test', [[100, ' '], [101, ' ']]) },
    { when: /^\r|\r$/, then: () => feedArticleScreen(page) },
  ]);
  await openMore(page);
  await page.locator('[data-key="__switchBoard"]').tap();
  const input = sheet(page).locator('input[name="searchKeyword"]');
  await input.fill('Steam');
  await input.press('Enter');
  await expect(page.locator('.ListHint[data-level="error"]')).toBeVisible({ timeout: 20000 });
  // PTT is brought back to the article under the cover; the app is usable again.
  await expect.poll(() => page.evaluate(() => window.__app.articleHold.held), { timeout: 30000 }).toBe(false);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(3);
  expect(await page.evaluate(() => window.__app.buf.startedEasyReading)).toBe(true);
  expect(await guardHits(page)).toEqual([]);
  await stop();
});
