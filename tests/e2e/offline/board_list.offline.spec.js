// 看板列表（choose_board）—— 重放真 PTT 錄的往返（分類看板子清單，guest 也錄得到）。
//
//   1. 平滑捲動（好讀開著時的看板列表）：engage → body 住進捲動視口、header 不跟著捲
//      → End／Home 交易 → 不支援的鍵 `/` 被拒絕（提示、不送、列表不動；#192）
//      → `h` 的說明選單疊在保留的列表上，關掉之後同一份列表原地接回、視野不動（#192）。
//      unit 蓋掉純邏輯（docs/board-list-smooth-scroll.md §6）；這裡驗真瀏覽器＋完整 boot 鏈下
//      捲動視口真的建得起來、交易真的收得回去。
//   2. 按 s 的「搜尋看板」prompt：不破字、整頁不上底色、殘留列表不可點。修法的判準是
//      「游標格是 fg=0/bg=7」，而那是 pfterm 實際吐的 bytes（不是 vtuikit.c 的 ESC[0;7m）——
//      2026-10 前只有 live 量得到，現在素材把那幾個 bytes 固定下來。
// 素材：tests/e2e/cassettes/scn-boardlist-class.json、scn-board-search-prompt.json
// （yarn record:scenarios）。純邏輯另有 unit：board_list_* / cursor_highlight /
// mouse_regions / term_buf_input_field / highlight_col_dbcs。
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootScenario, waitFed } = require('../helpers/replay');
const { waitRectStable, installPaintedFrameProbe } = require('../helpers/layout');
const { answerHelpKey, drawHelpPage } = require('../helpers/help_menu');

const smooth = loadCassette('scn-boardlist-class');
const prompt = loadCassette('scn-board-search-prompt');

const viewportState = (page) =>
  page.evaluate(() => {
    const app = window.__app;
    const view = document.querySelector('#mainContainer .listBodyView');
    const container = document.querySelector('#mainContainer');
    const outer = container ? Array.from(container.children) : [];
    const nums = app.buf.brdListLineNums || [];
    return {
      owner: app.buf.listRenderOwner,
      mode: app.buf.listRenderMode,
      state: app.boardListSession.state,
      hasView: !!view,
      outerCount: outer.length,
      viewIndex: view ? outer.indexOf(view) : -1,
      clientHeight: view ? view.clientHeight : -1,
      scrollHeight: view ? view.scrollHeight : -1,
      buffered: nums.length,
      maxNum: nums.slice(-1)[0],
      selected: app.boardListSession._selectedNum,
      queueIdle: app.commandQueue.idle,
    };
  });

// 素材裡第一個 on===kind 的 step index（＋1 ＝餵完它之後的 fed 值）。
const fedAfter = (cassette, kind) => cassette.steps.findIndex((s) => s.on === kind) + 1;

const settledActive = (page) =>
  page.waitForFunction(() => {
    const app = window.__app;
    return (
      app.boardListSession.state === 'active' &&
      app.buf.listRenderMode === 'buffer' &&
      app.commandQueue.idle &&
      !app.buf.timerUpdate &&
      !app.buf._settleTimer
    );
  });

test.describe('看板列表平滑捲動（scenario 重放）', () => {
  test('engage → 捲動 → End/Home → `/` 拒絕 → `h` 說明選單疊在列表上、關掉原地接回', async ({ page }) => {
    test.skip(!smooth, '缺 scn-boardlist-class（yarn record:scenarios）');
    await bootScenario(page, ptt, smooth, { prefs: { enableEasyReading: true } });
    await settledActive(page);

    // 接管畫面：header 3 列 + 視口 + footer ＝ 容器的 5 個直系子節點，視口在第 4 個。
    const st = await viewportState(page);
    expect(st.owner).toBe('board-list');
    expect(st.hasView).toBe(true);
    expect(st.outerCount).toBe(5);
    expect(st.viewIndex).toBe(3);
    expect(st.clientHeight).toBeGreaterThan(0);
    expect(st.buffered).toBeGreaterThan(0);
    expect(st.selected).not.toBeNull();
    expect(st.scrollHeight).toBeGreaterThan(st.clientHeight + 1); // 素材挑的是超過兩個視口的清單

    // Take both geometry samples in one task so a queued scroll cannot move the baseline.
    const { top, bottom } = await page.evaluate(() => {
      const c = document.querySelector('#mainContainer');
      const v = c.querySelector('.listBodyView');
      const sample = () => ({
        scrollTop: v.scrollTop,
        maxScrollTop: v.scrollHeight - v.clientHeight,
        headerTop: c.children[0].getBoundingClientRect().top,
        firstBodyTop: v.children[0].getBoundingClientRect().top,
      });
      v.scrollTop = 0;
      const top = sample();
      v.scrollTop = v.scrollHeight;
      const bottom = sample();
      return { top, bottom };
    });
    expect(top.scrollTop).toBe(0);
    expect(Math.abs(bottom.scrollTop - bottom.maxScrollTop)).toBeLessThan(1);
    const delta = bottom.scrollTop - top.scrollTop;
    expect(Math.abs(bottom.headerTop - top.headerTop)).toBeLessThan(1);
    // body 恰好位移捲動量（整段序列都在視口裡，header 不在）。
    expect(Math.abs(top.firstBodyTop - bottom.firstBodyTop - delta)).toBeLessThan(1);

    // End／Home：抓到板尾與板頭，畫面不卡在 frozen。
    await ptt.sendKey(page, 'End');
    await waitFed(page, fedAfter(smooth, 'end'));
    await settledActive(page);
    const atEnd = await viewportState(page);
    expect(atEnd.selected).toBe(atEnd.maxNum);
    await ptt.sendKey(page, 'Home');
    await settledActive(page);
    await expect.poll(async () => (await viewportState(page)).selected).toBe(1);

    // `/`（關鍵字篩選）好讀沒有提供 ⇒ 拒絕（#192）：錯誤提示、什麼都不送、列表原封不動。
    await page.evaluate(() => {
      window.__hints = [];
      const v = window.__app.view;
      const flash = v.flashListHint.bind(v);
      v.flashListHint = (text, ...rest) => {
        window.__hints.push(text);
        return flash(text, ...rest);
      };
    });
    const sentBefore = await page.evaluate(() => window.__replay.sent.length);
    await ptt.sendKey(page, '/');
    await expect.poll(() => page.evaluate(() => window.__hints.slice())).toEqual([
      '好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）'
    ]);
    expect(await page.evaluate((n) => window.__replay.sent.slice(n), sentBefore)).toEqual([]);
    const refused = await viewportState(page);
    expect(refused.state).toBe('active');
    expect(refused.owner).toBe('board-list');
    expect(refused.hasView).toBe(true);

    // `h`：說明選單 sheet 疊在**保留**的看板列表上（不畫 PTT 的說明幀），關掉之後
    // 同一份列表在同一幀接回，視野一格都不動（#192）。先把視野捲離選取列，視野不動才有意義。
    await page.evaluate(() => {
      // Relative: above board 1 sits the scroll reserve, so an absolute offset could land in it.
      document.querySelector('#mainContainer .listBodyView').scrollTop += 4 * window.__app.view.chh + 3;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await settledActive(page);
    // #222: `h` goes out at once (no cursor sync first). Every painted frame
    // (helpers/layout.installPaintedFrameProbe) from here to the end is sampled.
    await installPaintedFrameProbe(page);
    await page.evaluate(() => {
      // What the reader sees: the first board row in the viewport and how far
      // it sits from the viewport's top (scrollTop alone also moves when the
      // scroll reserve above board 1 is resized, without anything moving).
      window.__viewOf = () => {
        const app = window.__app;
        const main = document.getElementById('mainContainer');
        const v = main.querySelector('.listBodyView');
        let first = null;
        let off = null;
        if (v) {
          const top = v.getBoundingClientRect().top;
          for (const el of v.querySelectorAll('[data-type="bbsline"]')) {
            const r = el.getBoundingClientRect();
            if (r.bottom <= top + 1) continue;
            const m = /^[>\s]*(\d+)/.exec(el.textContent);
            first = m ? Number(m[1]) : el.textContent.trim().slice(0, 12);
            off = Math.round(r.top - top);
            break;
          }
        }
        return {
          first,
          off,
          buffered: (app.buf.brdListLineNums || []).length,
          state: app.boardListSession.state,
          mode: app.buf.listRenderMode,
          holding: app.helpMenu.holding,
          phase: app.helpMenu.phase,
          sheet: !!document.querySelector('[data-help-item]'),
          helpDrawn: main.textContent.includes('操作說明 (Help)'),
        };
      };
      window.__helpFrames = [];
      const sample = () => window.__helpFrames.push(window.__viewOf());
      window.__stopHelpFrames = () => window.__paintedFrame.remove(sample);
      window.__paintedFrame.add(sample);
    });
    const before = await page.evaluate(() => window.__viewOf());
    expect(before.first).not.toBe(1); // scrolled off Home's landing
    const sel0 = await page.evaluate(() => window.__app.boardListSession._selectedNum);

    // One help visit up to the detach: h, PgDn for page 2, then the sheet's own
    // `q`; PTT answers it by redrawing the list under the sheet as it stood
    // (the cassette's fed bytes once more; the last of them is that page).
    const openDetached = async () => {
      const sent0 = await page.evaluate(() => window.__replay.sent.length);
      const sentSince = () => page.evaluate((n) => window.__replay.sent.slice(n), sent0);
      await answerHelpKey(page, 'h\f');
      await ptt.sendKey(page, 'h');
      await expect.poll(sentSince).toEqual(['h\f']);
      expect(await page.evaluate(() => window.__app.helpMenu.holding)).toBe(true);
      // The sheet is open at the keypress, before any of PTT's help screen.
      await expect(page.locator('[data-help-pending-text]')).toBeVisible();
      expect(await page.locator('[data-help-item]').count()).toBe(0);
      const { total } = await drawHelpPage(page, 1);
      await expect(page.locator('[data-help-item]').first()).toBeVisible();
      // The rest of the pages behind the sheet, one PgDn each (how many
      // depends on the terminal's rows), then the sheet's own `q`.
      const bytes = ['h\f'];
      for (let n = 2; n <= total; ++n) {
        bytes.push('\x1b[6~');
        await expect.poll(sentSince).toEqual(bytes);
        await drawHelpPage(page, n);
      }
      bytes.push('q');
      await expect.poll(sentSince).toEqual(bytes);
      await page.evaluate((recvs) => {
        window.__app.onData(recvs.slice(0, window.__replay.fed).map((r) => atob(r)).join(''));
      }, smooth.steps.map((st) => st.recv));
      await page.waitForFunction(() => window.__app.helpMenu.phase === 'detached' && !window.__app.helpMenu.holding);
      await settledActive(page);
      await expect(page.locator('[data-help-item]').first()).toBeVisible();
      // `/` is refused on the board list, so its row is dimmed; `s` is kept.
      await expect(page.locator('[data-help-item]', { hasText: '搜尋看板中文關鍵字' })).toBeDisabled();
      await expect(page.locator('[data-help-item]', { hasText: '搜尋全站看板名稱' })).toBeEnabled();
      return { sentSince, bytes };
    };
    const framesSoFar = async () => {
      const n = await page.evaluate(() => window.__helpFrames.length);
      await page.waitForFunction((k) => window.__helpFrames.length > k + 8, n);
      return page.evaluate(() => window.__helpFrames.slice());
    };

    // (a) Close the detached sheet: nothing more is sent.
    let { sentSince, bytes } = await openDetached();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-help-item]')).toHaveCount(0);
    let frames = await framesSoFar();
    expect(await sentSince()).toEqual(bytes);
    expect(await page.evaluate(() => window.__app.boardListSession._selectedNum)).toBe(sel0);

    // (b) Pick a kept command (↓): it is typed into the list, which moves its
    // selection locally and sends PTT nothing. The frames checked end at the
    // pick: what the key does to the view afterwards is the list's own.
    ({ sentSince, bytes } = await openDetached());
    frames = await framesSoFar();
    await page.evaluate(() => window.__stopHelpFrames());
    await page.locator('[data-help-item]', { hasText: '向下移動' }).click();
    await expect(page.locator('[data-help-item]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.__app.boardListSession._selectedNum))
      .toBe(sel0 + 1);
    expect(await sentSince()).toEqual(bytes);

    // Every frame: the list on the page, never PTT's help screen, the first row
    // seen and its place unchanged, the buffer never dropped and rebuilt.
    expect(frames.some((f) => f.phase === 'detached' && f.sheet)).toBe(true);
    const moved = frames.filter(
      (f) => f.helpDrawn || f.first !== before.first || Math.abs(f.off - before.off) > 1 || f.buffered !== before.buffered
    );
    expect(moved, JSON.stringify({ before, frames })).toEqual([]);

    // 到此為止。素材之後錄的 `/` 原生來回與「自動回復重新 seed（21→22→1）→ ← 離開」**不重放**：重新 seed
    // 要探幾次邊界取決於靜置探針的計時（live 在 21 的回應之後還探了 22，offline 回應瞬間到、
    // 21 之後就判定 seed 完成），送出序列在 bytes 層級對不上。← 離開的交易收攤由
    // tests/unit/board_list_session.test.js 守。
  });
});

const promptState = (page) =>
  page.evaluate(() => {
    const buf = window.__app.buf;
    return {
      pageState: buf.pageState,
      onInputField: buf.isCursorOnInputField(),
      mouseAction: buf.mouseAction,
      // 整列底色掛在 bbsline 的 bN class 上；部分底色包在 .cursorHighlight wrapper 裡。
      highlightSpans: document.querySelectorAll('.cursorHighlight').length,
      tintedLines: Array.from(document.querySelectorAll('[data-type="bbsline"]')).filter((n) =>
        /\bb\d+\b/.test(n.className)
      ).length,
    };
  });

test('搜尋看板 prompt：不破字、整個畫面不上底色、殘留列表不可點', async ({ page }) => {
  test.skip(!prompt, '缺 scn-board-search-prompt（yarn record:scenarios）');
  // 這條守的是**原生** s prompt 的渲染（卷裡錄的就是它，好讀關著）；好讀開著時搜尋彈窗
  // 會把 s 攔走，那條路由 article_search.offline.spec.js 守。
  await bootScenario(page, ptt, prompt);
  const list = await promptState(page);
  expect(list.pageState).toBe(2);
  expect(list.onInputField).toBe(false);
  // 基準：列表上底色本來就要在，否則下面的斷言全部是假綠。
  expect(list.highlightSpans + list.tintedLines).toBeGreaterThan(0);

  await ptt.sendKey(page, 's');
  await waitFed(page, 2);
  await expect.poll(async () => (await promptState(page)).onInputField).toBe(true);
  const rows = await page.evaluate(() => {
    const b = window.__app.buf;
    return [0, 1].map((r) => b.getRowText(r, 0, b.cols)).join('\n');
  });
  // 「自動搜尋」的「尋」trail byte 落在底色起始欄 30：切段把 lead byte 丟掉就畫成「自動搜M」。
  expect(rows).not.toContain('自動搜M');
  // 底色在 prompt 那一幀 settle 之後才重算（輸入欄是那時才認得出來）⇒ 等終局，不讀單點。
  await expect
    .poll(async () => {
      const s = await promptState(page);
      return s.highlightSpans + s.tintedLines;
    })
    .toBe(0);

  // 殘留在下方的列表列：不上 hover 底色、也不可點（點下去會送 Enter 給輸入框）。
  const box = await waitRectStable(page, '#mainContainer');
  await page.mouse.move(box.left + box.width * 0.6, box.top + box.height * 0.5);
  await expect.poll(async () => (await promptState(page)).mouseAction).toBe('none');
  const hover = await promptState(page);
  expect(hover.highlightSpans + hover.tintedLines).toBe(0);

  // 取消 prompt 後底色要回來（gate 只在輸入框存在時生效）。
  await page.mouse.move(box.left + box.width * 0.6, box.top - 5);
  await ptt.sendKey(page, 'Enter');
  await waitFed(page, prompt.steps.length);
  await expect.poll(async () => (await promptState(page)).onInputField).toBe(false);
  await expect
    .poll(async () => {
      const s = await promptState(page);
      return s.highlightSpans + s.tintedLines;
    })
    .toBeGreaterThan(0);
});

// 右鍵「<板名> 設為已讀」（js/board_mark_read.js）。看板列表的 `v` 只作用在**真游標**那一列、
// 沒有確認 ⇒ 原生路徑是「跳號 → 確認游標停在同板名 → 才送 v」。這卷的起始畫面是只有
// 第 21 列的那一頁，錄的第一個跳號是 22 ⇒ 右鍵那一列送出的 `21⏎` 不會被餵回應，正好驗
// 「跳號沒落地就絕不送 v」（正向序列由 unit board_mark_read.test.js 守）。
test('右鍵看板列：選單有「<板名> 設為已讀」；跳號沒落地絕不送 v', async ({ page }) => {
  test.skip(!smooth, '缺 scn-boardlist-class（yarn record:scenarios）');
  // 原生那條路（好讀關著）：好讀接管的看板列表走 session 的凍結交易，由 unit 守。
  await bootScenario(page, ptt, smooth, { prefs: { enableEasyReading: false } });
  const target = await page.evaluate(() => {
    const b = window.__app.buf;
    for (let r = 3; r < b.rows - 1; ++r) {
      const t = b.getRowText(r, 0, b.cols);
      // 編號在 `%7d` 欄內（board_list_parse.parseBoardListNum 的守門），之後第一個識別字是板名。
      const m = /^([\s>]*)(\d+)[^A-Za-z0-9_]*([A-Za-z0-9_][A-Za-z0-9_-]*)/.exec(t);
      if (m && m[1].length + m[2].length <= 7) {
        const el = document.querySelector('#mainContainer [data-type="bbsline"][data-row="' + r + '"]');
        if (!el) return null;
        el.setAttribute('data-e2e-target', '1');
        return { row: r, num: Number(m[2]), name: m[3] };
      }
    }
    return null;
  });
  expect(target, '起始畫面找不到看板列').not.toBeNull();
  // 前提：這一號不是卷裡錄的下一個跳號（否則會被餵回應，驗不到「沒落地」）。
  expect(target.num).not.toBe(smooth.steps.find((s) => s.on === 'jump').num);
  const box = await waitRectStable(page, '[data-e2e-target]');
  const chw = await page.evaluate(() => window.__app.view.chw);
  await page.mouse.click(box.left + 25.5 * chw, box.top + box.height / 2, { button: 'right' });

  const suffix = await page.evaluate(() => window.__i18n('cmenu_boardMarkRead'));
  const item = page
    .locator('.DropdownMenu')
    .first()
    .getByRole('menuitem')
    .filter({ hasText: suffix });
  await expect(item).toBeVisible();
  await expect(item).toContainText(target.name);

  const before = await page.evaluate(() => window.__replay.sent.length);
  await item.click();
  await page.waitForFunction(
    ({ from, num }) => window.__replay.sent.slice(from).includes(num + '\r\f'),
    { from: before, num: target.num },
    { timeout: 10000 }
  );
  // 跳號等不到落地 ⇒ 序列收手（在途旗標解除）；期間與之後都不得出現 v。
  await page.waitForFunction(() => !window.__app.markAllReadInFlight, undefined, {
    timeout: 20000
  });
  const sent = await page.evaluate((from) => window.__replay.sent.slice(from), before);
  expect(sent.filter((d) => d.charAt(0) === 'v')).toEqual([]);
});
