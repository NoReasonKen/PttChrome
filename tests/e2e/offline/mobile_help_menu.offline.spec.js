// 說明選單好讀（手機）：同一個控制器，外殼換成 bottom sheet。只在 offline-mobile project 跑
// （Pixel 7 模擬：hasTouch + isMobile）。合成畫面見 helpers/help_menu.js。
// 守 unit 摸不到的：真 CSS 下每項是觸控目標高度、sheet 內容可捲到最後一項、真觸控 tap
// 送出的鍵。
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, loadCassette, replayListCassette } = require('../helpers/replay');
const { startCapture, peekCapture, takeCapture } = require('../helpers/capture');
const { ITEMS, answerHelpKey, drawHelpPage } = require('../helpers/help_menu');
const { installPaintedFrameProbe, scrollIntoViewStable, waitRectStable } = require('../helpers/layout');
const { imeCommit } = require('../helpers/real_input');

const nav = loadCassette('cchat-list-nav');

const HOME = '\x1b[1~';
const PGDN = '\x1b[6~';
const DOWN = '\x1b[B';
const TOUCH_MIN_PX = 44;

const items = (page) => page.locator('[data-sheet="help"] [data-help-item]');

test.describe('說明選單好讀（手機 bottom sheet）', () => {
  test.beforeEach(async ({ page }) => {
    await bootOffline(page, ptt);
    await ptt.applyPrefs(page, { enableEasyReading: true });
    await startCapture(page);
    const { perPage } = await drawHelpPage(page, 1);
    await expect(items(page)).toHaveCount(perPage);
    await expect.poll(() => peekCapture(page)).toBe(PGDN);
    await takeCapture(page);
    await drawHelpPage(page, 2);
    await expect(items(page)).toHaveCount(ITEMS.length);
  });

  test('每項至少 44px 高；tap 最後一項（捲到才看得到）⇒ 送對應的鍵', async ({ page }) => {
    const heights = await items(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(TOUCH_MIN_PX);
    const perPage = (await page.evaluate(() => window.__app.buf.rows)) - 3;
    const idx = ITEMS.length - 1;
    const b = await scrollIntoViewStable(page, `[data-sheet="help"] [data-help-item="${idx}"]`);
    await page.touchscreen.tap(b.left + b.width / 2, b.top + b.height / 2);
    const expected = HOME + PGDN.repeat(Math.floor(idx / perPage)) + DOWN.repeat(idx % perPage) + '\r';
    await expect.poll(() => peekCapture(page)).toBe(expected);
    expect(await takeCapture(page)).toBe(expected);
    await expect(items(page)).toHaveCount(0);
  });

  test('「離開」按鈕 ⇒ 送 q', async ({ page }) => {
    // sheet 剛從第一頁長到全部項目、還在 slide-up：量到的是動畫中的位置，tap 會落空。
    const b = await waitRectStable(page, '[data-sheet="help"] [data-help-close]');
    await page.touchscreen.tap(b.left + b.width / 2, b.top + b.height / 2);
    await expect.poll(() => peekCapture(page)).toBe('q');
    expect(await takeCapture(page)).toBe('q');
    await expect(items(page)).toHaveCount(0);
  });
});

// 入口：手機的卡片／好讀文章畫面會收起底列，原生的 (h)說明 點不到 ⇒ 「更多」裡的「操作說明」。
// 底列帶 (h)說明 的任一畫面（這裡用我的最愛的 footer，pttbbs psb.c 的 vs_footer 版型）。
async function drawFavFooter(page) {
  await page.evaluate(() => {
    const u2b = (str) =>
      [...str]
        .map((ch) => {
          const c = ch.charCodeAt(0);
          return c < 0x80
            ? ch
            : String.fromCharCode(window.lib.u2bArray[2 * c]) +
                String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
        })
        .join('');
    const rows = window.__app.buf.rows;
    window.__app.onData(
      '\x1b[H\x1b[2J\x1b[1;1H\x1b[7m' + u2b('【我的最愛】') + '\x1b[m' +
        '\x1b[' + rows + ';1H\x1b[7m' + u2b(' 我的最愛  (a)增加看板 (d)刪除 (g)新增目錄    (h)說明 ') + '\x1b[m'
    );
  });
  await page.waitForFunction(() => {
    const buf = window.__app.buf;
    return !buf.timerUpdate && !buf._settleTimer && buf.getRowText(buf.rows - 1, 0, buf.cols).includes('(h)');
  });
}

test.describe('說明選單入口（手機「更多」）', () => {
  test('底列有 (h)說明：更多 → 操作說明 ⇒ 送 h；PTT 畫出說明選單 ⇒ sheet 出現', async ({ page }) => {
    await bootOffline(page, ptt);
    await ptt.applyPrefs(page, { enableEasyReading: true });
    await drawFavFooter(page);
    await startCapture(page);
    await page.locator('[data-key="__more"]').tap();
    const help = page.locator('[data-sheet="more"] [data-key="__help"]');
    await expect(help).toBeVisible();
    await help.tap();
    await expect.poll(() => peekCapture(page)).toBe('h');
    await takeCapture(page);
    const { perPage } = await drawHelpPage(page, 1);
    await expect(items(page)).toHaveCount(perPage);
  });
});

// #222: `h` on the easy-reading article list opens the sheet at the keypress,
// as `/` opens the search sheet, before PTT has answered: one quiet line where
// the rows go, at the sheet's full height. Page 1 fills the same sheet in
// place. Every painted frame keeps the list on screen, never PTT's help
// screen, and the sheet's height never changes.
test.describe('說明選單從手機文章列表要求（#222）', () => {
  test.skip(!nav, '缺 cchat-list-nav cassette');

  test('the sheet opens at the keypress and fills in place, at one height, over the list every frame', async ({ page }) => {
    test.setTimeout(60000);
    await bootOffline(page, ptt);
    await replayListCassette(page, nav);
    await page.waitForFunction(() => window.__app.buf.pageState === 2);
    await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 30 });
    await page.waitForFunction(() => {
      const app = window.__app;
      return app.listSession.state === 'active' && (app.buf.listLines || []).length > 30 && app.commandQueue.idle;
    }, null, { timeout: 20000 });
    // The cassette's last page-up went unanswered: teach the list the row the
    // terminal shows the cursor on (as easy-reading-list's help tests do).
    await page.evaluate(() => {
      const app = window.__app;
      const ls = app.listSession;
      const num = Number(/^\D?\s*(\d+)/.exec(app.buf.getRowText(app.buf.cur_y, 0, app.buf.cols))[1]);
      ls._selectedNum = num;
      ls._serverNum = num;
      ls._selectedPinnedKey = null;
      ls._forceRedraw();
    });
    await page.waitForFunction(() => window.__app.commandQueue.idle);
    await installPaintedFrameProbe(page);
    await page.evaluate(() => {
      window.__frames = [];
      const sample = () => {
        const main = document.getElementById('mainContainer');
        const sheet = document.querySelector('[data-sheet="help"]');
        window.__frames.push({
          list: !!main.querySelector('.listBodyView'),
          helpDrawn: main.textContent.includes('操作說明 (Help)'),
          // Laid-out height (the slide's transform does not count).
          sheetH: sheet ? sheet.offsetHeight : null,
          rows: document.querySelectorAll('[data-sheet="help"] [data-help-item]').length,
          phase: window.__app.helpMenu.phase,
        });
      };
      window.__stopFrames = () => window.__paintedFrame.remove(sample);
      window.__paintedFrame.add(sample);
    });
    await answerHelpKey(page, 'h\f');
    await page.locator('#t').focus();
    await imeCommit(page, 'h');
    await expect(page.locator('[data-sheet="help"] [data-help-pending-text]')).toBeVisible();
    expect(await items(page).count()).toBe(0);
    // The sheet has slid in and painted before any of PTT's help screen.
    await waitRectStable(page, '[data-sheet="help"]');
    const { perPage } = await drawHelpPage(page, 1, { caption: '文章列表' });
    await expect(items(page)).toHaveCount(perPage);
    await expect(page.locator('[data-sheet="help"] [data-help-pending-text]')).toHaveCount(0);
    const before = await page.evaluate(() => window.__frames.length);
    await page.waitForFunction((n) => window.__frames.length > n + 8, before);
    const frames = await page.evaluate(() => {
      window.__stopFrames();
      return window.__frames;
    });
    const loading = frames.filter((f) => f.phase === 'loading' && f.sheetH);
    expect(loading.length).toBeGreaterThan(0);
    expect(loading.every((f) => f.rows === 0)).toBe(true);
    expect(frames.some((f) => f.rows > 0)).toBe(true);
    const heights = frames.filter((f) => f.sheetH).map((f) => f.sheetH);
    expect([...new Set(heights)]).toEqual([heights[0]]);
    expect(frames.filter((f) => !f.list || f.helpDrawn)).toEqual([]);
  });
});
