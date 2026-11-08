// A failed check in an article list or a board list (a timeout, a cursor that
// does not land on the chosen row) leaves the reader on the page they were on
// (#158): the list stays drawn and never switches to the native view, a notice
// says what failed, the debug recording logs a bug event, nothing more is sent
// to PTT, and a refresh (pull-to-refresh or the toolbar's) presents the list
// again from PTT's current screen.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette } = require('../helpers/replay');
const { touchDrag } = require('../helpers/real_input');
const { waitRectStable } = require('../helpers/layout');
const {
  MAIN, ARTICLE_CARD, bootArticleList, bootArticleListAtCard, bootBoardList, listActive, recordHints, recordedHints
} = require('../helpers/stack_routes');

const RETRY = '，下拉重新整理以重試';
const listNav = loadCassette('cchat-list-nav');
const boardList = loadCassette('scn-stack-boardlist-board');

// Every bug event the debug recording would log, and every key sent, from now on;
// the list itself is watched for ever leaving its own presentation.
async function watchFailure(page) {
  await recordHints(page);
  await page.evaluate(() => {
    const app = window.__app;
    window.__bugs = [];
    window.__keys = [];
    window.__wentNative = false;
    app.debugRecorder = { isRecording: true, log: (tag, info) => tag === 'bug' && window.__bugs.push(info) };
    window.__replySent = window.__stubWSSent;
    window.__stubWSSent = (data) => {
      window.__keys.push(data);
      window.__replySent(data);
    };
    const watch = () => {
      if (app.buf.listRenderMode === 'native') window.__wentNative = true;
      if (!window.__stopWatch) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
}

// PTT never answers from now on.
const dropReplies = page => page.evaluate(() => { window.__replySent = () => {}; });

// PTT answers again; its repaint (Ctrl-L) shows `screen`.
const answerRepaintWith = (page, screen) =>
  page.evaluate((screen) => {
    const replay = window.__replySent;
    window.__replySent = () => {};
    window.__stubWSSent = (data) => {
      window.__keys.push(data);
      if (data === '\f') return window.__app.onData(atob(screen));
      replay(data);
    };
  }, screen);

const sentSince = (page, n) => page.evaluate((n) => window.__keys.slice(n), n);
const keyCount = page => page.evaluate(() => window.__keys.length);

async function expectHeld(page, session, message) {
  await expect.poll(() => recordedHints(page), { timeout: 15000 }).toContain(message + RETRY);
  expect(await page.evaluate((s) => window.__app[s].failed(), session)).toBe(true);
  expect(await page.evaluate(() => window.__wentNative)).toBe(false);
  await expect(page.locator(`${MAIN} .listBodyView`)).toBeVisible();
  const bugs = await page.evaluate(() => window.__bugs);
  expect(bugs).toEqual([expect.objectContaining({ reason: message })]);
}

async function refreshFromToolbar(page) {
  await ptt.applyPrefs(page, { refreshMinIntervalSec: 0 });
  await page.locator('[data-key="__refresh"]').tap();
}

test.describe('article list', () => {
  test('an open PTT never answers keeps the list; a refresh presents it again', async ({ page }) => {
    await bootArticleListAtCard(page);
    await watchFailure(page);
    const scrollTop = await page.locator(`${MAIN} .listBodyView`).evaluate(el => el.scrollTop);
    await dropReplies(page);
    await page.locator(ARTICLE_CARD).first().tap();
    await expectHeld(page, 'listSession', '開啟文章失敗');
    expect(await page.locator(`${MAIN} .listBodyView`).evaluate(el => el.scrollTop)).toBeCloseTo(scrollTop, -1);

    await answerRepaintWith(page, listNav.steps[0].recv);
    await refreshFromToolbar(page);
    await listActive(page);
    expect(await page.evaluate(() => window.__app.listSession.failed())).toBe(false);
    await expect(page.locator(`${MAIN} .listBodyView > span.listCard`).first()).toBeVisible();
    expect(await page.evaluate(() => window.__wentNative)).toBe(false);
  });

  test('a cursor landing on another article sends nothing more and keeps the list', async ({ page }) => {
    await bootArticleList(page);
    await ptt.sendKey(page, 'ArrowUp');
    await ptt.sendKey(page, 'ArrowUp');
    await watchFailure(page);
    // PTT parks on the selected number, but the entry there is another article
    // by then: PTT's first entry row, another article, now carries that number.
    await page.evaluate(() => {
      window.__replySent = (data) => {
        const m = /^(\d+)\r/.exec(data);
        if (!m) return;
        const row = window.__app.buf.lines[3].map(c => c.ch).join('');
        const at = /\d+/.exec(row);
        const col = at.index + at[0].length - m[1].length;
        window.__app.onData(`\x1b[4;${col + 1}H${m[1]}\x1b[4;1H>\x1b[4;1H`);
      };
    });
    const before = await keyCount(page);
    await ptt.sendKey(page, 't');
    await expectHeld(page, 'listSession', '列表已變動，游標對不上選取的文章');
    const sent = await sentSince(page, before);
    expect(sent.some(d => /^\d+\r/.test(d))).toBe(true);
    expect(sent).not.toContain('t');
  });

  test('pull-to-refresh at the top of a failed list presents it again', async ({ page }) => {
    await bootArticleList(page);
    await page.locator(`${MAIN} .listBodyView`).evaluate(el => { el.scrollTop = 0; });
    await watchFailure(page);
    await dropReplies(page);
    await ptt.sendKey(page, 't');
    await expect.poll(() => page.evaluate(() => window.__app.listSession.failed()), { timeout: 15000 }).toBe(true);
    await page.locator(`${MAIN} .listBodyView`).evaluate(el => { el.scrollTop = 0; });

    await answerRepaintWith(page, listNav.steps[0].recv);
    const r = await waitRectStable(page, `${MAIN} .listBodyView`);
    const x = r.left + r.width / 2;
    const y = r.top + 40;
    await touchDrag(page, { x, y }, { x, y: y + 260 });
    await listActive(page);
    expect(await page.evaluate(() => window.__app.listSession.failed())).toBe(false);
    expect(await page.evaluate(() => window.__wentNative)).toBe(false);
  });
});

test.describe('board list', () => {
  test('entering a board PTT never answers keeps the board list; a refresh presents it again', async ({ page }) => {
    await bootBoardList(page);
    await watchFailure(page);
    await dropReplies(page);
    await ptt.sendKey(page, 'Enter');
    await expectHeld(page, 'boardListSession', '進入看板逾時');
    await expect(page.locator('[data-stack-entry-underlay], [data-stack-layer]:not([data-stack-parked])')).toHaveCount(0);

    await answerRepaintWith(page, boardList.steps[1].recv);
    await refreshFromToolbar(page);
    await page.waitForFunction(() => {
      const app = window.__app;
      return app.boardListSession.state === 'active' && app.buf.listRenderOwner === 'board-list';
    });
    expect(await page.evaluate(() => window.__app.boardListSession.failed())).toBe(false);
    expect(await page.evaluate(() => window.__wentNative)).toBe(false);
  });

  test('a cursor parked on another board sends nothing more and keeps the board list', async ({ page }) => {
    await bootBoardList(page);
    await ptt.sendKey(page, 'ArrowDown');
    await watchFailure(page);
    // PTT parks the cursor on another row than the one jumped to.
    await page.evaluate((elsewhere) => {
      window.__replySent = (data) => {
        if (/^\d+\r/.test(data)) window.__app.onData(atob(elsewhere));
      };
    }, boardList.steps[2].recv);
    const before = await keyCount(page);
    await ptt.sendKey(page, 'Enter');
    await expectHeld(page, 'boardListSession', '進入看板逾時');
    const sent = await sentSince(page, before);
    expect(sent.some(d => /^\d+\r/.test(d))).toBe(true);
    expect(sent).not.toContain('\r');
  });
});
