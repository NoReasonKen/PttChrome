// Back from an article list reveals the page the board was opened from (#31):
// the home dashboard or a board list, usable at once while PTT is asked to go
// back, then replaced by the real page at the same reading position.
const { test, expect } = require('@playwright/test');
const { touchDrag, nextFrames } = require('../helpers/real_input');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { waitScrollStable, installPaintedFrameProbe } = require('../helpers/layout');
const ptt = require('../helpers/ptt');
const { loadCassette, waitFed, bootScenario } = require('../helpers/replay');
const {
  fedBefore, openNextArticle, holdBackReply, heldBack, homeBoard, boardList, listActive, dashboardVisible, bootDashboard, boardOpened,
  MAIN, boardListEngaged, bootBoardList, watchReveals, revealedSinceWatch, recordHints, recordedHints
} = require('../helpers/stack_routes');

const HOME_LAYER = '[data-stack-layer="home"]';
const UNDERLAY = '[data-article-exit-underlay]';

// Open C_Chat by tapping its favorite card, as the recording did.
async function enterBoardFromDashboard(page, cassette = homeBoard) {
  await bootDashboard(page, cassette);
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
}

// Leave the dashboard-entered board with PTT's reply held back.
async function revealDashboard(page, leave = () => ptt.sendKey(page, 'ArrowLeft')) {
  await enterBoardFromDashboard(page);
  const release = await holdBackReply(page);
  await leave();
  await heldBack(page);
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  return release;
}

test('Back from a board entered from the dashboard reveals the dashboard at once, and it holds its position after the swap', async ({ page }) => {
  const release = await revealDashboard(page);
  const layer = page.locator(HOME_LAYER);
  await expect(layer.locator('[data-home-board="C_Chat"]')).toBeVisible();
  // The revealed dashboard scrolls while PTT has not answered.
  const box = await layer.boundingBox();
  const x = box.x + box.width / 2;
  await touchDrag(page, { x, y: box.y + box.height - 40 }, { x, y: box.y + 60 }, 10);
  expect(await waitScrollStable(page, HOME_LAYER)).toBeGreaterThan(0);
  const anchor = await page.evaluate(sel => {
    const root = document.querySelector(sel);
    const top = root.getBoundingClientRect().top;
    const card = [...root.querySelectorAll('[data-home-board]')].find(c => c.getBoundingClientRect().bottom > top + 1);
    return { name: card.dataset.homeBoard, offset: card.getBoundingClientRect().top - top };
  }, HOME_LAYER);
  expect(await page.evaluate(() => window.__app.homeDashboard.state.visible)).toBe(false);
  await release();
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(UNDERLAY)).toHaveCount(0);
  const landed = await page.evaluate(name => {
    const root = document.getElementById('homeDashboard');
    const card = root.querySelector(`[data-home-board="${name}"]`);
    return card.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }, anchor.name);
  expect(Math.abs(landed - anchor.offset)).toBeLessThanOrEqual(1);
  await waitFed(page, homeBoard.steps.length);
});

const BOARD_LAYER = '[data-stack-layer="boardList"]:not([data-stack-parked])';

// The first card at the top of `root`'s view: its board and offset.
const topBoard = (page, root) => page.locator(root).evaluate(el => {
  const top = el.getBoundingClientRect().top;
  const card = [...el.querySelectorAll('.listCard[data-list-board]')].find(c => c.getBoundingClientRect().bottom > top + 1);
  return { board: card.dataset.listBoard, offset: card.getBoundingClientRect().top - top };
});

// Leave the board-list-entered board with PTT's reply held back.
async function revealBoardList(page) {
  await bootBoardList(page);
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  return release;
}

test('Back from a board entered from a board list reveals that board list at once, at the same entry after the swap', async ({ page }) => {
  const release = await revealBoardList(page);
  const layer = page.locator(BOARD_LAYER);
  const before = await topBoard(page, BOARD_LAYER);
  const box = await layer.boundingBox();
  const x = box.x + box.width / 2;
  // The list lands at its end (the cursor's board is near the bottom), so scroll it back.
  await touchDrag(page, { x, y: box.y + 60 }, { x, y: box.y + box.height - 40 }, 10);
  await waitScrollStable(page, `${BOARD_LAYER} .listBodyView`);
  const scrolled = await topBoard(page, BOARD_LAYER);
  expect(scrolled).not.toEqual(before);
  await release();
  await expect(layer).toHaveCount(0, { timeout: 10000 });
  await boardListEngaged(page);
  const after = await topBoard(page, MAIN);
  expect(after.board).toBe(scrolled.board);
  expect(Math.abs(after.offset - scrolled.offset)).toBeLessThanOrEqual(1);
  await waitFed(page, boardList.steps.length);
});

const sentSince = (page, n) => page.evaluate(n => window.__replay.sent.slice(n), n);
const sentCount = page => page.evaluate(() => window.__replay.sent.length);

test('a board reached by search reveals no lower page', async ({ page }) => {
  await bootDashboard(page);
  await page.locator('[data-key="__search"]').tap();
  const input = page.locator('input[name="searchKeyword"]');
  await input.fill('C_Chat');
  await input.press('Enter');
  await boardOpened(page);
  await watchReveals(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await dashboardVisible(page);
  expect(await revealedSinceWatch(page)).toBe(false);
});

test('a board tapped on the revealed dashboard opens after the swap', async ({ page }) => {
  const release = await revealDashboard(page);
  const before = await sentCount(page);
  await page.locator(`${HOME_LAYER} [data-home-board="Fav2"]`).tap();
  // The leave itself may still sync PTT's screen; no board search starts.
  expect((await sentSince(page, before)).join('')).not.toContain('s');
  await release();
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  // The dashboard's own open: a board search for the tapped board.
  await expect.poll(async () => (await sentSince(page, before)).join('')).toContain('s');
});

test('a Back after a tap on the revealed dashboard replaces the tap, though nothing is below it', async ({ page }) => {
  const release = await revealDashboard(page);
  const before = await sentCount(page);
  await page.locator(`${HOME_LAYER} [data-home-board="Fav2"]`).tap();
  await ptt.sendKey(page, 'ArrowLeft');
  await release();
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await nextFrames(page, 10);
  expect((await sentSince(page, before)).join('')).not.toContain('s');
});

// Tap Fav2 on the revealed dashboard; once the real one is shown (a finger
// holds the swap), change it with `alter`, then swap.
async function tapRevealedThen(page, alter) {
  const release = await revealDashboard(page);
  const fav = page.locator(`${HOME_LAYER} [data-home-board="Fav2"]`);
  await fav.tap();
  const box = await fav.boundingBox();
  const contact = await beginArticleTouch(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await release();
  await page.waitForFunction(() => window.__app.homeDashboard.state.visible === true);
  await page.evaluate(alter);
  const before = await sentCount(page);
  await contact.release({ cancel: true });
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  return before;
}

test('a board tapped on the revealed dashboard but gone from the real one gives a notice and opens nothing', async ({ page }) => {
  const before = await tapRevealedThen(page, () => {
    const home = window.__app.homeDashboard;
    home._set({ boards: home.state.boards.filter(b => b.name !== 'Fav2') });
  });
  await expect(page.locator('.ListHint')).toHaveText('That board is no longer in the list');
  await page.waitForTimeout(1000); // sleep-ok: proves no board search is sent afterwards
  expect((await sentSince(page, before)).join('')).not.toContain('s');
});

test('a board tapped on the revealed dashboard while the real one is updating says so and opens nothing', async ({ page }) => {
  const before = await tapRevealedThen(page, () => window.__app.homeDashboard._set({ fetching: true }));
  await expect(page.locator('.ListHint')).toHaveText('Updating…');
  await page.waitForTimeout(1000); // sleep-ok: proves no board search is sent afterwards
  expect((await sentSince(page, before)).join('')).not.toContain('s');
});

test('the real dashboard never covers the revealed one before the swap', async ({ page }) => {
  const release = await revealDashboard(page);
  const box = await page.locator(HOME_LAYER).boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A finger down defers the swap after the real dashboard is shown.
  const contact = await beginArticleTouch(page, center);
  // Every painted frame until the copy is gone shows the copy on top.
  await installPaintedFrameProbe(page);
  await page.evaluate(({ x, y }) => {
    window.__covered = 0;
    window.__realFrames = 0;
    const sample = () => {
      if (!document.querySelector('[data-stack-layer="home"]')) return window.__paintedFrame.remove(sample);
      if (!window.__app.homeDashboard.state.visible) return;
      window.__realFrames += 1;
      if (!document.elementFromPoint(x, y)?.closest('[data-stack-layer="home"]')) window.__covered += 1;
    };
    window.__paintedFrame.add(sample);
  }, center);
  await release();
  await page.waitForFunction(() => window.__app.homeDashboard.state.visible === true);
  await nextFrames(page, 3);
  await contact.release({ cancel: true });
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  expect(await page.evaluate(() => window.__realFrames)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__covered)).toBe(0);
});

test('a board tapped on the revealed board list opens after the swap', async ({ page }) => {
  const release = await revealBoardList(page);
  const target = await topBoard(page, BOARD_LAYER);
  const before = await sentCount(page);
  await page.locator(`${BOARD_LAYER} .listCard[data-list-board="${target.board}"] .listCardBody`).tap();
  // The leave itself may still sync PTT's screen; no board opens.
  expect((await sentSince(page, before)).join('')).not.toContain('\r');
  await release();
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect.poll(async () => (await sentSince(page, before)).join('')).toContain('\r');
});

test('a board tapped on the revealed board list but gone from the real one gives a notice and opens nothing', async ({ page }) => {
  const release = await revealBoardList(page);
  const target = await topBoard(page, BOARD_LAYER);
  const card = await page.locator(`${BOARD_LAYER} .listCard[data-list-board="${target.board}"]`).elementHandle();
  // Stand-in for a board removed from the list while it was revealed.
  await card.evaluate(el => { el.dataset.listBoard = 'GoneBoard'; });
  await (await card.$('.listCardBody')).tap();
  await release();
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.ListHint')).toHaveText('That board is no longer in the list');
  const before = await sentCount(page);
  await page.waitForTimeout(1000); // sleep-ok: proves no open is sent afterwards
  expect(await sentSince(page, before)).toEqual([]);
});

test('system Back reveals the dashboard the same way as ←', async ({ page }) => {
  const release = await revealDashboard(page, () => page.goBack());
  await release();
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
});

const homeNext = loadCassette('scn-stack-home-next');

const articleRead = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.easyReading.easyReadingReachedPageEnd && app.commandQueue.idle && !app.buf._settleTimer;
});

// Back from the full list reveals the dashboard, which takes over after the swap.
async function backRevealsDashboard(page, cassette) {
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  await release();
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitFed(page, cassette.steps.length);
}

test('after switching to the next article, its list still reveals the dashboard', async ({ page }) => {
  await enterBoardFromDashboard(page, homeNext);
  for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
  await ptt.sendKey(page, 'Enter');
  await articleRead(page);
  await openNextArticle(page, homeNext);
  await articleRead(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitFed(page, fedBefore(homeNext, 'back', 2));
  await listActive(page);
  await backRevealsDashboard(page, homeNext);
});

// A board list shown again from its live layer stays as the reader left it
// (#122): PTT's answer to Back only brings PTT into step with it.

// The recorded route with PTT's replies rewritten, as if the list had changed
// while the reader was in the board: `edits[step]` lists [from, to] byte
// strings (Big5 as latin1) replaced in that step's reply.
function withReplies(cassette, edits) {
  const copy = JSON.parse(JSON.stringify(cassette));
  for (const [step, pairs] of Object.entries(edits)) {
    let recv = Buffer.from(copy.steps[step].recv, 'base64').toString('latin1');
    for (const [from, to] of pairs) {
      if (!recv.includes(from)) throw new Error(`step ${step} has no ${JSON.stringify(from)}`);
      recv = recv.split(from).join(to);
    }
    copy.steps[step].recv = Buffer.from(recv, 'latin1').toString('base64');
  }
  return copy;
}

// A board row's unread mark ˇ (Big5 A3BE), between its number and its name.
const markUnread = (num, board) => [`${num}   ${board}`, `${num} \xa3\xbe${board}`];
// MayClass (21) is the recorded board. Its newest article, 338, is read in the
// recording; this marks it unread.
const NEWEST_UNREAD = ['>   338  \x1b', '>   338 +\x1b'];
// MayClass unread on every page PTT showed before it was opened.
const MAYCLASS_UNREAD = { 0: [markUnread(21, 'MayClass')], 1: [markUnread(21, 'MayClass')], 3: [markUnread(21, 'MayClass')] };
// PTT's answer to Back (step 5) also shows MayClass's popularity, from the
// reader's own visit, which the list had not shown.
const BACK = 5;

async function bootBoardListOf(page, route) {
  await bootScenario(page, ptt, route);
  await ptt.applyPrefs(page, { enableEasyReadingList: true, enableBoardListSmoothScroll: true, refreshMinIntervalSec: 0 });
  await boardListEngaged(page);
}

// What each board card shows, which board is selected, and how far the list
// is scrolled.
const boardPage = (page, root = MAIN) => page.locator(root).evaluate(el => {
  const cards = [...el.querySelectorAll('.listCard[data-list-board]')];
  return {
    boards: cards.map(card => {
      const rest = card.cloneNode(true);
      rest.querySelector('.listCardMark')?.remove();
      return {
        board: card.dataset.listBoard,
        unread: !!card.querySelector('.listCardMark')?.textContent.includes('ˇ'),
        text: rest.textContent
      };
    }),
    selected: cards.find(card => card.querySelector('.listCardCursor')?.textContent.trim() === '>')?.dataset.listBoard,
    scrollTop: el.querySelector('.listBodyView').scrollTop
  };
});

// Open the selected board, then go back with PTT's answer held until the
// board list is revealed; returns the board list once the real one took over.
async function openAndBack(page, route) {
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  await release();
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await boardListEngaged(page);
  await waitFed(page, route.steps.length);
  return boardPage(page);
}

// Every row's text and order, the selection and the scroll position equal
// `before`, except the unread marks in `unread`.
function expectKept(after, before, unread) {
  expect(after.boards).toEqual(before.boards.map(b => (b.board in unread ? { ...b, unread: unread[b.board] } : b)));
  expect(after.selected).toBe(before.selected);
  expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);
}

test('Back to a board list keeps every row as it was; the visited board shows read once its newest article was read', async ({ page }) => {
  // PTT's answer marks NTUHI unread and still marks MayClass unread.
  const route = withReplies(boardList, { ...MAYCLASS_UNREAD, [BACK]: [markUnread(21, 'MayClass'), markUnread(23, 'NTUHI')] });
  await bootBoardListOf(page, route);
  const before = await boardPage(page);
  expect(before.selected).toBe('MayClass');
  expect(before.boards.find(b => b.board === 'MayClass').unread).toBe(true);
  expectKept(await openAndBack(page, route), before, { MayClass: false });
});

test('Back to a board list marks the visited board unread when its newest article is unread', async ({ page }) => {
  const route = withReplies(boardList, { 4: [NEWEST_UNREAD] });
  await bootBoardListOf(page, route);
  const before = await boardPage(page);
  expect(before.boards.find(b => b.board === 'MayClass').unread).toBe(false);
  expectKept(await openAndBack(page, route), before, { MayClass: true });
});

test('refreshing the board list shown again replaces its rows with PTT\'s current ones', async ({ page }) => {
  const route = withReplies(boardList, { [BACK]: [markUnread(23, 'NTUHI')] });
  await bootBoardListOf(page, route);
  const kept = await openAndBack(page, route);
  expect(kept.boards.find(b => b.board === 'NTUHI').unread).toBe(false);
  // The keyword prompt, then the reloaded list: PTT's page of MayClass with
  // NTUHI unread.
  const reloaded = withReplies(boardList, { 3: [markUnread(23, 'NTUHI')] }).steps[3].recv;
  await page.evaluate(reloaded => {
    const big5 = text => [...text].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 0x80 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    const send = window.__stubWSSent;
    window.__stubWSSent = data => {
      send(data);
      const keys = data.replace(/\f$/, '');
      if (keys === '/') window.__app.onData('\x1b[23;1H\x1b[K' + big5('請輸入看板中文關鍵字: '));
      else if (keys === '\r') window.__app.onData(atob(reloaded));
    };
  }, reloaded);
  await page.locator('[data-key="__refresh"]').tap();
  await expect.poll(async () => (await boardPage(page)).boards.find(b => b.board === 'NTUHI').unread).toBe(true);
});

// PTT answers each key in `replies` ({ keys: recv }) with that recorded
// reply, base64 as in a cassette.
const answerKeys = (page, replies) => page.evaluate(replies => {
  const send = window.__stubWSSent;
  window.__stubWSSent = data => {
    send(data);
    const keys = data.replace(/\f$/, '');
    if (keys in replies) window.__app.onData(atob(replies[keys]));
  };
}, replies);

// An in-place key acts on the selected board only (#125): its row takes PTT's
// rendering, and every other row stays as the reader left it.
test('marking the selected board unread on the board list shown again changes only its row', async ({ page }) => {
  const route = withReplies(boardList, { ...MAYCLASS_UNREAD, [BACK]: [markUnread(21, 'MayClass'), markUnread(23, 'NTUHI')] });
  await bootBoardListOf(page, route);
  const kept = await openAndBack(page, route);
  expect(kept.selected).toBe('MayClass');
  expect(kept.boards.find(b => b.board === 'MayClass').unread).toBe(false);
  expect(kept.boards.find(b => b.board === 'NTUHI').unread).toBe(false);
  // `V` marks the board unread; PTT redraws its page, NTUHI unread there too.
  await answerKeys(page, { V: route.steps[BACK].recv });
  await ptt.sendKey(page, 'V');
  await expect.poll(async () => (await boardPage(page)).boards.find(b => b.board === 'MayClass').unread).toBe(true);
  await boardListEngaged(page);
  // MayClass's row is PTT's now, with the popularity of the reader's visit.
  const now = await boardPage(page);
  expect(now.boards.find(b => b.board === 'MayClass')).toMatchObject({ unread: true, text: expect.stringContaining('MayClass課程1') });
  const others = page => ({ ...page, boards: page.boards.filter(b => b.board !== 'MayClass') });
  expectKept(others(now), others(kept), {});
});

// PTT's answer to Back lists boards whose unread marks differ from the board
// list shown again: a brief notice says so (#128), without asking PTT for
// anything more. The visited board's own mark follows what was read there.
const NEW_ARTICLES = 'New articles';

// Opens the selected board and goes back as openAndBack does; returns the
// notices shown and what was sent to PTT from Back on.
async function noticesOnBack(page, route) {
  await bootBoardListOf(page, route);
  await recordHints(page);
  await ptt.sendKey(page, 'Enter');
  await listActive(page);
  const from = await sentCount(page);
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await release();
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await boardListEngaged(page);
  await waitFed(page, route.steps.length);
  await page.waitForTimeout(500); // sleep-ok: anything sent or shown after the swap is by now
  return { hints: await recordedHints(page), sent: await sentSince(page, from) };
}

test('Back to a board list whose boards PTT now marks differently shows a brief notice, and sends nothing more', async ({ page }) => {
  const { hints, sent } = await noticesOnBack(page, withReplies(boardList, { [BACK]: [markUnread(23, 'NTUHI')] }));
  expect(hints.filter(text => text === NEW_ARTICLES)).toHaveLength(1);
  await expect(page.locator('.ListHint')).toHaveText(NEW_ARTICLES);
  expect(sent).toEqual(['\x1b[D']);
});

test('Back to a board list shows no notice when only the visited board is marked differently', async ({ page }) => {
  const route = withReplies(boardList, { ...MAYCLASS_UNREAD, [BACK]: [markUnread(21, 'MayClass')] });
  const { hints, sent } = await noticesOnBack(page, route);
  expect(hints).not.toContain(NEW_ARTICLES);
  expect(sent).toEqual(['\x1b[D']);
});

test('Back to the home dashboard shows no new-articles notice', async ({ page }) => {
  await enterBoardFromDashboard(page);
  await recordHints(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitFed(page, homeBoard.steps.length);
  expect(await recordedHints(page)).not.toContain(NEW_ARTICLES);
});
