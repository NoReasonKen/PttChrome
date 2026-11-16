// 手機的首頁儀表板（docs/home-dashboard.md、docs/screen-refresh.md）：
//   - 下拉重整：在面板（整片都是卡片按鈕）上往下拉過門檻放手 ⇒ 重抓我的最愛，不會變成點卡片；
//   - 工具列「重整」在首頁＝重抓我的最愛；
//   - 閱讀紀錄：面板捲到中段點看板 → 進板 → 回首頁時捲回同一張卡片。
// 只在 `offline-mobile` project 跑（Pixel 7 模擬，hasTouch）。下拉與捲動走 CDP 觸控
// （helpers/real_input.touchDrag），點卡片走 locator.tap（真觸控）。
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu, drawPressAnyKey, drawUserMenu } = require('../helpers/main_menu');
const { drawFavorites, drawArticleList } = require('../helpers/home_screens');
const { startCapture, peekCapture, takeCapture } = require('../helpers/capture');
const { touchDrag, imeCommit } = require('../helpers/real_input');
const { ITEMS, drawHelpPage } = require('../helpers/help_menu');
const { waitRectStable, waitScrollStable, installPaintedFrameProbe } = require('../helpers/layout');
const { bootDashboard, boardOpened, dashboardVisible } = require('../helpers/stack_routes');

const ZA_FAV = '\x1af';
// 18 個：一頁不滿（不走跳號翻頁），兩欄排起來比面板高、捲得動。
const FAVS = Array.from({ length: 18 }, (_, i) => ({
  name: 'Board' + (i + 1),
  desc: '測試看板 ' + (i + 1),
  unread: i % 4 === 0,
}));

const dashboard = (page) => page.locator('#homeDashboard');

async function bootHome(page, opts) {
  await bootOffline(page, ptt, opts);
  await ptt.applyPrefs(page, { refreshMinIntervalSec: 0 });
  await startCapture(page);
}

// 面板出現 → （自動或手動）Ctrl+Z f → 畫我的最愛 → 送 q → 畫回主功能表 → 卡片。
async function answerFetch(page) {
  await expect.poll(() => peekCapture(page)).toContain(ZA_FAV);
  await drawFavorites(page, FAVS);
  await expect.poll(() => peekCapture(page)).toContain('q');
  expect(await takeCapture(page)).toBe(ZA_FAV + '\fq\f');
  await drawMainMenu(page);
  await expect(page.locator('[data-home-board]')).toHaveCount(FAVS.length);
}

// 面板頂端那張卡片與它離面板上緣的距離（同 home_dashboard.homeAnchorOf 的定義）。
const topCard = (page) =>
  page.evaluate(() => {
    const root = document.getElementById('homeDashboard');
    const top = root.getBoundingClientRect().top;
    for (const el of root.querySelectorAll('[data-home-board]')) {
      const r = el.getBoundingClientRect();
      if (r.bottom > top + 1) return { name: el.getAttribute('data-home-board'), offset: r.top - top, scrollTop: root.scrollTop };
    }
    return null;
  });
const offsetOf = (page, name) =>
  page.evaluate((name) => {
    const root = document.getElementById('homeDashboard');
    const el = root.querySelector(`[data-home-board="${name}"]`);
    return el.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }, name);

// Every painted frame from now on (helpers/layout.installPaintedFrameProbe):
// whether PTT's main menu is drawn on the real screen, and whether it
// shows there uncovered by the dashboard or a stacked-page layer (the native
// grid guard's own test of what is shown).
async function recordMainMenuFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(() => {
    window.__menuFrames = [];
    const uncovered = (main) => {
      const rect = main.getBoundingClientRect();
      const bar = document.getElementById('mobileAppBar');
      const toolbar = document.querySelector('.mobileToolbarBar');
      const top = Math.max(0, rect.top, bar ? bar.getBoundingClientRect().bottom : 0);
      const bottom = Math.min(innerHeight, rect.bottom, toolbar ? toolbar.getBoundingClientRect().top : innerHeight);
      const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
      return [0.25, 0.5, 0.75].some((f) => {
        const hit = document.elementFromPoint(x, top + (bottom - top) * f);
        return !!hit && main.contains(hit) && !hit.closest('#homeDashboard, [data-stack-layer]');
      });
    };
    const sample = () => {
      const main = document.querySelector('.main:not([data-stack-layer])');
      // The mobile menu surface leaves the title row to the App Bar: the
      // main menu is told by its (F)avorite item.
      const content = main && main.querySelector('#mainContainer');
      const menu = !!content && content.textContent.replace(/\s/g, '').includes('(F)avorite');
      window.__menuFrames.push({
        menu,
        uncovered: menu && uncovered(main),
        dashboard: window.__app.homeDashboard.state.visible,
      });
    };
    window.__stopMenuFrames = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  });
}

// The frames recorded until the dashboard has shown for a while.
async function mainMenuFrames(page) {
  await expect(dashboard(page)).toBeVisible();
  const before = await page.evaluate(() => window.__menuFrames.length);
  await page.waitForFunction((n) => window.__menuFrames.length > n + 8, before);
  return page.evaluate(() => {
    window.__stopMenuFrames();
    return window.__menuFrames;
  });
}

test.describe('手機首頁儀表板（離線重放）', () => {
  // #187: the dashboard decides on the screen's settle, after PTT's main menu
  // has arrived. Until then the main menu's frames are held: the page before
  // stays, and the dashboard covers the main menu from its first painted frame.
  test('arriving at the main menu after login paints no uncovered main-menu frame', async ({ page }) => {
    await bootHome(page);
    // The login's last screen, then PTT's main menu.
    await drawPressAnyKey(page);
    await recordMainMenuFrames(page);
    await drawMainMenu(page);
    const frames = await mainMenuFrames(page);
    expect(frames.some((f) => f.menu && f.dashboard)).toBe(true);
    expect(frames.filter((f) => f.uncovered)).toEqual([]);
  });

  // Another page left back to the main menu: here a submenu PTT shows natively
  // (個人設定區, an easy-reading gap, #200). This synthetic submenu's title is
  // not the one the guard's #200 entry knows, so the guard only records here;
  // the main menu's frames are judged below.
  test('returning from a native submenu to the main menu paints no uncovered main-menu frame', async ({ page }) => {
    await bootHome(page, { nativeGridGuard: 'off' });
    await drawMainMenu(page);
    await answerFetch(page);
    await drawUserMenu(page);
    await expect(dashboard(page)).toHaveCount(0);
    await recordMainMenuFrames(page);
    await drawMainMenu(page);
    const frames = await mainMenuFrames(page);
    expect(frames.some((f) => f.menu && f.dashboard)).toBe(true);
    expect(frames.filter((f) => f.uncovered)).toEqual([]);
  });

  // A board reached by the search sheet has no dashboard copy under it
  // (mobile_stack_board_reveal), so Back shows PTT's main menu as it arrives.
  test('returning from a board to the main menu paints no uncovered main-menu frame', async ({ page }) => {
    await bootDashboard(page);
    await page.locator('[data-key="__search"]').tap();
    const input = page.locator('input[name="searchKeyword"]');
    await input.fill('C_Chat');
    await input.press('Enter');
    await boardOpened(page);
    await recordMainMenuFrames(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await dashboardVisible(page);
    const frames = await mainMenuFrames(page);
    expect(frames.some((f) => f.menu && f.dashboard)).toBe(true);
    expect(frames.filter((f) => f.uncovered)).toEqual([]);
  });

  // The dashboard refuses PTT's own keys, so system Back at home sends no ← and
  // says how to leave, not that the key is unsupported.
  test('system Back at home sends nothing and shows the leave hint', async ({ page }) => {
    await bootHome(page);
    await drawMainMenu(page);
    await answerFetch(page);
    // A real tap is the user activation the history guard waits for.
    await page.locator('#mobileAppBar [data-key="__title"]').tap();
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.evaluate(() => {
      window.__sameDocument = true;
      window.__hints = [];
      const flash = window.__app.view.flashListHint.bind(window.__app.view);
      window.__app.view.flashListHint = (text, ...rest) => { window.__hints.push(text); return flash(text, ...rest); };
    });
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.__hints)).toEqual(['再按一次「上一頁」可離開本站']);
    expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
    await expect(dashboard(page)).toBeVisible();
    expect(await peekCapture(page)).toBe('');
  });

  test('下拉重整：在卡片上往下拉過門檻放手 ⇒ 重抓我的最愛，不會點進看板', async ({ page }) => {
    await bootHome(page);
    await drawMainMenu(page);
    await expect(dashboard(page)).toBeVisible();
    await answerFetch(page);
    await page.evaluate(() => (window.__notReloaded = true));

    const r = await waitRectStable(page, '[data-home-board="Board1"]');
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // 60px × 阻尼 0.5 ＝ 30px，不到門檻：不送、也不算點卡片。
    await touchDrag(page, { x, y }, { x, y: y + 60 });
    await expect(page.locator('.pullRefreshIndicator.visible')).toHaveCount(0);
    expect(await peekCapture(page)).toBe('');

    await touchDrag(page, { x, y }, { x, y: y + 180 });
    await expect.poll(() => peekCapture(page)).toContain(ZA_FAV);
    // 沒有變成點 Board1（s<板> 的第一鍵）。
    expect(await peekCapture(page)).not.toContain('s');
    await expect(page.locator('.pullRefreshIndicator.visible')).toHaveCount(0);
    await answerFetch(page);
    expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
  });

  test('工具列「重整」在首頁 ⇒ 重抓我的最愛', async ({ page }) => {
    await bootHome(page);
    await drawMainMenu(page);
    await answerFetch(page);
    const refresh = page.locator('[data-key="__refresh"]');
    await expect(refresh).toBeEnabled();
    await refresh.tap();
    await answerFetch(page);
  });

  // 手機的標題只有一行：App Bar 寫「首頁」，面板不再畫大標題。好讀開著時沒有切回原生主選單的
  // 控制項（#191）。
  test('App Bar 標題＝首頁；沒有「原生主選單」鈕', async ({ page }) => {
    await bootHome(page);
    await drawMainMenu(page);
    await answerFetch(page);
    const label = (k) => page.evaluate((key) => window.__i18n(key), k);
    await expect(page.locator('#mobileAppBar [data-key="__title"]')).toHaveText(await label('home_title'));
    await expect(page.locator('#homeDashboard .homeTitle')).toHaveCount(0);
    await expect(page.locator('#homeDashboard [data-home-native]')).toHaveCount(0);
    // 第一排卡片緊接在 App Bar 下面（中間不再隔一行標題）：只隔「開信箱」（#196，一直都在）
    // 與「我的最愛」兩行。
    const gaps = await page.evaluate(() => {
      const bar = document.getElementById('mobileAppBar').getBoundingClientRect();
      const mail = document.querySelector('#homeDashboard .homeHeader').getBoundingClientRect();
      const card = document.querySelector('[data-home-board]').getBoundingClientRect();
      return { mail: mail.top - bar.bottom, card: card.top - mail.bottom };
    });
    expect(gaps.mail).toBeLessThan(24);
    expect(gaps.card).toBeLessThan(80);
    await expect(page.locator('#mobileAppBar [data-key="__homeNative"]')).toHaveCount(0);
    await expect(page.locator('#mobileAppBar button')).toHaveCount(0);
    expect(await takeCapture(page)).toBe('');
  });

  test('點 App Bar 標題 ⇒ 面板捲回頂端，不送鍵', async ({ page }) => {
    await bootHome(page);
    await drawMainMenu(page);
    await answerFetch(page);
    const box = await waitRectStable(page, '#homeDashboard');
    const x = box.left + box.width / 2;
    await touchDrag(page, { x, y: box.top + box.height - 30 }, { x, y: box.top + 30 });
    expect(await waitScrollStable(page, '#homeDashboard')).toBeGreaterThan(20);
    await page.locator('#mobileAppBar [data-key="__title"]').tap();
    await expect.poll(() => page.evaluate(() => document.getElementById('homeDashboard').scrollTop)).toBe(0);
    expect(await takeCapture(page)).toBe('');
  });

  test('閱讀紀錄：捲到中段點看板 → 進板 → 回首頁時捲回同一張卡片', async ({ page }) => {
    await bootHome(page);
    await drawMainMenu(page);
    await answerFetch(page);

    // 真觸控往上滑，讓面板捲到中段。
    const box = await waitRectStable(page, '#homeDashboard');
    const x = box.left + box.width / 2;
    await touchDrag(page, { x, y: box.top + box.height - 30 }, { x, y: box.top + 30 });
    await waitRectStable(page, '[data-home-board="Board18"]');
    const before = await topCard(page);
    expect(before.scrollTop).toBeGreaterThan(20);

    // 點一張整張都看得到的卡片。
    const target = await page.evaluate(() => {
      const root = document.getElementById('homeDashboard').getBoundingClientRect();
      for (const el of document.querySelectorAll('[data-home-board]')) {
        const r = el.getBoundingClientRect();
        if (r.top >= root.top && r.bottom <= root.bottom) return el.getAttribute('data-home-board');
      }
      return null;
    });
    await page.locator(`[data-home-board="${target}"]`).tap();
    await expect.poll(() => peekCapture(page)).toContain('s');
    await expect.poll(() => peekCapture(page)).toContain(target + '\r');
    await drawArticleList(page, target, [[1, ' '], [2, ' ']]);
    await expect(dashboard(page)).toHaveCount(0);
    // The board's easy-reading list then fetches its rows with its own jumps.
    expect(await takeCapture(page)).toMatch(new RegExp('^s' + target + '\\r`\\f'));

    await drawMainMenu(page);
    await expect(dashboard(page)).toBeVisible();
    await expect.poll(() => offsetOf(page, before.name)).toBeCloseTo(before.offset, 0);
    expect((await topCard(page)).name).toBe(before.name);
  });
  // The owner's phone test (#191): `h` at home opened the help sheet, but the
  // page behind it switched to PTT's own help screen. The dashboard is the page
  // under the sheet for the whole visit, and no native help frame is ever drawn.
  // #222: once both help pages are read, the sheet sends one `q` behind itself
  // and stays open, detached from PTT; only the keys home takes can be picked.
  async function openDetachedHelp(page) {
    await bootHome(page);
    await drawMainMenu(page);
    await answerFetch(page);
    // Sample after layout of every painted frame (helpers/layout.installPaintedFrameProbe).
    await installPaintedFrameProbe(page);
    await page.evaluate(() => {
      window.__homeFrames = [];
      const sample = () => {
        const dash = document.getElementById('homeDashboard');
        const r = dash && dash.getBoundingClientRect();
        const lines = [...document.querySelectorAll('[data-type="bbsline"]')];
        window.__homeFrames.push({
          dashboard: !!r && r.height > 0 && getComputedStyle(dash).visibility !== 'hidden',
          scrollTop: dash ? Math.round(dash.scrollTop) : null,
          helpDrawn: lines.some((el) => el.textContent.includes('操作說明 (Help)')),
          sheet: !!document.querySelector('[data-sheet="help"]'),
          // Laid-out height (the slide's transform does not count).
          sheetH: document.querySelector('[data-sheet="help"]')?.offsetHeight || null,
          holding: window.__app.helpMenu.holding,
          phase: window.__app.helpMenu.phase,
        });
      };
      window.__stopHomeFrames = () => window.__paintedFrame.remove(sample);
      window.__paintedFrame.add(sample);
    });
    await page.locator('#t').focus();
    await imeCommit(page, 'h');
    await expect.poll(() => peekCapture(page)).toBe('h');
    expect(await takeCapture(page)).toBe('h');
    // The sheet opened at the keypress, before any of PTT's help screen.
    await expect(page.locator('[data-sheet="help"] [data-help-pending-text]')).toBeVisible();
    expect(await page.locator('[data-sheet="help"] [data-help-item]').count()).toBe(0);
    // The help menu asked from the main menu; its caption is the main menu's
    // own title, which no list fingerprint takes.
    const { perPage } = await drawHelpPage(page, 1, { caption: '主功能表' });
    await expect(page.locator('[data-sheet="help"] [data-help-item]')).toHaveCount(perPage);
    await expect.poll(() => peekCapture(page)).toBe('\x1b[6~');
    expect(await takeCapture(page)).toBe('\x1b[6~');
    await drawHelpPage(page, 2, { caption: '主功能表' });
    await expect(page.locator('[data-sheet="help"] [data-help-item]')).toHaveCount(ITEMS.length);
    // Every page read: one `q` behind the sheet, then PTT's main menu again.
    await expect.poll(() => peekCapture(page)).toBe('q');
    expect(await takeCapture(page)).toBe('q');
    await drawMainMenu(page);
    await page.waitForFunction(() => window.__app.helpMenu.phase === 'detached' && !window.__app.helpMenu.holding);
    await expect(page.locator('[data-sheet="help"]')).toBeVisible();
    // Home takes only its board search keys (s, S); every other row is dimmed.
    await expect(page.locator('[data-sheet="help"] [data-help-item]:not([data-unavailable])')).toHaveCount(2);
    await expect(page.locator('[data-sheet="help"] [data-help-item][data-unavailable]').first()).toBeDisabled();
    return page.evaluate(() => window.__homeFrames[0]);
  }

  async function homeFrames(page) {
    const before = await page.evaluate(() => window.__homeFrames.length);
    await page.waitForFunction((n) => window.__homeFrames.length > n + 8, before);
    return page.evaluate(() => {
      window.__stopHomeFrames();
      return window.__homeFrames;
    });
  }

  function expectHomeHeld(frames, first) {
    expect(frames.some((f) => f.sheet)).toBe(true);
    expect(frames.some((f) => f.holding)).toBe(true);
    expect(frames.some((f) => f.phase === 'detached' && f.sheet)).toBe(true);
    // Open before its rows, at one height throughout: the rows arriving move nothing.
    expect(frames.some((f) => f.phase === 'loading' && f.sheetH)).toBe(true);
    const heights = frames.filter((f) => f.sheetH).map((f) => f.sheetH);
    expect([...new Set(heights)]).toEqual([heights[0]]);
    expect(frames.filter((f) => !f.dashboard)).toEqual([]);
    expect(frames.filter((f) => f.helpDrawn)).toEqual([]);
    expect(frames.filter((f) => f.scrollTop !== first.scrollTop)).toEqual([]);
  }

  test('首頁用軟鍵盤打 h ⇒ 說明選單 sheet；讀完送一個 q 分離，關掉什麼都不送，每一幀面板都在、原生說明畫面一幀都沒畫', async ({ page }) => {
    const first = await openDetachedHelp(page);
    const b = await waitRectStable(page, '[data-sheet="help"] [data-help-close]');
    await page.touchscreen.tap(b.left + b.width / 2, b.top + b.height / 2);
    await expect(page.locator('[data-sheet="help"]')).toHaveCount(0);
    expectHomeHeld(await homeFrames(page), first);
    await expect(dashboard(page)).toBeVisible();
    expect(await takeCapture(page)).toBe('');
  });

  test('分離後點「找看板」⇒ sheet 收起、交給首頁開看板搜尋，PTT 只收到 h、PgDn、q，再來是 s', async ({ page }) => {
    const first = await openDetachedHelp(page);
    const row = page.locator('[data-sheet="help"] [data-help-item]', { hasText: '找看板' });
    await expect(row).toBeEnabled();
    await row.tap();
    await expect(page.locator('[data-sheet="help"]')).toHaveCount(0);
    // Home's own `s`: the board search sheet, which opens PTT's board-select
    // prompt with that same `s` (exactly what typing `s` at home sends).
    await expect(page.locator('[data-sheet="search"]')).toBeVisible();
    expectHomeHeld(await homeFrames(page), first);
    // This replay draws no board-select prompt, so on a slow run the open step
    // times out and the queue asks PTT for a redraw (^L) after the `s`.
    expect(await takeCapture(page)).toMatch(/^s\f?$/);
  });
});
