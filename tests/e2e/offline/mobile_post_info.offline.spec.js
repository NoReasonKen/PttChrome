// Article information on the phone (#261): 文章資訊 in a card's long-press
// sheet on the easy-reading article list, and in the More sheet of an
// easy-reading article. Either sends PTT's `Q` (bbs.c#view_postinfo), reads
// the box into the app's own sheet, and dismisses PTT's box with one space;
// over an article PTT has left the pager for the list, so Enter opens the
// article again at the reader's line. PTT's box never shows (the native grid
// guard sees no frame of it), the code and the address can be copied, an
// article without a code shows a hint instead, and after the sheet the next
// tap goes to the list or the article as usual.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js, whose
// box follows view_postinfo's rows.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const {
  bootNestedShortcutSearch, waitList, waitArticle, readToMiddle, topLine, tapCard, hinted
} = require('../helpers/article_shortcut_search');
const { recordHints } = require('../helpers/stack_routes');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const sheet = (page) => page.locator('[data-sheet="postInfo"]');
const sheetItem = (page, key) => page.locator(`[data-sheet="context"] [data-cmenu="${key}"]`);
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const rawSentSinceMark = (page) => page.evaluate(() => window.__gestureSent.slice(window.__sentMark));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const listActive = (page) => expect.poll(() => page.evaluate(() =>
  window.__app.listSession.state === 'active' && !window.__app.postInfo.busy)).toBe(true);
const idle = (page) => page.waitForFunction(() => !window.__app.postInfo.busy && window.__app.commandQueue.idle);

async function stubClipboard(page) {
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } }
    });
  });
}

async function openList(page, options = {}) {
  await stubClipboard(page);
  await bootNestedShortcutSearch(page, { startAtMain: true, ...options });
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
  await page.evaluate(() => window.__nativeGridGuard.reset());
}

// Long-press the card with `title`. Desktop Chromium sends no contextmenu for
// a CDP long press, so the event is made here (E2E_EXEMPT in
// tests/unit/e2e_real_input.test.js, as mobile_author_query does).
async function longPress(page, title) {
  await page.evaluate((title) => {
    const card = [...document.querySelectorAll('.main:not([data-stack-layer]) .listCard')]
      .find((c) => c.textContent.includes(title));
    const el = card.querySelector('.listCardBody') || card;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('contextmenu', {
      bubbles: true, cancelable: true, pointerType: 'touch',
      clientX: r.left + Math.min(r.width / 2, 20), clientY: r.top + r.height / 2
    }));
  }, title);
}

// What the reader sees at the top of the reading area, every frame: the first
// article row under any sheet or cover (elementsFromPoint looks through the
// sheet's overlay). Sampling stops with stopWatchingTop, which returns the
// distinct rows seen, in order.
async function watchTop(page) {
  await page.evaluate((main) => {
    const sample = () => {
      const r = document.querySelector(main).getBoundingClientRect();
      const row = document.elementsFromPoint(r.left + r.width / 2, r.top + 8)
        .map((el) => el.closest && el.closest('[type="bbsrow"]')).find(Boolean);
      return row ? row.textContent.trim().slice(0, 16) : null;
    };
    const seen = [];
    const tick = () => {
      const now = sample();
      if (seen[seen.length - 1] !== now) seen.push(now);
      if (window.__topWatch) window.__topWatch.raf = requestAnimationFrame(tick);
    };
    window.__topWatch = { seen, raf: 0 };
    tick();
  }, '.main:not([data-stack-layer])');
}

const stopWatchingTop = (page) => page.evaluate(() => {
  const w = window.__topWatch;
  window.__topWatch = null;
  cancelAnimationFrame(w.raf);
  return w.seen;
});

async function closeSheet(page) {
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
}

test.describe('article information on the phone', () => {
  test('a card\'s long-press sheet shows its information; the code and the address copy; the list stays as it was', async ({ page }) => {
    await openList(page);
    expect(await selectedNum(page)).toBe(101);
    await longPress(page, 'Delta topic');
    const item = sheetItem(page, 'postInfo');
    await expect(item).toHaveText(await text(page, 'postInfo_title'));
    await markSent(page);
    await item.tap();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('[data-post-info]')).toHaveAttribute('data-post-info', '1gIeu-3D');
    await expect(sheet(page).locator('[data-post-info-field="code"] [data-post-info-value]')).toHaveText('#1gIeu-3D (Test)');
    await expect(sheet(page).locator('[data-post-info-field="url"] [data-post-info-value]'))
      .toHaveText('https://www.ptt.cc/bbs/Test/M.1783270974.A.0CD.html');
    await expect(sheet(page).locator('[data-post-info-field="detail"]')).toHaveText(['這一篇文章值 40 Ptt幣']);
    await idle(page);
    // Cursor to that row, Q with no repaint, one space for the pressanykey.
    expect(await sentSinceMark(page)).toEqual(['104\r', 'Q', ' ']);
    expect(await rawSentSinceMark(page)).toContain('Q');
    expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('list');
    await sheet(page).locator('[data-post-info-copy="code"]').tap();
    await sheet(page).locator('[data-post-info-copy="url"]').tap();
    await expect.poll(() => page.evaluate(() => window.__copied)).toEqual([
      '#1gIeu-3D (Test)', 'https://www.ptt.cc/bbs/Test/M.1783270974.A.0CD.html'
    ]);
    await expect(sheet(page).locator('[data-post-info-copy="url"]')).toHaveText(await text(page, 'postInfo_copied'));
    await markSent(page);
    await closeSheet(page);
    // Closing the sheet sends nothing; the list kept its selection.
    expect(await sentSinceMark(page)).toEqual([]);
    await listActive(page);
    expect(await selectedNum(page)).toBe(104);
    expect(await guardHits(page)).toEqual([]);
    // The next tap goes to the list: it opens the card.
    await tapCard(page, 'Delta topic');
    await waitArticle(page, 'Delta');
  });

  test('More over an article shows its information and returns to the same line', async ({ page }) => {
    await openList(page);
    await tapCard(page, 'Alpha topic');
    await waitArticle(page, 'Alpha');
    const position = await readToMiddle(page);
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await markSent(page);
    await page.locator('[data-key="__more"]').tap();
    await page.locator('[data-key="__postInfo"]').tap();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('[data-post-info-field="code"] [data-post-info-value]')).toHaveText('#1gIeu-3A (Test)');
    await idle(page);
    // Q leaves the pager for the list (read_post's FULLUPDATE): a space for
    // the box, Enter for the article again.
    expect(await sentSinceMark(page)).toEqual(['Q', ' ', '\r']);
    expect((await rawSentSinceMark(page))[0]).toBe('Q');
    await waitArticle(page, 'Alpha');
    await expect.poll(() => topLine(page)).toBe(position);
    await sheet(page).locator('[data-post-info-copy="url"]').tap();
    await expect.poll(() => page.evaluate(() => window.__copied))
      .toEqual(['https://www.ptt.cc/bbs/Test/M.1783270974.A.0CA.html']);
    await markSent(page);
    await closeSheet(page);
    expect(await sentSinceMark(page)).toEqual([]);
    await expect.poll(() => topLine(page)).toBe(position);
    expect(await guardHits(page)).toEqual([]);
    // The article has its keys again: More offers the information again.
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-key="__postInfo"]')).toBeVisible();
  });

  test('the article stays at the reader\'s line every frame of the round trip', async ({ page }) => {
    // Long enough that easy reading reads it over more than one PTT page,
    // as the reopened article is read again from its top.
    await openList(page, { alphaLines: 60 });
    await tapCard(page, 'Alpha topic');
    await waitArticle(page, 'Alpha');
    const position = await readToMiddle(page);
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-key="__postInfo"]')).toBeVisible();
    await watchTop(page);
    await page.locator('[data-key="__postInfo"]').tap();
    await expect(sheet(page)).toBeVisible();
    await idle(page);
    await page.waitForFunction(() => !window.__app.easyReading._pendingScrollRestore &&
      !window.__app.buf.easyReadingFunctionMode && !window.__app.articleHold.holding);
    await expect.poll(() => topLine(page)).toBe(position);
    // One row seen the whole time: the article never showed its top (or
    // nothing) on the way back.
    const seen = await stopWatchingTop(page);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^Alpha line/);
  });

  test('an article\'s long-press sheet offers it; Q opens it with no focus ring', async ({ page }) => {
    await openList(page);
    await tapCard(page, 'Alpha topic');
    await waitArticle(page, 'Alpha');
    // Long-press an article row (synthesized: see longPress).
    await page.evaluate((main) => {
      const row = [...document.querySelectorAll(main + ' [type="bbsrow"]')]
        .find((r) => r.textContent.includes('Alpha line'));
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new PointerEvent('contextmenu', {
        bubbles: true, cancelable: true, pointerType: 'touch', clientX: r.left + 20, clientY: r.top + r.height / 2
      }));
    }, '.main:not([data-stack-layer])');
    const item = sheetItem(page, 'articlePostInfo');
    await expect(item).toHaveText(await text(page, 'postInfo_title'));
    const link = await sheetItem(page, 'copyArticleLink').evaluate((el) => el.nextElementSibling?.getAttribute('data-cmenu'));
    expect(link).toBe('articlePostInfo');
    await markSent(page);
    await item.tap();
    await expect(sheet(page)).toBeVisible();
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['Q', ' ', '\r']);
    await closeSheet(page);
    await waitArticle(page, 'Alpha');
    await page.waitForFunction(() => window.__app.postInfo.articleAvailable());
    // A typed Q (the key panel's, a keyboard's): the sheet opens with focus on
    // the information, so no copy button shows the keyboard's focus ring.
    await page.keyboard.press('Shift+Q');
    await expect(sheet(page).locator('[data-post-info]')).toBeVisible();
    await idle(page);
    await expect(sheet(page).locator('[data-post-info]')).toBeFocused();
    expect(await sheet(page).locator('[data-post-info-copy]:focus-visible').count()).toBe(0);
  });

  test('an article without a code shows the hint and no sheet', async ({ page }) => {
    await openList(page);
    await tapCard(page, 'Alpha topic');
    await waitArticle(page, 'Alpha');
    await page.evaluate(() => { window.__shortcutServer.state.open.noAid = true; });
    await markSent(page);
    await page.locator('[data-key="__more"]').tap();
    await page.locator('[data-key="__postInfo"]').tap();
    await expect.poll(async () => hinted(page, await text(page, 'postInfo_none'))).toBe(true);
    await idle(page);
    expect(await sentSinceMark(page)).toEqual(['Q', ' ', '\r']);
    await expect(sheet(page)).toHaveCount(0);
    await waitArticle(page, 'Alpha');
    expect(await guardHits(page)).toEqual([]);
  });
});
