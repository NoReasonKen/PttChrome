// 搜尋彈窗（文章列表的 / ? a Z ＋看板的 s）：攔截判準、prompt 指紋、送出序列。
//
// 為什麼要攔：pttbbs 的輸入記憶（↑ 叫回上一筆）是**整個登入 session 共用一份**
// （mbbsd/vtuikit.c:1018-1128 `static InputHistory ih`，508 bytes，≥2 bytes 才存，
// 只有 NOECHO 不存），跳號 prompt ` 跳至第幾項: `（stuff.c:190，NUMECHO）照樣存進去
// ⇒ 列表好讀／看板列表在背景送的 `N\r` 會把使用者真正的搜尋關鍵字擠掉，↑ 只叫得
// 回一串數字。client 關不掉 server 的記憶，所以改成自己記（search_history.js），
// 並在按下搜尋鍵時改開彈窗。細節見 docs/article-search.md。
//
// 純函式吃 App-ish 物件（同 long_push_gate.js 的慣例）：term_view（舊式 prototype）、
// React 工具列與 unit 都能直接呼叫。**只讀 e.key／修飾鍵**，理由同 long_push_gate
// 檔頭（sendKeyAsUser 合成的事件沒有 code/target）。

import { u2b, ansiHalfColorConv } from './string_util';
import { boardListContextKind } from './board_list_parse';
import { listRenderOwnerOf, OWNER_ARTICLE_LIST, OWNER_BOARD_LIST } from './list_render_owner';
import {
  rowHasTitle,
  MAIN_MENU,
  parseBoardName,
  boardNameFromKey,
  sameBoard,
  isMailListTitleRow,
  isUserListTitleRow
} from './screen_titles';
import { easyReadingOn, readValuesWithDefault } from './pref_storage';
import { recordFor } from './reading_record';
import { SLOW_STEP_BUDGET } from './aid_navigation';
import {
  candidateSearchResults, recordSearchResults, clearSearchResultsContext,
  readSearchResultsContext, MAX_SEARCH_RESULTS_FILTERS
} from './search_results_context';
import { isSearchResultsFrame, searchResultsLanded, SEARCH_RESULT_NOTICE } from './search_results_screen';
import { knownBoardEntryKeys, boardNoteDecision } from './board_note_skip';
import { classifyListScreen } from './list_session';
import { serializedOpHint } from './serialized_op_gate';
import { parseVmsgText } from './push_screen';
import { KEY_DISMISS } from './screen_dismiss';

// 種類 → PTT 端的按鍵。`?` 與 `/` 是同一個指令（read.c:1430-1431），送出一律用 `/`。
// `Z` 是推文數（大寫；小寫 z 是精華區，bbs.c:4406）。
export const SEARCH_KINDS = ['title', 'author', 'push', 'board'];
export const SEARCH_KEY_OF = { title: '/', author: 'a', push: 'Z', board: 's' };
const KIND_OF_KEY = { '/': 'title', '?': 'title', a: 'author', Z: 'push', s: 'board' };

// 鍵盤攔得到的鍵 → 種類；不是搜尋鍵回 null。`s` 只在 availableSearchKinds 含 board 的
// 畫面才攔（文章列表／看板列表／主功能表），其他選單的 s 是「跳到 s 開頭的項目」。
export function searchKindOfKey(key) {
  return Object.prototype.hasOwnProperty.call(KIND_OF_KEY, key) ? KIND_OF_KEY[key] : null;
}

// prompt 指紋。全部出自 pttbbs 原始碼（Big5 轉 UTF-8 後逐字抄）：
//   read.c#ask_filter_predicate：getdata(b_lines, 0, …)，已在搜尋結果裡
//   （MODE_SELECT）時改成「增加條件 …」。推文數那句在 CONFIG_OLD_RECOMMEND 下少了
//   「 (<0則搜噓文數) 」，所以只比前綴。
//   include/common.h:162 MSG_SELECT_BOARD（bbs.c#do_select、menu 的 s）與
//   board.c#board_cmd_search_global（看板列表的 s）：兩段式 prompt，輸入在第 1 列。
const BOTTOM_PROMPTS = {
  title: ['搜尋標題: ', '增加條件 標題: '],
  author: ['搜尋作者: ', '增加條件 作者: '],
  push: ['搜尋推文數高於多少', '增加條件 推文數: ']
};
export const BOARD_PROMPT = '請輸入看板名稱(按空白鍵自動搜尋)';

function startsWithAny(text, prefixes) {
  return prefixes.some((p) => text.indexOf(p) === 0);
}

// facts：{ rowTexts, rows, curY }（CommandQueue 的 settle facts 就是這個形狀）。
// 回 true ＝ 這一幀就是 kind 的輸入 prompt，游標停在輸入列上。
export function isSearchPromptFrame(kind, facts) {
  const rowTexts = (facts && facts.rowTexts) || [];
  const rows = (facts && facts.rows) || rowTexts.length;
  if (kind === 'board') {
    return facts.curY === 1 && (rowTexts[1] || '').indexOf(BOARD_PROMPT) === 0;
  }
  const prefixes = BOTTOM_PROMPTS[kind];
  if (!prefixes) return false;
  return facts.curY === rows - 1 && startsWithAny(rowTexts[rows - 1] || '', prefixes);
}

// server 端輸入欄最多收幾個 byte：read.c#ask_filter_predicate 的 getdata 欄寬是
// 推文數 7、作者 IDLEN+1、標題 TTLEN（include/pttstruct.h：IDLEN 12、TTLEN 64），
// vgetstring 只收「欄寬 − 1」個 byte，多打的響 bell 丟掉 ⇒ 送出去的條件會被靜默截斷。
const SEARCH_MAX_BYTES = { push: 6, author: 12, title: 63 };

// Big5 長度：ASCII 1 byte、其餘 2 bytes（Big5 沒有 3-byte 字）。
function big5Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; ++i) n += s.charCodeAt(i) > 0x7f ? 2 : 1;
  return n;
}

// 推文數只收非零整數（可負＝噓文數）。PTT 端 `atoi(keyword) == 0` 就當取消
// （read.c ask_filter_predicate），送一個一定被丟掉的值只是多一趟。
export function normalizeSearchText(kind, text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return '';
  if (SEARCH_MAX_BYTES[kind] && big5Length(t) > SEARCH_MAX_BYTES[kind]) return '';
  if (kind === 'push') {
    if (!/^-?\d+$/.test(t)) return '';
    return parseInt(t, 10) === 0 ? '' : String(parseInt(t, 10));
  }
  // 看板名稱：namecomplete 是 VGET_ASCII_ONLY（name.c#namecomplete_internal），
  // 非 ASCII 打進去也只會被丟掉 ⇒ 這裡先擋，彈窗才能說清楚。
  if (kind === 'board' && !/^[\x21-\x7e]+$/.test(t)) return '';
  return t;
}

// 從 buf 讀出判斷要的畫面事實（讀 buf 不讀 DOM，DOM 慢一幀）。buf 還沒建起來回 null。
export function searchGateFacts(core) {
  const buf = core && core.buf;
  if (!buf || typeof buf.getRowText !== 'function') return null;
  // Output written since the last repaint has no Big5 lead-byte flags yet (the
  // 30 ms update window), so its rows would read as raw bytes.
  if (buf.changed && typeof buf.updateCharAttr === 'function') buf.updateCharAttr();
  const rowTexts = [];
  for (let r = 0; r < buf.rows; ++r) rowTexts.push(buf.getRowText(r, 0, buf.cols));
  return {
    rowTexts: rowTexts,
    rows: buf.rows,
    curX: buf.cur_x,
    curY: buf.cur_y,
    // 游標停在反白輸入欄＝已經有一個 prompt 開著（使用者在打字），搜尋鍵是內容。
    inputField: typeof buf.isCursorOnInputField === 'function' && buf.isCursorOnInputField(),
    listOwner: listRenderOwnerOf(buf)
  };
}

// 這一幀可以開哪幾種搜尋（工具列的選單與鍵盤攔截共用同一個判準）。
//   文章列表 → 全部；看板列表 → 只有看板（看板列表的 / 是「看板中文關鍵字」，
//   board.c:2063，另一種東西，不接）；主功能表 → 只有看板（menu.c:767，只有
//   MMENU/TMENU/XMENU 的 s 是選擇看板，其他選單的 s 是跳到 s 開頭的項目）；
//   其他（文章、prompt、編輯器…）→ 無。
export function availableSearchKinds(facts) {
  if (!facts || facts.inputField) return [];
  // The mailbox (#196): mail.c#mail_comms has its own s/a/Z and easy reading
  // presents none of the searches there.
  if (isMailListTitleRow((facts.rowTexts || [])[0])) return [];
  // The online user list (#199): talk.c's s and / are its own, and easy
  // reading presents none of the searches there either.
  if (isUserListTitleRow((facts.rowTexts || [])[0] || '')) return [];
  if (facts.listOwner === OWNER_ARTICLE_LIST) return SEARCH_KINDS.slice();
  if (facts.listOwner === OWNER_BOARD_LIST) return ['board'];
  const ctx = boardListContextKind(facts);
  if (ctx === 'article-list') return SEARCH_KINDS.slice();
  if (ctx === 'brdlist' || ctx === 'brdlist-other') return ['board'];
  if (rowHasTitle((facts.rowTexts || [])[0] || '', MAIN_MENU)) return ['board'];
  return [];
}

// Whether `key`, typed without modifiers on the list `listOwner` presents,
// opens the search sheet. The help menu sheet asks it for its rows (#222).
export function searchKeyOpensSheet(key, listOwner) {
  const kind = searchKindOfKey(key);
  return !!kind && availableSearchKinds({ listOwner: listOwner, rowTexts: [] }).indexOf(kind) >= 0;
}

// 鍵盤／IME 兩條攔截入口的判準。
export function shouldInterceptSearchKey(opts) {
  const o = opts || {};
  const kind = searchKindOfKey(o.key);
  if (!kind) return false;
  if (o.ctrlKey || o.altKey || o.metaKey) return false;
  if (!easyReadingOn(o.prefs)) return false;
  return availableSearchKinds(o.facts).indexOf(kind) >= 0;
}

// term_view 的鍵盤（onKeyDown）與 IME（onTextInput）兩條入口共用。e 為 null ＝ IME
// 上字（沒有修飾鍵）。回 true ＝彈窗開了，呼叫端吞掉這個鍵；core.openSearchModal
// 是 noop（ContextMenu 還沒 mount）時回 false ⇒ 照原生送出，**絕不吞了又不開**。
export function tryOpenSearchModal(core, key, e) {
  const kind = searchKindOfKey(key);
  if (!kind || !core || typeof core.openSearchModal !== 'function') return false;
  if (
    !shouldInterceptSearchKey({
      key: key,
      ctrlKey: !!(e && e.ctrlKey),
      altKey: !!(e && e.altKey),
      metaKey: !!(e && e.metaKey),
      prefs: readValuesWithDefault(),
      facts: searchGateFacts(core)
    })
  ) {
    if (!(e?.ctrlKey || e?.altKey || e?.metaKey) && core.buf?.pageState === 2 && !searchGateFacts(core)?.inputField)
      clearSearchResultsContext(core);
    return false;
  }
  return !!core.openSearchModal(kind);
}

// 送出序列：先送搜尋鍵，**等 prompt 真的出現**才送關鍵字＋Enter。不可以一次送出：
// pttbbs 的 typeahead 會吞掉中間幀（協定 §2），而搜尋鍵沒被接受時（例如畫面在送出前
// 變了）關鍵字的每個字母都會落回列表按鍵 —— `a`/`Z`/`s`/數字全是指令。
export function buildSearchSteps(kind, text, cb) {
  const key = SEARCH_KEY_OF[kind];
  const value = normalizeSearchText(kind, text);
  if (!key || !value) return null;
  const c = cb || {};
  return [
    {
      keys: key,
      kind: 'search-open',
      expect: function(snapshot, facts) {
        return isSearchPromptFrame(kind, facts || {});
      },
      // prompt 沒出現＝PTT 不接受（站內信的推文數搜尋、沒權限…）：關鍵字絕不送。
      onFail: c.onFail
    },
    {
      // CommandQueue 綁的是 raw conn.send ⇒ Big5 轉碼要自己做（同
      // list_session._beginTextPassthrough）。
      keys: ansiHalfColorConv(u2b(value)) + '\r',
      kind: 'search-submit',
      // 搜尋要等 server 的搜尋服務（read.c#select_read → search_predicates_window）、
      // 看板搜尋是進板 ⇒ 不是一般按鍵的回應速度。
      ...SLOW_STEP_BUDGET,
      // 落地＝prompt 消失：結果列表（NEWDIRECT）、找不到的 vmsg、進板都會蓋掉它
      // （getdata／namecomplete 收到 Enter 一定返回，name.c#nc_cb_peek）。打字回顯的
      // 那一幀 prompt 還在，不能當落地——列表好讀的落地即回好讀就是拿這一幀判落點。
      expect: function(snapshot, facts) {
        return !isSearchPromptFrame(kind, facts || {});
      },
      onDone: c.onDone
    }
  ];
}

// 兩步在途的旗標（core.searchInFlight），由 serialized_op_gate 讀：期間使用者的鍵一律
// 吞掉＋提示。少了它，「搜尋鍵已上線、prompt 還沒畫出來」那一刻按的 Enter 會先到
// server，把空 prompt 送出（＝取消），關鍵字接著落到列表上變成指令（live 錄製檔
// live-2026-10-07T12-51-14：`/\f` → End → `\r` → 關鍵字永遠沒送）。
// 解除點：第二步完成／任一步失敗／被 flush；保底計時器防任何一條漏掉造成永久吞鍵。
export const SEARCH_INFLIGHT_MAX_MS = 15000;

// flag：旗標欄位名，預設 'searchInFlight'。畫面重新整理（screen_refresh.js）走同一條
// 送出路徑、但用自己的 'refreshInFlight'（serialized_op_gate 才給得出對的提示字）。
export function beginInFlight(core, flag) {
  const f = flag || 'searchInFlight';
  core[f] = true;
  clearTimeout(core['_' + f + 'Timer']);
  core['_' + f + 'Timer'] = setTimeout(function() {
    endInFlight(core, f);
  }, SEARCH_INFLIGHT_MAX_MS);
}

export function endInFlight(core, flag) {
  const f = flag || 'searchInFlight';
  core[f] = false;
  clearTimeout(core['_' + f + 'Timer']);
  core['_' + f + 'Timer'] = null;
}

// ---- The page under a board search (#190) ----
// PTT's board-select prompt (【 選擇看板 】) is data. While a board search owns
// it (the search sheet's bridge, a typed board submitted through submitSearch),
// the page the reader was on stays on screen under the sheet: term_view's held
// branch draws none of PTT's frames while core.boardSearchHold.holding, and the
// home dashboard keeps covering the main menu. The hold ends when the
// destination is presented by easy reading (or the page is back as it was), or
// when the search is lost; each end lets the view draw the frame it held back.

// How long the page is held for a prompt that has not opened yet.
export const BOARD_SEARCH_HOLD_MS = 5000;
// How long the page is held after the prompt closed, for easy reading to
// present where it led (a board entry screen may come first).
export const BOARD_SEARCH_LANDING_MS = 6000;

export function beginBoardSearchHold(core) {
  return new BoardSearchHold(core);
}

function BoardSearchHold(core) {
  this._core = core;
  this.holding = true;
  this._landing = null;
  this._onSettled = null;
  // The easy-reading article list under the sheet: a cancel gives PTT's list
  // back unchanged, so the list keeps the rows it holds (resumeNow).
  const ls = core.listSession;
  const owner = typeof core.activeListSession === 'function' ? core.activeListSession() : null;
  const shown = owner && owner === ls && ls.state === 'active' && ls.readingPosition ? ls.readingPosition() : null;
  this._keptBoard = shown && shown.board != null ? shown.board : null;
  const previous = core.boardSearchHold;
  core.boardSearchHold = this;
  if (previous && previous !== this) previous.release();
  this._timer = setTimeout(() => this.release(), BOARD_SEARCH_HOLD_MS);
}

BoardSearchHold.prototype = {
  // The prompt is up: the page stays for as long as the sheet is open.
  opened: function() {
    clearTimeout(this._timer);
    this._timer = null;
  },

  // The prompt is gone. The page stays until the destination is presented.
  // opts.keepList: PTT gave back the list under the sheet unchanged (a cancel).
  // opts.before: run once the list owners took the frame, before the hold ends
  // (a reading-record restore then lands on a list already shown).
  land: function(opts) {
    const o = opts || {};
    if (!this.holding) {
      if (o.before) o.before();
      return;
    }
    // With no list owner parked in the native mirror there is nothing to take
    // the frame back first: the caller's work runs now, in the settle that
    // ended the prompt, as before the hold (the AID pick's reopen must start
    // before the list session sees that settle).
    const core = this._core;
    const parked = (core.listSession && core.listSession.state === 'functionMode') ||
      (core.boardListSession && core.boardListSession.state === 'functionMode');
    if (o.before && !parked) {
      o.before();
      if (!this.holding) return;
    }
    this._landing = { kept: o.keepList ? this._keptBoard : null, before: parked ? o.before || null : null };
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._endLanding(), BOARD_SEARCH_LANDING_MS);
    const buf = core.buf;
    if (buf && buf.addEventListener) {
      // Measured after every owner has seen the settle (the list engages there).
      this._onSettled = () => queueMicrotask(() => this._present());
      buf.addEventListener('screenSettled', this._onSettled);
    }
    queueMicrotask(() => this._present());
  },

  _present: function() {
    const landing = this._landing;
    if (!this.holding || !landing) return;
    const core = this._core;
    // A list owner parked in the native mirror for the search takes PTT's list
    // back now, without the idle probe's wait (the frame would show natively).
    const ls = core.listSession;
    if (ls && ls.state === 'functionMode' && typeof ls.resumeNow === 'function') ls.resumeNow(landing.kept);
    const bl = core.boardListSession;
    if (bl && bl.state === 'functionMode' && typeof bl.resumeNow === 'function') bl.resumeNow();
    const before = landing.before;
    landing.before = null;
    if (before) before();
    if (this._presented()) this._endLanding();
  },

  // Easy reading shows where the search led, or another held run took over.
  _presented: function() {
    const core = this._core;
    if (core.aidNavigation && core.aidNavigation.active) return true;
    if (core.buf && core.buf.listRenderMode === 'buffer') return true;
    // Back at the main menu: the home dashboard covers it again.
    const facts = searchGateFacts(core);
    return !!facts && rowHasTitle(facts.rowTexts[0] || '', MAIN_MENU) && !isSearchPromptFrame('board', facts);
  },

  _endLanding: function() {
    const landing = this._landing;
    if (landing && landing.before) {
      const before = landing.before;
      landing.before = null;
      before();
    }
    this.release();
  },

  release: function() {
    clearTimeout(this._timer);
    this._timer = null;
    const core = this._core;
    if (this._onSettled && core.buf && core.buf.removeEventListener)
      core.buf.removeEventListener('screenSettled', this._onSettled);
    this._onSettled = null;
    if (!this.holding) return;
    this.holding = false;
    this._landing = null;
    if (core.boardSearchHold === this) core.boardSearchHold = null;
    // The dashboard kept covering the main menu while held: it looks again.
    if (core.homeDashboard && core.homeDashboard.recheck) core.homeDashboard.recheck();
    // The frame held back is drawn now, even when PTT sends nothing more.
    if (core.view && core.view.navigationEnded) core.view.navigationEnded();
  }
};

// 把旗標的解除接進每一步的終局 callback（保留呼叫端原本的 callback）。
function trackInFlight(core, steps, flag) {
  const end = function() {
    endInFlight(core, flag);
  };
  const wrap = function(fn) {
    return function(a, b) {
      end();
      if (fn) fn(a, b);
    };
  };
  steps.forEach(function(step, i) {
    step.onFail = wrap(step.onFail);
    step.onFlushed = wrap(step.onFlushed);
    if (i === steps.length - 1) step.onDone = wrap(step.onDone);
  });
  return steps;
}

function knownSearchConditionLimit(core, facts, board) {
  if (!isSearchResultsFrame(facts, board, false)) return false;
  const search = readSearchResultsContext(core, board);
  if (search?.filters.length !== MAX_SEARCH_RESULTS_FILTERS) return false;
  // Different characters can encode to the same bytes in Big5. Only refuse
  // locally when all recorded conditions are also distinct on the wire.
  return new Set(search.filters.map(filter =>
    filter.kind === 'thread' ? 'thread' : filter.kind + ':' + u2b(filter.value)
  )).size === MAX_SEARCH_RESULTS_FILTERS;
}

function searchConditionLimitNotice(facts, board) {
  if (!facts || facts.inputField || facts.curY !== facts.rows - 1 ||
      !sameBoard(parseBoardName(facts.rowTexts[0]), board)) return false;
  const last = facts.rowTexts[facts.rows - 1] || '';
  return last.trimEnd().endsWith('[按任意鍵繼續]') &&
    parseVmsgText(last) === '抱歉，已達搜尋條件上限。';
}

// Let the visible list owner run the sequence when it holds the screen.
// Otherwise use the shared queue. A true return means the request was handled,
// including a locally verified search-limit refusal.
// Capture the reading bookmark before handing over the list. Article searches
// finish on verified results or a known refusal. Board navigation finishes at
// its prompt exit. Restoration follows the article-search and board-search policies.
export function submitSearch(core, kind, text, cb) {
  const c = cb || {};
  const facts = searchGateFacts(core);
  const shown = core?.listSession?.state === 'active' ? core.listSession.readingPosition?.() : null;
  // The visible list owns its board while background fill rewrites the raw
  // terminal header. The latter can be blank when the search sheet submits.
  const board = boardNameFromKey(shown?.board) || parseBoardName(facts?.rowTexts[0]);
  // PTT checks the cap before opening a prompt, even for a repeated condition.
  if (kind !== 'board' && SEARCH_KINDS.includes(kind) && normalizeSearchText(kind, text) &&
      knownSearchConditionLimit(core, facts, board)) {
    c.onFail?.('search-limit');
    return true;
  }
  let candidate = null;
  let bm = null;
  let openRejected = false;
  const end = function(outcome) {
    if (bm) recordFor(core).end(bm, outcome);
    bm = null;
  };
  const callbacks = {
    onDone: function(a, b) {
      if (a?.searchLimit) {
        callbacks.onFail('search-limit');
        return;
      }
      if (a?.searchResults || isSearchResultsFrame(searchGateFacts(core), board)) recordSearchResults(core, candidate);
      end('done');
      if (c.onDone) c.onDone(a, b);
    },
    onFail: function(a, b) {
      end('fail');
      if (c.onFail) c.onFail(a, b);
    }
  };
  // Known dashboard destinations can bypass the intermediate board prompt.
  // Select this only on a free wire: a queued batch could otherwise be sent
  // after the verified main menu had already changed to another screen.
  const batch = kind === 'board' && c.knownBoard && core?.commandQueue?.idle &&
    !core.activeListSession?.() && !serializedOpHint(core) &&
    easyReadingOn(readValuesWithDefault()) && core.connectedUrl?.easyReadingSupported
    ? knownBoardEntryKeys(facts, text) : null;
  const built = batch ? [{
    keys: batch, kind: 'board-open-known', fullRepaint: true, ...SLOW_STEP_BUDGET,
    ...callbacks,
    expect: (snapshot, landing) => {
      const classified = classifyListScreen(landing);
      if (classified.kind === 'clean-list')
        return classified.boardName?.toLowerCase() === text.toLowerCase();
      // Release this command before the note owner queues its verified keys.
      // Keeping it in flight until the final list would deadlock that owner.
      return boardNoteDecision({ ...landing, ...classified }).action === 'skip';
    }
  }] : buildSearchSteps(kind, text, callbacks);
  if (!built || !core) return false;
  // The native prompt distinguishes a new search from an added condition even
  // on legacy captions. A generic select-mode list may instead be a digest.
  // A typed board (not the batched known-board entry) shows PTT's prompt and
  // then the board: the page under the sheet is held until easy reading
  // presents the board (#190).
  const hold = kind === 'board' && !batch ? beginBoardSearchHold(core) : null;
  if (hold) {
    const releaseOn = (fn) => function(a, b) {
      hold.release();
      if (fn) fn(a, b);
    };
    built.forEach((step) => {
      step.onFail = releaseOn(step.onFail);
      step.onFlushed = releaseOn(step.onFlushed);
    });
    const done = built[built.length - 1].onDone;
    built[built.length - 1].onDone = function(a, b) {
      hold.land({});
      if (done) done(a, b);
    };
  }
  if (!batch) built[0].onDone = result => {
    if (result?.searchLimit) {
      openRejected = true;
      // The notice consumes one key, then PTT redraws the existing results.
      // Replace the unsent keyword step while keeping the same list hold.
      Object.assign(built[1], {
        keys: KEY_DISMISS, kind: 'search-limit-dismiss', fullRepaint: false
      });
      return;
    }
    if (hold) hold.opened();
    const prompt = searchGateFacts(core);
    const append = /^增加條件 /.test(prompt?.rowTexts[prompt.rows - 1] || '');
    candidate = candidateSearchResults(core, board, { kind, value: normalizeSearchText(kind, text) }, append);
  };
  if (kind !== 'board' && board) {
    const expectPrompt = built[0].expect;
    built[0].expect = (snapshot, landing) => searchConditionLimitNotice(landing, board)
      ? { searchLimit: true } : expectPrompt(snapshot, landing);
    // Prompt disappearance can precede the results repaint. Keep ownership
    // until results or a known rejection are verified, so a close/reload cannot
    // persist the preceding query while the new results are already visible.
    built[1].expect = (snapshot, landing) => {
      if (openRejected) return searchResultsLanded(landing, board) ? { searchLimit: true } : false;
      const last = landing.rowTexts[landing.rows - 1] || '';
      if (landing.curY === landing.rows - 1 && SEARCH_RESULT_NOTICE.test(last)) return { searchNotice: true };
      return searchResultsLanded(landing, board) ? { searchResults: true } : false;
    };
  }
  bm = recordFor(core).begin(kind === 'board' ? 'board-search' : 'article-search');
  // 列表好讀接管中：凍結交易、結果列表一落地就回好讀（最後一步從 prompt 送出，
  // 見 list_session._beginLandingTransaction）。認不出（找不到的 vmsg、進板畫面）
  // 也不翻原生：凍著等靜置再判定（list_session._holdLanding，#206）。
  if (submitSerializedSteps(core, built, { kind: 'search', resumeOnLanding: true })) {
    // An unrelated search replaces any search trail, whether
    // it came from a key or from the search sheet.
    if (core.articleShortcutSearch) core.articleShortcutSearch.noteOtherSearch();
    return true;
  }
  if (hold) hold.release();
  bm = null;
  return false;
}

// submitSearch 的送出半段：多步序列（每步 {keys, kind, expect, onDone, onFail}）交給
// 「現在誰在畫列表」。opts.kind ＝ passthrough 的診斷名稱，opts.flag ＝在途旗標欄位名
// （預設 'searchInFlight'），opts.resumeOnLanding ＝列表好讀時走凍結交易、落地即回好讀
// （list_session._beginLandingTransaction 寫了誰能用）。回 false ＝沒送（線路被別的交易
// 佔住／沒有佇列）。
export function submitSerializedSteps(core, built, opts) {
  if (!built || !built.length || !core) return false;
  const o = opts || {};
  const flag = o.flag || 'searchInFlight';
  const steps = trackInFlight(core, built, flag);
  const owner = typeof core.activeListSession === 'function' ? core.activeListSession() : null;
  if (owner && typeof owner._beginPassthroughBytes === 'function') {
    // 序列化交易進行中（開文／凍結中的指令）：線路歸它，同 list_session.onFunctionKey
    // 的守門。呼叫端負責提示，不可無聲吞掉。
    if (owner.state === 'opening' || (owner.state === 'functionMode' && owner._renderMode === 'frozen'))
      return false;
    beginInFlight(core, flag);
    owner._beginPassthroughBytes(steps, {
      kind: o.kind || 'search',
      hint: null,
      resumeOnLanding: !!o.resumeOnLanding,
      // Where PTT's cursor is parked before the steps (ListSession, #279).
      parkCursor: o.parkCursor
    });
    return true;
  }
  const queue = core.commandQueue;
  if (!queue) return false;
  beginInFlight(core, flag);
  // 原生鏡像：文章好讀不會在列表上，這裡不必切 functionMode。
  const enqueue = function(i) {
    const step = steps[i];
    queue.enqueue({
      keys: step.keys,
      kind: step.kind,
      // 預設只有第一步補 \f；步驟自己指定時照它（unread_jump 每一步都要）。
      fullRepaint: 'fullRepaint' in step ? step.fullRepaint : i === 0,
      // 步驟自帶的預算（沒給＝佇列預設）。
      timeoutMs: step.timeoutMs,
      probeTimeoutMs: step.probeTimeoutMs,
      hardTimeoutMs: step.hardTimeoutMs,
      expect:
        step.expect ||
        function() {
          return true;
        },
      onDone: function(result) {
        if (step.onDone) step.onDone(result);
        if (i + 1 < steps.length) enqueue(i + 1);
      },
      onFail: step.onFail,
      onFlushed: step.onFlushed
    });
  };
  enqueue(0);
  return true;
}
