// 文章好讀的 functionMode（鏡像原生）與 :N 往回跳 —— 重放 scenario 卷（真 PTT 錄的往返）。
//
// 取代 2026-10 前的 live 測項（easy-reading.spec.js「按 h 顯示說明」「:N 往回跳／`/` 提示」、
// enhance.spec.js「回文選單」）：那幾條在 live 要靠板況挑文章、固定 sleep 等 PTT，
// 現在素材固定，等待全部綁重放進度與狀態旗標。
// 素材：tests/e2e/cassettes/scn-er-{help,reply,seekback}.json（yarn record:scenarios）。
// 純邏輯另有 unit：easy_reading_function_mode_gate / easy_reading_seek_back /
// easy_reading_browser_find。
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootScenario, waitFed } = require('../helpers/replay');
const { pasteText, imeSetComposition, imeCommit } = require('../helpers/real_input');

const help = loadCassette('scn-er-help');
const reply = loadCassette('scn-er-reply');
const seekback = loadCassette('scn-er-seekback');

const fnMode = (page) => page.evaluate(() => !!window.__app.easyReading._functionMode);
const lastRowDisplay = (page) =>
  page.evaluate(() => {
    const lr = document.getElementById('easyReadingLastRow');
    return lr ? getComputedStyle(lr).display : 'no-el';
  });
const bufText = (page) =>
  page.evaluate(() => {
    const b = window.__app.buf;
    const out = [];
    for (let r = 0; r < b.rows; r++) out.push(b.getRowText(r, 0, b.cols));
    return out.join('\n');
  });

// 已餵的 bytes 都畫進 buf 且 settle 完（pageState 已依本幀重算）。
const waitBufSettled = (page) =>
  page.waitForFunction(() => !window.__app.buf.timerUpdate && !window.__app.buf._settleTimer);

// 列表首幀 → Enter 開文 → 等自動翻頁把素材裡的頁數全吃完、好讀累積到文末。
async function openAndAccumulate(page, cassette) {
  // 第一個 open 之後連續的 pagedown 才是這篇的自動翻頁（之後的 open 屬於後面的動作）。
  const firstOpen = cassette.steps.findIndex((s) => s.on === 'open');
  expect(firstOpen).toBeGreaterThan(0);
  let n = firstOpen + 1;
  while (n < cassette.steps.length && cassette.steps[n].on === 'pagedown') n++;
  await ptt.sendKey(page, 'Enter');
  await waitFed(page, n);
  await page.waitForFunction(
    () =>
      window.__app.view.useEasyReadingMode &&
      window.__app.easyReading.easyReadingReachedPageEnd &&
      !window.__app.buf.timerUpdate &&
      !window.__app.buf._settleTimer
  );
  expect(await fnMode(page)).toBe(false);
  return n; // 已餵的步數
}

test.describe('好讀 functionMode（scenario 重放）', () => {
  test('h → PTT 操作說明（functionMode）→ 說明選單彈窗補齊全部頁 → Esc 離開回長頁', async ({ page }) => {
    test.skip(!help, '缺 scn-er-help（yarn record:scenarios）');
    await bootScenario(page, ptt, help);
    const fed = await openAndAccumulate(page, help);

    // 舊 bug：h 在好讀的吞鍵清單裡，完全沒反應。
    // The article stays on screen under the sheet: PTT's help screens are
    // never painted, and the reading position does not move.
    await page.evaluate(() => {
      const d = window.__app.view.mainDisplay;
      d.scrollTop = Math.floor((d.scrollHeight - d.clientHeight) / 2);
    });
    const pageUnder = () =>
      page.evaluate(() => ({
        top: window.__app.view.mainDisplay.scrollTop,
        rows: document.querySelectorAll('#mainContainer [data-type="bbsline"]').length,
        help: document.getElementById('mainContainer').textContent.includes('操作說明 (Help)'),
      }));
    const under = await pageUnder();
    expect(under.top).toBeGreaterThan(0);
    expect(under.rows).toBeGreaterThan(24);
    let sawHelp = false;
    const watch = setInterval(() => pageUnder().then((p) => { if (p.help) sawHelp = true; }).catch(() => {}), 30);
    await ptt.sendKey(page, 'h');
    await expect.poll(() => fnMode(page)).toBe(true);
    // PTT's help is a paged menu. The help menu popup fetches every page (PgDn round
    // trips) and lists them all; the help screen has no reading status row, so
    // functionMode stays on underneath.
    const quit = help.steps.findIndex((s) => s.on === 'raw' && Buffer.from(s.send || '', 'base64').toString() === 'q');
    expect(quit).toBeGreaterThan(fed);
    await waitFed(page, quit);
    await expect.poll(() => page.evaluate(() => {
      const h = window.__app.helpMenu.snapshot();
      return h.open && !h.loading;
    })).toBe(true);
    await expect(page.locator('[data-help-item]').first()).toBeFocused();
    await waitBufSettled(page);
    expect(await fnMode(page)).toBe(true);
    expect(await bufText(page)).toContain('操作說明');
    expect(await pageUnder()).toEqual(under);

    // Esc leaves the popup by sending q, as natively.
    await page.keyboard.press('Escape');
    await waitFed(page, quit + 1);
    await expect.poll(() => fnMode(page)).toBe(false);
    // 'resume'：回好讀長頁，footer overlay 復現。
    expect(await page.evaluate(() => window.__app.view.useEasyReadingMode)).toBe(true);
    await expect.poll(() => lastRowDisplay(page)).toBe('block');
    clearInterval(watch);
    expect(sawHelp).toBe(false);
    expect(await pageUnder()).toEqual(under);
  });

  test('r → 「回應至」（functionMode）→ q 取消，乾淨退出不卡死', async ({ page }) => {
    test.skip(!reply, '缺 scn-er-reply（需帳號錄製）');
    await bootScenario(page, ptt, reply);
    const fed = await openAndAccumulate(page, reply);

    // 舊 bug：選單被好讀 footer 蓋住、看不到 prompt。
    await ptt.sendKey(page, 'r');
    await waitFed(page, fed + 1);
    await expect.poll(() => fnMode(page)).toBe(true);
    // 選單列真的畫在畫面上（不是被長頁蓋住）：DOM 是原生 24 列的鏡像。
    await expect.poll(() => bufText(page)).toContain('回應至');
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelectorAll('#mainContainer [data-type="bbsline"]').length)
      )
      .toBeLessThanOrEqual(24);

    await ptt.typeLine(page, 'q');
    await waitFed(page, fed + 2);
    await expect.poll(() => fnMode(page)).toBe(false);
    const ps = await page.evaluate(() => window.__app.buf.pageState);
    // 取消後 PTT 回文章（resume 回長頁）或帶回列表（leave）：兩者都是合法的乾淨退出。
    if (ps === 3) await expect.poll(() => lastRowDisplay(page)).toBe('block');
    else expect(await lastRowDisplay(page)).toBe('none');
  });

  test('`/` only hints at the browser find, Ctrl+F sends no ^F, and `:` is refused with a message', async ({ page }) => {
    test.skip(!seekback, '缺 scn-er-seekback（yarn record:scenarios）');
    await bootScenario(page, ptt, seekback);
    await openAndAccumulate(page, seekback);
    const rowTexts = () =>
      page.evaluate(() =>
        window.__app.buf.pageLines.map((r) => r.map((c) => c.ch).join('').replace(/\s+$/, ''))
      );
    const before = await rowTexts();
    expect(before.length).toBeGreaterThan(40);
    const sentBefore = await page.evaluate(() => window.__replay.sent.length);
    const sigBefore = await page.evaluate(() => window.__app.easyReading._currentPageSignature());

    // `/`: a local hint, nothing goes to PTT, no native mirror.
    await ptt.sendKey(page, 'Slash');
    await expect(page.locator('.ListHint')).toContainText(/Ctrl\+F|⌘F/);
    expect(await fnMode(page)).toBe(false);

    // Ctrl+F: no ^F (pmore's ^F would move the page pointer).
    await ptt.sendKey(page, 'Control+f');

    // `:` (go to a line) is a PTT prompt easy reading does not present (#160):
    // refused with a message, shown even with status hints off.
    await ptt.applyPrefs(page, { showStatusHints: false });
    await ptt.sendKey(page, ':');
    await expect(page.locator('.ListHint')).toContainText('好讀模式目前不支援這個按鍵');
    await expect(page.locator('.ListHint')).toHaveAttribute('data-level', 'error');
    expect(await fnMode(page)).toBe(false);
    expect(await page.evaluate((k) => window.__replay.sent.slice(k), sentBefore)).toEqual([]);
    expect(await page.evaluate(() => window.__app.easyReading._currentPageSignature())).toBe(sigBefore);
    expect(await rowTexts()).toEqual(before);

    // Ctrl+R (PTT's reply to a message) and Alt+R, its alias, likewise.
    for (const key of ['Control+r', 'Alt+r']) {
      await page.evaluate(() => {
        const el = document.querySelector('.ListHint');
        if (el) el.textContent = '';
      });
      await page.keyboard.press(key);
      await expect(page.locator('.ListHint')).toContainText('好讀模式目前不支援這個按鍵');
      expect(await fnMode(page)).toBe(false);
      expect(await page.evaluate((k) => window.__replay.sent.slice(k), sentBefore)).toEqual([]);
    }
  });

  test('pasted and input-method text over the article is refused; a footer button for an unpresented function too', async ({ page, context }) => {
    test.skip(!seekback, '缺 scn-er-seekback（yarn record:scenarios）');
    await bootScenario(page, ptt, seekback);
    await openAndAccumulate(page, seekback);
    await ptt.applyPrefs(page, { showStatusHints: false });
    const sentBefore = await page.evaluate(() => window.__replay.sent.length);
    const refused = async (text) => {
      await expect(page.locator('.ListHint')).toContainText(text);
      await expect(page.locator('.ListHint')).toHaveAttribute('data-level', 'error');
      expect(await fnMode(page)).toBe(false);
      expect(await page.evaluate((k) => window.__replay.sent.slice(k), sentBefore)).toEqual([]);
      await expect.poll(() => lastRowDisplay(page)).toBe('block');
    };

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await pasteText(page, '#1abCDeFG');
    await refused('好讀模式目前不支援在文章貼上文字');

    await page.locator('#t').focus();
    await imeSetComposition(page, '測');
    await imeCommit(page, '測試');
    await refused('好讀模式目前不支援在文章輸入文字');

    // A function-key button of the footer, for a function easy reading does
    // not present (switch board).
    await page.evaluate(() => window.__app.onFunctionKey('s'));
    await refused('好讀模式目前不支援這個按鍵');
  });
});
