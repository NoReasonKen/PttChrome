// 手機的重新整理（docs/screen-refresh.md）：工具列「重整」「到底」鈕、下拉重整。
// 只在 `offline-mobile` project 跑（Pixel 7 模擬，hasTouch）。下拉走 CDP 觸控
// （helpers/real_input.touchDrag）：瀏覽器自己產生 touch 事件與捲動／overscroll 處理。
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, waitScreenSettled } = require('../helpers/replay');
const { touchDrag } = require('../helpers/real_input');
const { waitRectStable, installPaintedFrameProbe } = require('../helpers/layout');
const { revealArticleDrawer } = require('../helpers/article_gestures');
const { bootThreadBoard, listActive } = require('../helpers/thread_jump');

const byKey = (page, k) => page.locator(`[data-key="${k}"]`);
async function collectSent(page) {
  await page.evaluate(() => {
    window.__sent = [];
    window.__stubWSSent = (s) => window.__sent.push(s);
  });
}
const sentText = (page) => page.evaluate(() => (window.__sent || []).join(''));

// PTT's own list: the tests that draw it turn easy reading off, which would
// otherwise take the list over and refresh it without PTT's `s`.
async function drawArticleList(page) {
  await page.evaluate(() => {
    const u2b = (str) => {
      let out = '';
      for (const ch of str) {
        const c = ch.charCodeAt(0);
        if (c < 0x80) {
          out += ch;
          continue;
        }
        out += String.fromCharCode(window.lib.u2bArray[2 * c]) + String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
      }
      return out;
    };
    const REV = '\x1b[7m';
    const OFF = '\x1b[0m';
    let d = '\x1b[2J';
    d += '\x1b[1;1H' + REV + u2b('【板主：test】看板《Test》'.padEnd(80)) + OFF;
    d += '\x1b[2;1H' + u2b('[←]離開 [→]閱讀 [^P]發表文章 [b]備忘錄');
    d += '\x1b[3;1H' + REV + u2b('  編號    日 期 作  者       文  章  標  題'.padEnd(70)) + OFF;
    for (let i = 0; i < 3; i++)
      d += '\x1b[' + (4 + i) + ';1H' + u2b(String(1233 + i).padStart(7) + '     9/01 testuser     □[閒聊] 測試' + i);
    d += '\x1b[24;1H' + u2b(' 文章選讀  (y)回應(X)推文(^X)轉錄 ');
    d += '\x1b[4;1H';
    window.__app.onData(d);
  });
  await waitScreenSettled(page, { 2: '編號', 23: '文章選讀' });
}

test.describe('手機重新整理（離線重放）', () => {
  test('文章列表：工具列有重整與到底；重整送 s、到底送 End', async ({ page }) => {
    await bootOffline(page, ptt);
    await ptt.applyPrefs(page, { enableEasyReading: false, refreshMinIntervalSec: 0 });
    await drawArticleList(page);
    await expect(byKey(page, '__refresh')).toBeVisible();
    await expect(byKey(page, '__end')).toBeVisible();
    await collectSent(page);
    await byKey(page, '__end').tap();
    await expect.poll(() => sentText(page)).toContain('\x1b[4~');
    await collectSent(page);
    await byKey(page, '__refresh').tap();
    await expect.poll(() => sentText(page)).toContain('s');
  });

  test('冷卻：按下重整後按鈕反灰並倒數，格位不變', async ({ page }) => {
    await bootOffline(page, ptt);
    await ptt.applyPrefs(page, { enableEasyReading: false, refreshMinIntervalSec: 60 });
    await drawArticleList(page);
    const slot = (k) =>
      page.evaluate((key) => {
        const bar = document.querySelector('.mobileToolbarBar');
        return [...bar.children].indexOf(bar.querySelector(`[data-key="${key}"]`));
      }, k);
    const before = await slot('__refresh');
    await byKey(page, '__refresh').tap();
    await expect(byKey(page, '__refresh')).toBeDisabled();
    // 單位隨語系（模擬裝置是 en ⇒「60s」；zh ⇒「60 秒」）。
    await expect(byKey(page, '__refresh')).toContainText(/^\d+\s?(s|秒)$/);
    // 倒數真的在走（60 秒的冷卻，過一秒多數字必變小）。
    const first = Number((await byKey(page, '__refresh').textContent()).match(/\d+/)[0]);
    await expect
      .poll(async () => Number((await byKey(page, '__refresh').textContent()).match(/\d+/)[0]), { timeout: 5000 })
      .toBeLessThan(first);
    expect(await slot('__refresh')).toBe(before);
  });

  test('下拉重整：在終端機上往下拉過門檻放手 ⇒ 送 s；拉不夠 ⇒ 不送', async ({ page }) => {
    await bootOffline(page, ptt);
    await ptt.applyPrefs(page, { enableEasyReading: false, refreshMinIntervalSec: 0 });
    await drawArticleList(page);
    const r = await waitRectStable(page, '#mainContainer');
    const x = r.left + r.width / 2;
    const y = r.top + 40;

    await page.evaluate(() => (window.__notReloaded = true));
    await collectSent(page);
    // 60px × 阻尼 0.5 ＝ 30px，不到門檻 64px。
    await touchDrag(page, { x, y }, { x, y: y + 60 });
    expect(await sentText(page)).not.toContain('s');
    await expect(page.locator('.pullRefreshIndicator.visible')).toHaveCount(0);

    await touchDrag(page, { x, y }, { x, y: y + 260 });
    await expect.poll(() => sentText(page)).toContain('s');
    // 放手後指示器收起。
    await expect(page.locator('.pullRefreshIndicator.visible')).toHaveCount(0);
    // 原生 pull-to-refresh 沒有跑（沒有整頁重載）。
    expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
  });
});

// A refresh keeps the reader's viewport (#279). Scrolling an easy-reading list
// does not move PTT's cursor, and `s<this board>⏎` keeps PTT's cursor, so the
// refresh used to land on PTT's page around the selection. A selection more
// than a page below the view's first row moves to that row, where PTT's cursor
// is parked for the refresh. The board is the controlled PTT of
// helpers/thread_jump.js: 300 articles, the selection on the newest, #300.
const VIEW = '.main:not([data-stack-layer]) .listBodyView';

// The number of the card at the top edge of the list, whether the top of
// the list is known, and where card #1 sits below the list's top edge.
const listView = (page) =>
  page.evaluate((sel) => {
    const app = window.__app;
    const view = document.querySelector(sel);
    if (!view) return { top: null };
    const edge = view.getBoundingClientRect().top;
    const cards = [...view.querySelectorAll('.listCard')];
    const numOf = (card) => Number(card.querySelector('.listCardNum')?.textContent.trim()) || null;
    const top = cards.find((card) => card.getBoundingClientRect().bottom > edge + 1);
    const first = cards.find((card) => numOf(card) === 1);
    return {
      top: top ? numOf(top) : null,
      gap: first ? Math.round(first.getBoundingClientRect().top - edge) : null,
      edgeUp: app.listSession._edgeUp,
      selected: app.listSession._selectedNum,
      idle: app.commandQueue.idle,
      restoring: !!app.listSession._pendingViewport,
    };
  }, VIEW);

async function bootRefreshBoard(page) {
  await bootThreadBoard(page, { open: 300, size: 300, fromList: true, stayOnList: true });
  await ptt.applyPrefs(page, { refreshMinIntervalSec: 0 });
  await expect.poll(async () => (await listView(page)).selected).toBe(300);
}

// Scroll the list to its first row, reading the rows above in as the reader's
// scrolling does, until card #1 is at the top edge and the top is known.
async function scrollToFirstRow(page) {
  for (let i = 0; i < 80; i++) {
    const s = await listView(page);
    if (s.top === 1 && s.gap === 0 && s.edgeUp && s.idle) return;
    await page.locator(VIEW).evaluate((el) => {
      el.scrollTop = 0;
    });
    // sleep-ok: the scroll event asks for the rows above before the queue is checked
    await page.waitForTimeout(150);
    await page.waitForFunction(() => window.__app.commandQueue.idle);
  }
  expect(await listView(page)).toMatchObject({ top: 1, gap: 0, edgeUp: true });
}

// Refresh by `run`, and expect card `top` at the top edge once the list is
// back in easy reading. Returns every painted frame's top card from the
// refresh on (helpers/layout.js installPaintedFrameProbe: only frames that
// reach the eye).
async function refreshKeepsTop(page, run, top) {
  await installPaintedFrameProbe(page);
  await page.evaluate((sel) => {
    window.__topCards = [];
    const sample = () => {
      const view = document.querySelector(sel);
      if (!view) return;
      const edge = view.getBoundingClientRect().top;
      const card = [...view.querySelectorAll('.listCard')].find((c) => c.getBoundingClientRect().bottom > edge + 1);
      const num = card && Number(card.querySelector('.listCardNum')?.textContent.trim());
      if (num) window.__topCards.push(num);
    };
    window.__stopTopCards = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  }, VIEW);
  await run();
  await expect.poll(() => page.evaluate(() => (window.__threadSent || []).join(''))).toContain('Test\r');
  await page.waitForFunction(() => window.__app.listSession.state === 'active' && window.__app.commandQueue.idle);
  await expect.poll(async () => (await listView(page)).top).toBe(top);
  await expect.poll(async () => (await listView(page)).restoring).toBe(false);
  return page.evaluate(() => {
    window.__stopTopCards();
    return window.__topCards;
  });
}

test.describe('refresh keeps the reader\'s viewport (#279)', () => {
  test('pull to refresh at #1, the selection far below: #1 stays at the top and is selected', async ({ page }) => {
    await bootRefreshBoard(page);
    await scrollToFirstRow(page);
    await page.evaluate(() => (window.__threadSent = []));
    const r = await waitRectStable(page, VIEW);
    const tops = await refreshKeepsTop(
      page,
      () => touchDrag(page, { x: r.left + r.width / 2, y: r.top + 40 }, { x: r.left + r.width / 2, y: r.top + 300 }),
      1
    );
    // Never PTT's page around the selection (#281–#300), not even for a frame.
    expect(tops.length).toBeGreaterThan(0);
    expect(tops.every((n) => n === 1)).toBe(true);
    // The selection is the first row, where PTT's cursor now stands.
    expect(await listView(page)).toMatchObject({ top: 1, gap: 0, selected: 1 });
  });

  test('the toolbar refresh from the middle of the list keeps the same first visible row and selects it', async ({ page }) => {
    await bootRefreshBoard(page);
    // Read the list up past #150, then put card #150 at the top edge.
    await expect
      .poll(async () => {
        await page.locator(VIEW).evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.waitForFunction(() => window.__app.commandQueue.idle);
        return page.evaluate(() => (window.__app.buf.listLineNums || []).find((n) => n != null));
      }, { timeout: 20000 })
      .toBeLessThan(140);
    await page.locator(VIEW).evaluate((el) => {
      const card = [...el.querySelectorAll('.listCard')].find((c) => c.querySelector('.listCardNum')?.textContent.trim() === '150');
      el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    await expect.poll(async () => (await listView(page)).top).toBe(150);
    await page.waitForFunction(() => window.__app.commandQueue.idle);
    const before = await listView(page);
    await page.evaluate(() => (window.__threadSent = []));
    const tops = await refreshKeepsTop(page, () => byKey(page, '__refresh').tap(), before.top);
    expect(tops.every((n) => n === before.top)).toBe(true);
    expect(await listView(page)).toMatchObject({ top: 150, selected: 150 });
  });

  test('search results are not refreshed: the refresh is not offered and a pull sends nothing', async ({ page }) => {
    // Article 601 is a filler's: the author search lists every article but
    // the thread's four, under the caption 系列文章.
    await bootThreadBoard(page, { open: 601, fromList: true });
    await revealArticleDrawer(page);
    await page.locator('[data-article-shortcut="author"]').tap();
    await expect.poll(() => page.evaluate(() => window.__threadServer.state.byAuthor)).toBe('filler');
    await listActive(page);
    await expect(byKey(page, '__refresh')).toBeDisabled();
    await page.evaluate(() => (window.__threadSent = []));
    await page.locator(VIEW).evaluate((el) => {
      el.scrollTop = 0;
    });
    const r = await waitRectStable(page, VIEW);
    await touchDrag(page, { x: r.left + r.width / 2, y: r.top + 40 }, { x: r.left + r.width / 2, y: r.top + 300 });
    // sleep-ok: a refresh would have sent its `s` by now
    await page.waitForTimeout(500);
    expect((await page.evaluate(() => window.__threadSent)).join('')).not.toMatch(/s/);
    expect(await page.evaluate(() => window.__threadServer.state)).toMatchObject({ byAuthor: 'filler', filter: null });
    expect(await page.evaluate(() => window.__app.listSession._selectMode)).toBe(true);
  });
});
