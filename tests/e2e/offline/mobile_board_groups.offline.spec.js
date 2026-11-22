// The board groups (分組討論區, #229) through easy reading on a phone: the home
// dashboard's entrance opens PTT's class root (Ctrl+Z c) as an easy-reading
// board list, a class row opens its board list, a board row opens the board,
// and Back returns one level at a time down to home. Every page change stacks:
// the page left stays a live layer that an edge swipe reveals at once. The
// native grid guard (helpers/native_grid_guard.js, installed by bootOffline)
// fails the test if any native frame is painted on the way.
//
// The class root is drawn from board.c#choose_board IN_CLASSROOT (header_lines
// 7, each row `"          %s%s"` with `%7d%c%s` then a 40-cell description
// and the BMs, the footer only), in the shape PTT shows: classes, then boards
// with an unread mark and a link row. BM ids are invented.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, waitScreenSettled } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { drawFavorites, drawArticleList } = require('../helpers/home_screens');
const { startCapture, peekCapture, takeCapture } = require('../helpers/capture');
const { touchDrag } = require('../helpers/real_input');
const { waitRectStable } = require('../helpers/layout');
const { MAIN, boardListEngaged, dashboardVisible } = require('../helpers/stack_routes');

const ZA_FAV = '\x1af';
const ZA_CLASS = '\x1ac';
const LEFT = '\x1b[D';
const FAVS = [{ name: 'Board1', desc: '測試看板 1', unread: false }];

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

// The class root's rows: unread mark (two cells), description (40 cells) and
// BM. Classes have no mark; 5 is a board with unread articles, 6 a link row.
const CLASS_ROOT = [
  ['  ', '市民廣場     報告站長 PTT咬我', ''],
  ['  ', '臺灣大學     臺大, 臺大, 臺大', 'bmOne'],
  ['  ', '政治大學     政大, 政大, 政大', 'bmTwo'],
  ['  ', '國家研究院   政治, 文學, 學術', 'bmThree'],
  ['ˇ', '[推廣] 看板資訊公佈欄', 'bmFour/bmFive'],
  ['  ', '      --> 即時熱門看板 <--', ''],
];
const ROOT_CARDS = CLASS_ROOT.map((_, i) => '#' + (i + 1));

// board.c#choose_board IN_CLASSROOT: title, six rows of art, the rows from row
// 7 with PTT's cursor at col 10, and the footer.
async function drawClassRoot(page, cursor) {
  let d = '\x1b[H\x1b[2J';
  d += at(1) + REV + padCells('【分類看板】                     批踢踢實業坊', 80) + OFF;
  d += at(4) + '     ︿︿︿︿︿︿︿︿                               ║ ◣◢███▼▼▼║';
  CLASS_ROOT.forEach(([mark, desc, bm], i) => {
    const num = String(i + 1).padStart(7, ' ') + ' ' + mark;
    d += at(8 + i) + ' '.repeat(10) + (i + 1 === cursor ? '>' + num.slice(1) : num) + padCells(desc, 40) + bm;
  });
  d += at(24) + REV + padCells(' 分類看板  (m)加入最愛 (v)已讀/未讀 (t)標記 (y)只列最愛     (←)回上層 (h)說明', 79) + OFF;
  d += at(7 + cursor, 11);
  await feed(page, d);
  await waitScreenSettled(page, { 0: '分類看板', 23: '分類看板' });
}

// A class's board list (看板列表, board.c#brdlist_renderer): one board and one
// group, PTT's cursor on `cursor`.
const CLASS_LIST = [
  ['TestBoard', '測試 ◎測試看板'],
  ['SubGroup', '群組 Σ子群組'],
];
async function drawClassList(page, cursor) {
  let d = '\x1b[H\x1b[2J';
  d += at(1) + REV + padCells('【看板列表】                     批踢踢實業坊', 80) + OFF;
  d += at(2) + '[y]只列最愛 [→]進入 [s]找看板 [/]搜尋 [c]新文章 [S]排序 [PgUp]上頁 [PgDn]下頁';
  d += at(3) + REV + padCells('   編號   看  板       類別   中   文   敘   述               人氣 板   主', 80) + OFF;
  CLASS_LIST.forEach(([name, desc], i) => {
    const head = String(i + 1).padStart(7, ' ') + '   ';
    d += at(4 + i) + (i + 1 === cursor ? '>' + head.slice(1) : head) + name.padEnd(13, ' ') + desc;
  });
  d += at(24) + REV + padCells(' 看板列表  (m)加入最愛 (v)已讀/未讀 (t)標記                 (←)回上層 (h)說明', 79) + OFF;
  d += at(3 + cursor);
  await feed(page, d);
  await waitScreenSettled(page, { 0: '看板列表', 23: '看板列表' });
}

// A class's group announcement (Read()'s board note for the class's group
// board): a full screen and the standard pause bar, the cursor at its end.
async function drawAnnouncement(page) {
  let d = '\x1b[H\x1b[2J';
  d += at(2) + '        國家研究院公告';
  d += at(5) + '    歡迎來到國家研究院';
  const bar = '▄'.repeat(15);
  d += at(24) + '\x1b[1;37;44m' + padCells(bar + ' 請按任意鍵繼續 ' + bar, 79) + OFF;
  d += at(24, 80);
  await feed(page, d);
  await waitScreenSettled(page, { 23: '請按任意鍵繼續' });
}

// Keys the app sent since the last take, once they end with `tail`. Its Ctrl+L
// (\f, ask PTT to repaint) is dropped: every step here answers with a full
// screen anyway.
async function sent(page, tail) {
  await expect.poll(() => peekCapture(page)).toContain(tail);
  return (await takeCapture(page)).replace(/\f/g, '');
}

const cardsIn = (page, root) => page.locator(`${root} .listCard[data-list-board]`).evaluateAll(
  cards => cards.map(card => card.dataset.listBoard));
const BOARD_LAYER = '[data-stack-layer="boardList"]:not([data-stack-parked])';
const HOME_LAYER = '[data-stack-layer="home"]';

// An easy-reading board list fills its rows itself: past its last row PTT
// clamps the jump (stuff.c#search_num), which tells the list its end.
async function answerFill(page, draw, last) {
  expect(await sent(page, '\r')).toBe(String(last + 1) + '\r');
  await draw(page, last);
  await boardListEngaged(page);
}

// A board list's Back: PTT's cursor is first synced to the selected row
// (`selected`) when the fill left it elsewhere, then ← goes out.
async function answerBack(page, draw, selected) {
  await expect.poll(() => peekCapture(page)).toMatch(/\x1b\[D|\r/);
  let keys = (await takeCapture(page)).replace(/\f/g, '');
  if (!keys.includes(LEFT)) {
    expect(keys).toBe(selected + '\r');
    await draw(page, selected);
    keys = await sent(page, LEFT);
  }
  expect(keys).toBe(LEFT);
}

// A right edge swipe across the main page.
async function edgeSwipe(page) {
  const main = await waitRectStable(page, MAIN);
  const y = main.top + main.height / 2;
  await touchDrag(page, { x: 20, y }, { x: page.viewportSize().width - 20, y }, 12);
}

async function homeWithFavorites(page) {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { refreshMinIntervalSec: 0 });
  await startCapture(page);
  await drawMainMenu(page);
  await expect.poll(() => peekCapture(page)).toContain(ZA_FAV);
  await drawFavorites(page, FAVS);
  await expect.poll(() => peekCapture(page)).toContain('q');
  await takeCapture(page);
  await drawMainMenu(page);
  await dashboardVisible(page);
}

// Home's entrance opens the class root, shown as an easy-reading board list
// over the dashboard. PTT's cursor ends on the last row (the fill's probe).
async function openClassRoot(page) {
  await homeWithFavorites(page);
  await page.locator('#homeDashboard [data-home-board-groups]').tap();
  expect(await sent(page, ZA_CLASS)).toBe(ZA_CLASS);
  await drawClassRoot(page, 1);
  await answerFill(page, drawClassRoot, CLASS_ROOT.length);
  await expect(page.locator('#homeDashboard')).toHaveCount(0);
  await expect.poll(() => cardsIn(page, MAIN)).toEqual(ROOT_CARDS);
}

// Tap row `num` of the class root: PTT's cursor is synced to it, then Enter.
async function openRootRow(page, num) {
  await page.locator(`${MAIN} .listCard[data-list-board="#${num}"] .listCardBody`).tap();
  expect(await sent(page, num + '\r')).toBe(num + '\r');
  await drawClassRoot(page, num);
  expect(await sent(page, '\r')).toBe('\r');
}

test('board groups: home → class root → a class → a board, then Back one level at a time to home', async ({ page }) => {
  await openClassRoot(page);
  await expect(page.locator(`${MAIN} .listCard[data-list-board="#2"]`)).toContainText('臺灣大學');
  await expect(page.locator(`${MAIN} .listCard[data-list-board="#5"]`)).toContainText('看板資訊公佈欄');
  await expect(page.locator(`${MAIN} .listCard[data-list-board="#6"]`)).toContainText('即時熱門看板');

  // A class row opens its board list over the class root.
  await openRootRow(page, 2);
  await drawClassList(page, 1);
  await answerFill(page, drawClassList, CLASS_LIST.length);
  await expect.poll(() => cardsIn(page, MAIN)).toEqual(['TestBoard', 'SubGroup']);
  await expect(page.locator('[data-stack-layer]:not([data-stack-parked])')).toHaveCount(0, { timeout: 10000 });

  // A board row opens the board.
  await page.locator(`${MAIN} .listCard[data-list-board="TestBoard"] .listCardBody`).tap();
  expect(await sent(page, '1\r')).toBe('1\r');
  await drawClassList(page, 1);
  expect(await sent(page, '\r')).toBe('\r');
  await drawArticleList(page, 'TestBoard', [[1, ' '], [2, ' ']]);
  await page.waitForFunction(() => window.__app.listSession.state === 'active' && window.__app.commandQueue.idle);
  await takeCapture(page);

  // Back to the class's board list.
  await ptt.sendKey(page, 'ArrowLeft');
  await expect.poll(() => peekCapture(page)).toContain(LEFT);
  await takeCapture(page);
  await drawClassList(page, 1);
  await boardListEngaged(page);
  await expect.poll(() => cardsIn(page, MAIN)).toEqual(['TestBoard', 'SubGroup']);

  // An edge swipe goes back to the class root, which shows from its layer at once.
  await edgeSwipe(page);
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  expect(await cardsIn(page, BOARD_LAYER)).toContain('#2');
  await answerBack(page, drawClassList, 1);
  await drawClassRoot(page, 2);
  await boardListEngaged(page);
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect.poll(() => cardsIn(page, MAIN)).toEqual(ROOT_CARDS);
  expect(await peekCapture(page)).toBe('');

  // An edge swipe from the class root reveals the dashboard at once and goes home.
  await edgeSwipe(page);
  await expect(page.locator(HOME_LAYER)).toBeVisible();
  await answerBack(page, drawClassRoot, 2);
  await drawMainMenu(page);
  await dashboardVisible(page);
  await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('#homeDashboard [data-home-board-groups]')).toBeVisible();
});

test('board groups: a class that shows its group announcement first still opens over the class root', async ({ page }) => {
  await openClassRoot(page);
  await openRootRow(page, 4);
  // Read() shows the group's announcement; the board note skip answers it.
  await drawAnnouncement(page);
  expect(await sent(page, ' ')).toBe(' ');
  await drawClassList(page, 1);
  await answerFill(page, drawClassList, CLASS_LIST.length);
  await expect.poll(() => cardsIn(page, MAIN)).toEqual(['TestBoard', 'SubGroup']);
  await expect(page.locator('[data-stack-layer]:not([data-stack-parked])')).toHaveCount(0, { timeout: 10000 });

  // The class root stayed under it.
  await edgeSwipe(page);
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  expect(await cardsIn(page, BOARD_LAYER)).toContain('#4');
  await answerBack(page, drawClassList, 1);
  await drawClassRoot(page, 4);
  await boardListEngaged(page);
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect.poll(() => cardsIn(page, MAIN)).toEqual(ROOT_CARDS);
});

test('board groups: a board opened from a class root row opens over the class root', async ({ page }) => {
  await openClassRoot(page);
  await openRootRow(page, 5);
  await drawArticleList(page, 'BoardInfo', [[1, ' '], [2, ' ']]);
  await page.waitForFunction(() => window.__app.listSession.state === 'active' && window.__app.commandQueue.idle);
  await takeCapture(page);

  await edgeSwipe(page);
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  expect(await cardsIn(page, BOARD_LAYER)).toContain('#5');
  expect(await sent(page, LEFT)).toBe(LEFT);
  await drawClassRoot(page, 5);
  await boardListEngaged(page);
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await expect.poll(() => cardsIn(page, MAIN)).toEqual(ROOT_CARDS);
});
