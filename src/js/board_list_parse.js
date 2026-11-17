// 看板列表（PTT `choose_board`）的**純解析層**：畫面指紋、逐列編號、抓頁判定。
// 零 DOM、零 app 狀態 ⇒ 全部在 tests/unit/board_list_parse.test.js 守護。
//
// 事實來源一律是 `3rd_script/pttbbs/mbbsd/board.c#show_brdlist` / `#choose_board`
// （PTT 邏輯不准猜，見 docs/pttbbs-screen-protocol.md「研究方法規範」）。三個承重事實：
//   1. 版型：showtitle row0 → 熱鍵列 row1 → vbarf 欄位列 row2 → body row 3..22
//      （`while (++myrow < b_lines)`，b_lines=23）→ vs_footer 在 row 23。
//   2. 序號欄是 `prints("%7d", head)`（head 已 ++）⇒ **編號＝1-based 絕對位置**，
//      而且 `head = (num / p_lines) * p_lines` ⇒ 分頁對齊、跨頁零重疊。
//      例外：`newflag`（按 `c` 的「新文章」模式）印的是文章總數 `B_TOTAL`，
//      群組板／無權限板則印 `%7s` 空白 —— 那種畫面**一律不 engage**，靠 row2
//      的「總數／編號」字樣就分得出來（board.c:1338）。
//   3. 變體（我的最愛／分類子分類／全部看板）的指紋，新舊兩版不同 —— 見 boardListVariant。
//
// 本期只 engage 我的最愛（fav）與分類看板子分類（class）；全部看板／熱門看板
// （all）不做。The class root (【分類看板】, 'classroot', #229) engages with its own
// geometry (CLASS_ROOT_GEOMETRY).

import {
  BOARD_LIST,
  CLASS_LIST,
  MENU_TITLES,
  isArticleListTitleRow,
  rowHasAnyTitle,
  rowHasTitle
} from './screen_titles';
import {
  footerCaption,
  isArticleListFooter,
  isBoardListFooter
} from './screen_captions';

// 渲染後畫面裡 body 從第幾列開始（row0 標題、row1 熱鍵、row2 欄位列）。
// 與文章列表好讀的 LIST_HEADER_ROWS 同值但**語意不同**（那是 bbs.c 的表頭），
// 刻意各自宣告，日後其中一邊改版才不會靜默連坐。
export const BRD_HEADER_ROWS = 3;

// Where a board list's numbered rows sit on PTT's screen. Every list but one
// starts its body at row 3 with the number in cells [0,7). The class root
// (【分類看板】, board.c#choose_board IN_CLASSROOT, #229) has header_lines 7
// (title and six rows of art) and prints each row as `"          %s%s"`, so its
// number sits ten cells to the right. Its cursor sits at col 10
// (brdlist_cursor).
export const STANDARD_GEOMETRY = Object.freeze({ headerRows: BRD_HEADER_ROWS, colOffset: 0 });
export const CLASS_ROOT_GEOMETRY = Object.freeze({ headerRows: 7, colOffset: 10 });

export function boardListGeometry(variant) {
  return variant === 'classroot' ? CLASS_ROOT_GEOMETRY : STANDARD_GEOMETRY;
}

// Whether the screen is the class root shown as a board list: its title row
// and the choose_board footer with the class root's caption (brdlist_caption).
export function isClassRootScreen(rowTexts, rows) {
  const texts = rowTexts || [];
  const n = rows || texts.length;
  return rowHasTitle(texts[0] || '', CLASS_LIST) && footerCaption(texts[n - 1] || '') === CLASS_LIST;
}

// `%7d` 欄寬：序號右對齊塞在 cells [0,7)。游標 `>` 只蓋 cell 0（半形，
// pttbbs b9a5029f），而看板數量遠小於 10^6 ⇒ 永遠不會蓋到數字。
const NUM_COL_END = 7;

// 一列的看板編號。null ＝這一列沒有編號（標題／熱鍵列／欄位列／footer／
// body 尾端的空白列／newflag 的 `%7s` 空白）。
//
// **不要求數字後面接空白**：無權限板印的是 `prints("%7d", head)` 緊接
// `prints("X%c ...")`（board.c:1427-1435）⇒ `      5X ...`，用 `\d+\s` 會漏掉。
// 改以「數字必須落在 `%7d` 欄位內」當守門（結束位置 ≤ 7），這正是欄位定義本身。
export function parseBoardListNum(text) {
  if (!text) return null;
  const m = /^[\s>]*(\d+)/.exec(text);
  if (!m || m[0].length > NUM_COL_END) return null;
  return parseInt(m[1], 10);
}

// 分隔線列（`NBRD_LINE`，board.c:1374）：`%7d %c ` 之後整段都是 `-`。
// **必須認得出來**：對它按 Enter 時 board.c 直接 `break` ⇒ server 一個 byte 都不回，
// 開文交易只能等到逾時。認出來就在本地擋掉並提示，零 round-trip。
//
// 欄位照 board.c#brdlist_separator：
//   - 一般：`"%7d %c "`，`%c` 是標記欄 —— 被 t 標記（NBRD_TAG）時印 'D'，所以 col 8
//     可能是 'D' 而不是空白；
//   - newflag：`"%7s   "`，序號欄整段空白、沒有數字。
export function isBoardListSeparatorRow(text) {
  if (!text) return false;
  const rest = text.slice(NUM_COL_END + 1);
  if (parseBoardListNum(text) == null) {
    return /^\s*$/.test(text.slice(0, NUM_COL_END + 1)) && /^\s+-{6,}/.test(rest);
  }
  return /^D?\s*-{6,}/.test(rest);
}

// 禁入／隱板列（board.c:1427-1441）：`HasBoardPerm` 為假的看板。Enter 同樣
// **零回應**（外層 `if (HasBoardPerm(...))` 直接落空），理由同上。
export function isBoardListBlockedRow(text) {
  if (!text) return false;
  return text.indexOf('[禁入]') >= 0 || text.indexOf('[隱板]') >= 0;
}

// 目錄列（`NBRD_FOLDER`，board.c:1390）：Enter 會遞迴進一層新的 choose_board
// （＝另一份看板列表、另一個編號空間），不是進文章列表。
export function isBoardListFolderRow(text) {
  return !!text && text.indexOf('目錄') >= 0 && parseBoardListNum(text) != null;
}

// 這一列的**板名**（`%-13s` 的 `B_BH(ptr)->brdname`，board.c:1477-1486）。
// 用途：退出看板回到看板列表時，確認「同一號碼還是同一個看板」——編號是絕對位置，
// 但**同變體的不同清單共用同一個編號空間形狀**（分類看板的目錄列 Enter 會遞迴進
// 另一份 choose_board，footer 變體一模一樣）⇒ 只比編號會把兩份清單混在一起。
//
// **不用固定欄位**：`prints("%7d%c%s", head, hideChar, unread)` 佔 10 格，但未讀
// 標記 `unread[1]` 是全形「ˇ」（board.c:1343），`rowToText` 把它收成**一個**字元
// ⇒ 板名的字串索引隨已讀/未讀位移一格。改抓「編號之後的第一個 ASCII 識別字」，
// 與欄寬脫鉤。板名的字元集是 `[A-Za-z0-9_-]`（PTT brdname）。
// 回 '' ＝這一列沒有板名（分隔線列／空白列）——比對時兩邊都是 '' 仍算相符，
// 判定的重量落在有板名的那些列上。
export function parseBoardListName(text) {
  if (!text) return '';
  const m = /^[\s>]*\d+[^A-Za-z0-9_]*([A-Za-z0-9_][A-Za-z0-9_-]*)/.exec(text);
  return m ? m[1] : '';
}

// 一列能不能「設為已讀」（看板列表的 `v`，board.c#board_cmd_mark_read，見 board_mark_read.js）：
// 要有編號、有板名，而且不是分隔線／禁入／目錄（`bid < 0` 或沒權限時 server 什麼都不做，
// 目錄設成已讀也沒有意義）。回 { num, name } 或 null。
export function boardMarkReadTargetOfText(text) {
  const num = parseBoardListNum(text);
  if (num == null) return null;
  if (isBoardListSeparatorRow(text) || isBoardListBlockedRow(text) || isBoardListFolderRow(text))
    return null;
  const name = parseBoardListName(text);
  if (!name) return null;
  return { num: num, name: name };
}

// The unread mark `unread[1]` (full-width ˇ, Big5 A3BE) or `unread[0]` (two
// spaces) fills cells [8,10), right after `%7d%c` (board.c:1343).
const UNREAD_COL = 8;
const UNREAD_LEAD = '\xa3';
const UNREAD_TRAIL = '\xbe';

// Set the unread mark of a board row's cells (TermChar-like `{ ch, isLeadByte }`)
// in place. Rows without a board, or whose mark cells hold anything but a mark,
// are left as they are. Returns whether the row changed.
export function setBoardListRowUnread(cells, unread) {
  if (!cells || cells.length < UNREAD_COL + 2) return false;
  const text = cells.map((c) => (c && c.ch) || ' ').join('');
  if (!boardMarkReadTargetOfText(text)) return false;
  const lead = cells[UNREAD_COL];
  const trail = cells[UNREAD_COL + 1];
  const marked = lead.ch === UNREAD_LEAD && trail.ch === UNREAD_TRAIL;
  if (!marked && !(lead.ch === ' ' && trail.ch === ' ')) return false;
  if (marked === !!unread) return false;
  lead.ch = unread ? UNREAD_LEAD : ' ';
  lead.isLeadByte = !!unread;
  trail.ch = unread ? UNREAD_TRAIL : ' ';
  trail.isLeadByte = false;
  return true;
}

// Whether a board row's text shows its unread mark ˇ, or null for a row
// without a board. The mark sits between the number and the board's name.
export function boardListRowUnread(text) {
  if (!boardMarkReadTargetOfText(text)) return null;
  const m = /^[\s>]*\d+([^A-Za-z0-9_]*)/.exec(text);
  return !!m && m[1].indexOf('ˇ') >= 0;
}

// 整頁逐列編號。與 comment_parse.pageArticleNums **刻意不共用**：那支為文章列表
// 寫了「游標蓋住高位數字→從鄰居回推」與「單調修復」兩段補救，而看板列表的
// `%7d` 是右對齊、`>` 只蓋前置空白 ⇒ 那些補救在這裡只會是憑空修改的風險。
// `geometry` (boardListGeometry) places the rows; the standard one by default.
export function boardListRowNums(rowTexts, rows, geometry = STANDARD_GEOMETRY) {
  const n = rows == null ? rowTexts.length : rows;
  const out = new Array(n).fill(null);
  for (let r = geometry.headerRows; r <= n - 2; ++r)
    out[r] = parseBoardListNum((rowTexts[r] || '').slice(geometry.colOffset));
  return out;
}

// A class root row's name: its description and BM, spaces collapsed. Its rows
// show no ASCII board name (parseBoardListName would read "PTT" out of
// 市民廣場's description), so this is what tells two of its rows apart. It reads
// the same with or without PTT's margin and cursor, read or unread.
export function classRootRowName(text) {
  const m = /^[\s>]*\d+[\sˇ]*(.*)$/.exec(text || '');
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

// 看板列表變體。'unknown' ＝不 engage＝原生，安全。
//
// 舊版（CONFIRMED @ 03cdf5eb board.c:1279-1290）：caption 一律「選擇看板」，變體只能
// 看 footer 三元式 —— IS_LISTING_FAV →「(a)增加看板…」；IN_CLASS →「(m)加入/移出最愛
// (s)進入已知板名…」；其餘 →「(m)加入/移出最愛 (y)只列最愛…」。'all' 要**先於**
// 'class' 判：兩者都以 `(m)加入/移出最愛` 開頭。
//
// 新版（CONFIRMED @ piaip.newui 7e35b24e）：caption＝board.c#brdlist_caption，提示＝
// psb.c#vs_cmd_bar(VS_SUB_HEADER|VS_FOOTER)：prio ≥ HIGH 進底列 " (k)名"、≤ NORM 進
// row1 "[k]名"。IS_LISTING_FAV 用 myfav_cmds（`(a)增加看板` HIGH），否則 board_fav_cmds
// （`(m)加入最愛` HIGH、`[y]只列最愛` NORM）。
//   「我的最愛」＝class_bid==0，**不看 yank_flag** ⇒ 按 `y` 列出全站看板時 caption 不變，
//     必須靠提示分 fav／all。
//   「看板列表」＝class_bid<0（熱門）或 >1（分類子層）：指令表是靜態的，兩者畫面
//     **完全相同** ⇒ 一律當 class（使用者 2026-09-25 定案）。代價：熱門看板的排序
//     會動態變化，跨頁拼接可能出現重複／漏板；退出看板時仍有板名比對兜底。
// `(a)增加看板` 新舊字面相同，放最前面兩版共用。
function boardListVariant(foot, row1) {
  if (foot.indexOf('(a)增加看板') >= 0) return 'fav';
  switch (footerCaption(foot)) {
    case '我的最愛':
      if (row1.indexOf('[y]列出全部') >= 0) return 'fav';
      if (foot.indexOf('(m)加入最愛') >= 0 || row1.indexOf('[y]只列最愛') >= 0) return 'all';
      return 'unknown';
    case '看板列表':
      return 'class';
    default:
      if (foot.indexOf('(y)只列最愛') >= 0) return 'all';
      if (foot.indexOf('(m)加入/移出最愛') >= 0) return 'class';
      return 'unknown';
  }
}

// 一幀畫面是不是看板列表，以及是哪一種。回 null ＝根本不是（文章列表／主功能表／
// 文章／prompt…）。
//
// facts = { rowTexts, curX, curY, rows }（與 ListSession._collectFacts 同形，
// 兩個 session 的 facts 都餵得進來）。回傳：
//   { variant, newflag, nums, cursorNum, topNum, parked, engageable }
// variant: 'fav' 我的最愛／'class' 分類子分類／'classroot' 分類看板根（#229）／'all' 全部看板・熱門看板／'unknown'
// geometry: where its rows sit (boardListGeometry)
// engageable: 只有 fav / class ＋ 非 newflag ＋ 游標停在 body ＋ 有編號才為真。
export function classifyBoardListScreen(facts) {
  if (!facts) return null;
  const rowTexts = facts.rowTexts || [];
  const rows = facts.rows || rowTexts.length;
  if (isClassRootScreen(rowTexts, rows)) return classifyRows(facts, 'classroot', false);
  if (!rowHasTitle(rowTexts[0] || '', BOARD_LIST)) return null;
  const foot = rowTexts[rows - 1] || '';
  if (!isBoardListFooter(foot)) return null;
  const header = rowTexts[2] || '';
  // row2 是 `vbarf(... newflag ? "總數" : "編號")`（board.c:1338）：畫面自己就分得出
  // newflag，不必去攔 `c` 鍵。newflag 下 `%7d` 印的是文章總數，編號 key 立刻失真。
  const newflag = header.indexOf('總數') >= 0;
  if (!newflag && header.indexOf('編號') < 0) return null;

  return classifyRows(facts, boardListVariant(foot, rowTexts[1] || ''), newflag);
}

function classifyRows(facts, variant, newflag) {
  const rowTexts = facts.rowTexts || [];
  const rows = facts.rows || rowTexts.length;
  const geometry = boardListGeometry(variant);
  const nums = boardListRowNums(rowTexts, rows, geometry);
  const curY = facts.curY;
  const curX = (facts.curX || 0) - geometry.colOffset;
  const parked =
    curY != null && curY >= geometry.headerRows && curY <= rows - 2 && curX >= 0 && curX <= 1;
  const cursorNum = parked ? nums[curY] : null;
  let topNum = null;
  for (let r = geometry.headerRows; r <= rows - 2; ++r) {
    if (nums[r] != null) {
      topNum = nums[r];
      break;
    }
  }
  return {
    variant: variant,
    geometry: geometry,
    newflag: newflag,
    nums: nums,
    cursorNum: cursorNum,
    topNum: topNum,
    parked: parked,
    engageable:
      !newflag &&
      (variant === 'fav' || variant === 'class' || variant === 'classroot') &&
      parked &&
      cursorNum != null &&
      topNum != null
  };
}

// ---- The article-count view (`c`, #221) -------------------------------------
//
// PTT's `c` (board_cmd_toggle_newflag, help text 「切換顯示看板編號或文章數」)
// switches the number column between the board's position and its article
// total; header row 2 reads 總數 instead of 編號. The rows, their order and the
// boards with no articles all stay (board_list_toggles.json). Group,
// separator and blocked rows print blanks there. So a page in this view does
// not say where its rows sit: decorateNewflagBoardList works it out.

// A row of the article-count view, with its number column holding its
// position `num` instead, so every helper that reads a numbered row (name,
// separator, mark-read target) reads it as in the numbered view.
export function newflagRowText(text, num) {
  if (text == null || num == null) return text || '';
  const s = String(num);
  if (s.length > NUM_COL_END) return text;
  return ('       ' + s).slice(-NUM_COL_END) + text.slice(NUM_COL_END);
}

// PTT's prompt for reordering the favorites (board.c#board_cmd_sort under
// IS_LISTING_FAV): a warning at b_lines-2, then vans() at b_lines, which reads
// a line (vgets: the answer needs Enter). Answers: 1 by name, 2 by class,
// anything else cancels.
export const FAV_SORT_ANSWERS = Object.freeze({ name: '1', class: '2' });
export function isFavSortPrompt(rowTexts) {
  const rows = rowTexts || [];
  const last = rows[rows.length - 1] || '';
  return /排序方式/.test(last) && /按照板名排序/.test(last);
}

// Where the rows of an article-count page sit. Pages are aligned (head =
// floor((num-1)/p)*p, board.c), so a page is known by its base. A base comes
// from either:
//   - a board name the list already holds: the page's row of that name sits
//     at its position (`numOfName`), the strongest evidence;
//   - a candidate position PTT's cursor stands on (`candidates`, in order of
//     trust: the jump just sent, then where PTT's cursor was), when the
//     cursor's row is the one that position takes on its page.
// A base under which any row names another board than the list holds at that
// position (`nameOfNum`) is wrong. Of the rest, the one with the most rows
// matching the list wins, then the most trusted candidate.
// Returns brd with positions as nums, cursorNum, topNum and engageable, plus
// rowTexts with positions in the number column; null when nothing places the
// page.
export function decorateNewflagBoardList(facts, brd, opts) {
  if (!brd || !brd.newflag || !brd.parked) return null;
  if (brd.variant !== 'fav' && brd.variant !== 'class') return null;
  const o = opts || {};
  const rowTexts = facts.rowTexts || [];
  const rows = facts.rows || rowTexts.length;
  const h = brd.geometry.headerRows;
  const p = rows - 1 - h;
  if (p <= 0) return null;
  let k = 0;
  while (h + k <= rows - 2 && /\S/.test(rowTexts[h + k] || '')) ++k;
  const cur = facts.curY - h;
  if (!k || cur < 0 || cur >= k) return null;
  const names = [];
  for (let i = 0; i < k; ++i) names.push(parseBoardListName(newflagRowText(rowTexts[h + i], 1)));
  const nameOfNum = o.nameOfNum || (() => '');
  const numOfName = o.numOfName || (() => null);
  const bases = new Map();
  const offer = (base, trust) => {
    if (base < 0 || base % p !== 0) return;
    const had = bases.get(base);
    if (had == null || trust < had) bases.set(base, trust);
  };
  (o.candidates || []).forEach((c, i) => {
    if (c != null && c >= 1 && (c - 1) % p === cur) offer(c - 1 - cur, i);
  });
  names.forEach((name, i) => {
    const n = name ? numOfName(name) : null;
    if (n != null) offer(n - 1 - i, Infinity);
  });
  let best = null;
  bases.forEach((trust, base) => {
    let matches = 0;
    for (let i = 0; i < k; ++i) {
      const held = nameOfNum(base + i + 1);
      if (!held || !names[i]) continue;
      if (held !== names[i]) return;
      ++matches;
    }
    if (!matches && trust === Infinity) return;
    if (!best || matches > best.matches || (matches === best.matches && trust < best.trust))
      best = { base, matches, trust };
  });
  if (!best) return null;
  const nums = new Array(rows).fill(null);
  const texts = rowTexts.slice();
  for (let i = 0; i < k; ++i) {
    nums[h + i] = best.base + i + 1;
    texts[h + i] = newflagRowText(rowTexts[h + i], best.base + i + 1);
  }
  return {
    ...brd,
    nums: nums,
    cursorNum: best.base + cur + 1,
    topNum: best.base + 1,
    engageable: true,
    rowTexts: texts
  };
}

// 這一幀屬於哪一種「情境」——state machine 只吃這個枚舉。
//   'brdlist'       可 engage 的看板列表（我的最愛／分類子分類）
//   'brdlist-other' 看板列表但不在本期範圍（全部看板／熱門／newflag）
//   'article-list'  文章列表（《看板》＋文章列表 caption）⇒ ListSession 的地盤
//   'menu'          主功能表／精華文章（and the old version's class root, whose footer
//                   is the menu status line）⇒ 已離開看板列表
//   'other'         prompt／半繪／說明畫面…（原生鏡像照畫即可）
export function boardListContextKind(facts) {
  const brd = classifyBoardListScreen(facts);
  if (brd) return brd.engageable ? 'brdlist' : 'brdlist-other';
  const rowTexts = (facts && facts.rowTexts) || [];
  const rows = (facts && facts.rows) || rowTexts.length;
  const row0 = rowTexts[0] || '';
  const foot = rowTexts[rows - 1] || '';
  if (isArticleListTitleRow(row0) && isArticleListFooter(foot)) return 'article-list';
  if (rowHasAnyTitle(row0, MENU_TITLES)) return 'menu';
  return 'other';
}

// 「往這個方向再抓一頁」的跳號目標。看板列表的分頁是對齊的，而且編號＝絕對位置，
// 所以**不必用 PgUp/PgDn**：跳到緊鄰緩衝邊界的那一號，server 自己會把
// `head = (num / p_lines) * p_lines` 對齊到含它的那一頁（board.c:1710-1716）。
//
// 刻意不照抄 ListSession 的「錨點跳號 ＋ PgUp/PgDn」兩腿：board.c 的翻頁鍵會
// **wrap**（第一項 PgUp fall-through 到 KEY_END、最後一項 PgDn 回到第 1 項，
// board.c:1760-1785），拿它抓頁得多一套 wrap-aware 判定，而跳號一腿就搞定且
// 每次只要一個 round-trip。
export function boardListFetchTarget({ base, dir }) {
  if (base == null) return null;
  const t = dir < 0 ? base - 1 : base + 1;
  return t >= 1 ? t : null;
}

// 抓頁落地判定。`search_num` 會把超過 brdnum 的輸入夾到 brdnum（stuff.c:189-208）
// ⇒ **往下跳一號卻停在原地就是板尾**，一腿同時做到「抓頁」與「探邊」。
// 往上同理（跳到 base-1 卻沒往上 ⇒ 只可能是被夾住了）。
export function boardListFetchVerdict({ base, landed, dir }) {
  if (landed == null) return { edge: false, ok: false };
  if (dir < 0) return { ok: true, edge: landed >= base };
  return { ok: true, edge: landed <= base };
}
