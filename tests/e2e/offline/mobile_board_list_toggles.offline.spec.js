// The easy-reading board list's view switches on a phone (#221): the More
// sheet offers PTT's `c` (show article counts / board numbers) on the
// favorites and a class's boards, and `S`: PTT's by-name / by-class sort on a
// class's boards; on the favorites, a reorder that rewrites their saved order,
// asked in a confirmation sheet first.
// The list stays on screen while PTT answers, then is rebuilt from PTT's new
// page alone. The native grid guard (helpers/native_grid_guard.js, installed
// by bootOffline) fails the test if a native frame is painted on the way.
//
// Screens are drawn from board.c#show_brdlist: the article-count view prints
// each board's total in the number column under the header 總數. Board names,
// descriptions and totals are invented.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, waitScreenSettled } = require('../helpers/replay');
const { startCapture, peekCapture, takeCapture } = require('../helpers/capture');
const { touchDrag } = require('../helpers/real_input');
const { waitRectStable } = require('../helpers/layout');
const { MAIN, boardListEngaged } = require('../helpers/stack_routes');

const LEFT = '\x1b[D';

const REV = '\x1b[7m';
const OFF = '\x1b[0m';
const width = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x80 ? 1 : 2), 0);
const padCells = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
const at = (row, col) => '\x1b[' + row + ';' + (col || 1) + 'H';

async function feed(page, data) {
  await page.evaluate((data) => {
    let out = '';
    for (const ch of data) {
      const c = ch.charCodeAt(0);
      if (c < 0x80) {
        out += ch;
        continue;
      }
      out += String.fromCharCode(window.lib.u2bArray[2 * c]) + String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
    }
    window.__app.onData(out);
  }, data);
}

// A list in its first order, with an invented article total each.
const BOARDS = [
  ['AlphaTest', 120],
  ['BravoTest', 4521],
  ['CharlieTest', 87],
];

// The favorites (`kind: 'fav'`) or a class's boards (`kind: 'class'`, the
// hot-key row and footer of board.c's board_fav_cmds): `order` is the boards
// from position 1, `counts` draws the article-count view, PTT's cursor on
// position `cursor`.
async function drawList(page, { kind = 'fav', order = BOARDS, counts = false, cursor = 1 } = {}) {
  let d = '\x1b[H\x1b[2J';
  d += at(1) + REV + padCells('【看板列表】                     批踢踢實業坊', 80) + OFF;
  d += at(2) + (kind === 'fav'
    ? '[←][q]回上層 [→][r]閱讀 [↑↓]選擇 [PgUp][PgDn]翻頁 [c]新文章 [/]搜尋 [h]求助'
    : '[y]只列最愛 [→]進入 [s]找看板 [/]搜尋 [c]新文章 [S]排序 [PgUp]上頁 [PgDn]下頁');
  d += at(3) + REV + padCells('   ' + (counts ? '總數' : '編號') + '   看  板       類別   中   文   敘   述               人氣 板   主', 80) + OFF;
  order.forEach(([name, total], i) => {
    const head = String(counts ? total : i + 1).padStart(7, ' ') + '   ';
    d += at(4 + i) + (i + 1 === cursor ? '>' + head.slice(1) : head) + name.padEnd(13, ' ') + '綜合 ◎' + padCells('測試用看板', 34) + 'HOT someone';
  });
  d += at(24) + REV + (kind === 'fav'
    ? padCells('  選擇看板    (a)增加看板 (s)進入已知板名 (y)列出全部 (v/V)已讀/未讀', 79)
    : padCells(' 看板列表  (m)加入最愛 (v)已讀/未讀 (t)標記                 (←)回上層 (h)說明', 79)) + OFF;
  d += at(3 + cursor);
  await feed(page, d);
  await waitScreenSettled(page, { 0: '看板列表', 2: counts ? '總數' : '編號' });
}

// Keys the app sent since the last take, once they end with `tail`. Its
// Ctrl+L (\f, ask PTT to repaint) is dropped.
async function sent(page, tail) {
  await expect.poll(() => peekCapture(page)).toContain(tail);
  return (await takeCapture(page)).replace(/\f/g, '');
}

const cardsIn = (page) => page.locator(`${MAIN} .listCard[data-list-board]`).evaluateAll(
  cards => cards.map(card => card.dataset.listBoard));
const namesOf = (order) => order.map(([name]) => name);
const NAMES = namesOf(BOARDS);

// A list rebuilt from one page does not know its end yet: it probes past its
// last row, and PTT clamps onto the last board (stuff.c#search_num).
async function answerProbe(page, opts = {}) {
  const order = opts.order || BOARDS;
  expect(await sent(page, '\r')).toBe(String(order.length + 1) + '\r');
  await drawList(page, { ...opts, cursor: order.length });
  await boardListEngaged(page);
}

// The list engaged in easy reading, its first page answered.
async function openList(page, kind = 'fav') {
  await bootOffline(page, ptt);
  await startCapture(page);
  await drawList(page, { kind });
  await answerProbe(page, { kind });
  await expect.poll(() => cardsIn(page)).toEqual(NAMES);
}

// Open More and tap `key`; its label.
async function tapMore(page, key) {
  await page.locator('#mobileToolbar [data-key="__more"]').tap();
  const item = page.locator(`[data-key="${key}"]`);
  await expect(item).toBeVisible();
  const label = await item.textContent();
  await item.tap();
  return label;
}

const session = (page) => page.evaluate(() => {
  const s = window.__app.boardListSession;
  return { selected: s._selectedNum, renderMode: s._renderMode, counts: !!s._newflag, state: s.state };
});
const selectedNum = async (page) => (await session(page)).selected;

// `c` from the More sheet through to the article-count view.
async function toCounts(page, kind) {
  const sel = await selectedNum(page);
  const label = await tapMore(page, '__boardCounts');
  expect(await sent(page, 'c')).toBe('c');
  // PTT has not answered: the cards stay.
  await expect.poll(() => cardsIn(page)).toEqual(NAMES);
  expect((await session(page)).renderMode).toBe('frozen');
  await drawList(page, { kind, counts: true });
  expect(await sent(page, '\r')).toBe(sel + '\r');
  await drawList(page, { kind, counts: true, cursor: sel });
  await boardListEngaged(page);
  await answerProbe(page, { kind, counts: true });
  await expect.poll(() => cardsIn(page)).toEqual(NAMES);
  expect(await selectedNum(page)).toBe(sel);
  await expect(page.locator(`${MAIN} .listCard[data-list-board="BravoTest"]`)).toContainText('4521');
  return label;
}

test('favorites, More → show article counts: the list stays on screen while PTT answers, then shows the totals', async ({ page }) => {
  await openList(page, 'fav');
  const sel = await selectedNum(page);
  const before = await toCounts(page, 'fav');

  // The label now offers the numbers back, and `c` again returns to them.
  const after = await tapMore(page, '__boardCounts');
  expect(after).not.toBe(before);
  expect(await sent(page, 'c')).toBe('c');
  await drawList(page);
  expect(await sent(page, '\r')).toBe(sel + '\r');
  await drawList(page, { cursor: sel });
  await boardListEngaged(page);
  await answerProbe(page);
  await expect.poll(() => cardsIn(page)).toEqual(NAMES);
  await expect(page.locator(`${MAIN} .listCard[data-list-board="BravoTest"]`)).not.toContainText('4521');
});

test('a class\'s boards, More → switch sort: the list is rebuilt in PTT\'s new order, the selected board kept', async ({ page }) => {
  await openList(page, 'class');
  const sel = await selectedNum(page);
  const selName = BOARDS[sel - 1][0];
  await tapMore(page, '__boardSort');
  expect(await sent(page, 'S')).toBe('S');
  await expect.poll(() => cardsIn(page)).toEqual(NAMES);

  const reordered = BOARDS.slice().reverse();
  await drawList(page, { kind: 'class', order: reordered });
  expect(await sent(page, '\r')).toBe(sel + '\r');
  await drawList(page, { kind: 'class', order: reordered, cursor: sel });
  await boardListEngaged(page);
  await answerProbe(page, { kind: 'class', order: reordered });
  await expect.poll(() => cardsIn(page)).toEqual(namesOf(reordered));
  const now = await selectedNum(page);
  expect(reordered[now - 1][0]).toBe(selName);
});

async function edgeSwipe(page) {
  const main = await waitRectStable(page, MAIN);
  const y = main.top + main.height / 2;
  await touchDrag(page, { x: 20, y }, { x: page.viewportSize().width - 20, y }, 12);
}

// PTT's `c` lasts while its list is open (choose_board's own `newflag`): a
// group opened from the count view is numbered, and Back reloads the outer
// list still in the count view, PTT's cursor on the first unread board from
// the row opened (board.c#brdlist_loader).
test('a class\'s boards in the count view → a group → Back: easy reading throughout, the count view and the row kept', async ({ page }) => {
  await openList(page, 'class');
  await toCounts(page, 'class');

  // The group on row 2 opens: PTT's cursor is synced to it, then Enter.
  await page.locator(`${MAIN} .listCard[data-list-board="BravoTest"] .listCardBody`).tap();
  expect(await sent(page, '2\r')).toBe('2\r');
  await drawList(page, { kind: 'class', counts: true, cursor: 2 });
  expect(await sent(page, '\r')).toBe('\r');
  const inner = [['InnerOne', 5], ['InnerTwo', 9]];
  await drawList(page, { kind: 'class', order: inner });
  await answerProbe(page, { kind: 'class', order: inner });
  await expect.poll(() => cardsIn(page)).toEqual(namesOf(inner));
  expect((await session(page)).counts).toBe(false);

  // Back: PTT reloads the outer list in its count view, its cursor on the
  // first unread board from row 2 (here 3); the app sends it back to 2.
  // (The selection, 1, is synced first: the fill's probe left PTT's cursor on 2.)
  await edgeSwipe(page);
  expect(await sent(page, '1\r')).toBe('1\r');
  await drawList(page, { kind: 'class', order: inner, cursor: 1 });
  expect(await sent(page, LEFT)).toBe(LEFT);
  await drawList(page, { kind: 'class', counts: true, cursor: 3 });
  expect(await sent(page, '\r')).toBe('2\r');
  expect((await session(page)).renderMode).toBe('frozen');
  await drawList(page, { kind: 'class', counts: true, cursor: 2 });
  await boardListEngaged(page);
  await answerProbe(page, { kind: 'class', counts: true });
  await expect.poll(() => cardsIn(page)).toEqual(NAMES);
  expect(await session(page)).toMatchObject({ selected: 2, counts: true, renderMode: 'buffer', state: 'active' });
  await expect(page.locator(`${MAIN} .listCard[data-list-board="BravoTest"]`)).toContainText('4521');
});

// ---- Reordering the favorites (#221) -----------------------------------------
//
// PTT's `S` on the favorites (board.c#board_cmd_sort, IS_LISTING_FAV) draws a
// warning at b_lines-2 and asks with vans() at b_lines, which reads a line:
// `1` + Enter sorts by name, `2` + Enter by class, anything else cancels.
// Either way PTT reloads the list. The fake below answers the way PTT would.

async function drawFavSortPrompt(page) {
  let d = at(22) + '\x1b[K重新排序看板 \x1b[1;33m(注意, 這個動作會覆寫原來設定)\x1b[m';
  d += at(23) + '\x1b[K' + at(24) + '\x1b[K排序方式 (1)按照板名排序 (2)按照類別排序 ==> [0]取消 ';
  await feed(page, d);
  await waitScreenSettled(page, { 23: '排序方式' });
}

// PTT's answer to the prompt: the favorites reloaded in the new order, or
// unchanged on any other answer. Its cursor stays on row 1 (brdnum = -1).
const BY_CLASS = [BOARDS[2], BOARDS[0], BOARDS[1]];
async function answerFavSort(page, answer) {
  const order = answer === '1\r' ? BOARDS.slice().sort((a, b) => a[0].localeCompare(b[0]))
    : answer === '2\r' ? BY_CLASS : BOARDS;
  await drawList(page, { order });
  return order;
}

const sheet = (page) => page.locator('[data-fav-sort-choice]');

async function reorderTo(page, which, answer) {
  const sel = await selectedNum(page);
  const selName = BOARDS[sel - 1][0];
  await page.locator(`[data-fav-sort="${which}"]`).tap();
  await expect(sheet(page)).toHaveCount(0);
  expect(await sent(page, 'S')).toBe('S');
  await expect.poll(() => cardsIn(page)).toEqual(NAMES); // frozen through the prompt
  await drawFavSortPrompt(page);
  expect(await sent(page, '\r')).toBe(answer);
  expect((await session(page)).renderMode).toBe('frozen');
  const order = await answerFavSort(page, answer);
  expect(await sent(page, '\r')).toBe(sel + '\r');
  await drawList(page, { order, cursor: sel });
  await boardListEngaged(page);
  await answerProbe(page, { order });
  await expect.poll(() => cardsIn(page)).toEqual(namesOf(order));
  const now = await selectedNum(page);
  expect(order[now - 1][0]).toBe(selName);
  // Home's cached favorites are stale now: it fetches them again.
  expect(await page.evaluate(() => window.__app.homeDashboard._state.fetchedAt)).toBe(null);
}

test('favorites, More → reorder: a confirmation sheet first; cancel sends nothing; a pick answers PTT\'s prompt and rebuilds the list', async ({ page }) => {
  await openList(page, 'fav');
  await page.evaluate(() => { window.__app.homeDashboard._state.fetchedAt = Date.now(); });
  const label = await tapMore(page, '__boardSort');
  expect(label).toBe('Reorder favorites');
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText('cannot be undone');
  await page.locator('[data-fav-sort="cancel"]').tap();
  await expect(sheet(page)).toHaveCount(0);
  expect(await peekCapture(page)).toBe('');
  await expect.poll(() => cardsIn(page)).toEqual(NAMES);

  await tapMore(page, '__boardSort');
  await expect(sheet(page)).toBeVisible();
  await reorderTo(page, 'name', '1\r');
});

test('favorites, the S key opens the same sheet (nothing sent), and a pick by class reorders', async ({ page }) => {
  await openList(page, 'fav');
  await page.evaluate(() => { window.__app.homeDashboard._state.fetchedAt = Date.now(); });
  await ptt.sendKey(page, 'S');
  await expect(sheet(page)).toBeVisible();
  expect(await peekCapture(page)).toBe('');
  await reorderTo(page, 'class', '2\r');
});
