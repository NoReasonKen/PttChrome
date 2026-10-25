import { searchGateFacts, buildSearchSteps } from './article_search';
import { SLOW_STEP_BUDGET, isSubListTitle, AID_NOT_FOUND_RE } from './aid_navigation';
import { isArticleListFooter, isSubListFooter } from './screen_captions';
import { parseBoardName, boardNameFromKey } from './screen_titles';
import { serializedOpHint } from './serialized_op_gate';
import { recordFor } from './reading_record';
import {
  searchedFrom, backStep, returned, returnMissing, rebuilt,
  stoppedAtBoardList, reopenedAfterEmptySearch, observe,
  recoveryTarget, recoveryRecord, readRecoveryRecord, recovered, followsPlan
} from './search_return_history';
import { i18n } from './i18n';

const sameBoard = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const MESSAGE = /找不到符合條件的文章|搜尋服務異常|已達搜尋條件上限/;
const PRESS_ANY_KEY = /(?:請)?按任意鍵繼續|請按 空白鍵 繼續/;
const LIST_BACK_KEYS = ['ArrowLeft', 'q', 'e'];
const ARTICLE_BACK_KEYS = ['ArrowLeft', 'q'];
const keep = route => route;

// Local device state, deliberately outside the preference document: it is
// never exported or synchronized to the cloud.
export const SEARCH_RETURN_KEY = 'pttchrome.searchReturn.v1';

// Read once at startup and delete, like the reconnect-resume snapshot.
function takeStoredRecovery() {
  try {
    const raw = window.localStorage.getItem(SEARCH_RETURN_KEY);
    window.localStorage.removeItem(SEARCH_RETURN_KEY);
    return raw ? readRecoveryRecord(JSON.parse(raw), Date.now()) : null;
  } catch (e) {
    return null;
  }
}

function boardList(facts, board) {
  const rows = facts?.rowTexts || [];
  return sameBoard(parseBoardName(rows[0]), board) &&
    isArticleListFooter(rows[(facts?.rows || rows.length) - 1] || '');
}

function resultList(facts, board) {
  if (!boardList(facts, board)) return false;
  const rows = facts.rowTexts;
  // Old PTT captions do not distinguish search lists. This path is only armed
  // after our verified search prompt/query and invalidated by another search.
  return isSubListFooter(rows[facts.rows - 1]) || isSubListTitle(rows[0]) ||
    /^\s*文章選讀(?:\s|$)/.test(rows[facts.rows - 1]);
}

const fullBoardList = (facts, board) => boardList(facts, board) && !resultList(facts, board);

// Own article -> whole-board query -> source return transactions and their
// bounded search return history (search_return_history.js). Native Back from
// a result article remains native; the route owner replaces only the exits
// whose native destination would leave the route: a result list returns to
// its source by verified AID, and a reopened source (or its board-list
// fallback) rebuilds the results it belonged to.
export class ArticleShortcutSearch {
  constructor(core) {
    this.core = core;
    this.active = false;
    this.route = null;
    // A route waiting for its reconnect-resume plan: { route, target }. It is
    // inactive (Back and settles ignore it) until that plan's own transaction
    // lands on exactly its target (search_return_history.recovered).
    this.suspended = null;
    this._explainLater = false;
    this._stored = typeof window !== 'undefined' && window.localStorage ? takeStoredRecovery() : null;
    this._settled = () => this.noteSettle();
    core.buf.addEventListener('screenSettled', this._settled);
  }

  _hint(key) {
    this.core.view.flashListHint(i18n(key), 5000);
  }

  _resultsHint(kind) {
    this._hint(kind === 'author' ? 'articleShortcutSearch_results' : 'articleShortcutSearch_threadResults');
  }

  _begin(op) {
    this.active = true;
    this.op = op;
    const core = this.core;
    if (core.buf.pageState === 3) core.easyReading._enterFunctionMode();
    core.listSession?.beginExternalNavigation();
    core.boardListSession?.beginExternalNavigation();
  }

  start(kind = 'author') {
    const core = this.core;
    const view = core.view;
    if (!['author', 'thread'].includes(kind) || serializedOpHint(core) || core.modalShown ||
        !core.conn?.isConnected || core.buf.pageState !== 3 ||
        !view._articleBoard || (kind === 'author' ? !view._articleAuthor : !view._articleTitle)) return false;
    // The route is board-scoped; an article elsewhere starts a new one.
    if (this.route && !sameBoard(this.route.board, view._articleBoard)) this.route = null;
    const origin = {
      board: view._articleBoard,
      author: view._articleAuthor,
      title: view._articleTitle,
      query: { kind, value: kind === 'author' ? view._articleAuthor : view._articleTitle },
      position: recordFor(core).begin('article-shortcut-search')
    };
    this.pending = origin;
    // A failed forward search adds no origin; its source stays where it was.
    this._begin({ missing: stoppedAtBoardList, emptied: route => reopenedAfterEmptySearch(route, origin) });
    const fail = () => this._fail();
    core.aidNavigation.resolvePostAid({
      kind: 'shortcut-origin-info',
      onFlushed: fail,
      onFail: fail,
      onDone: (info, meta) => {
        if (!info?.aid || !sameBoard(info.board, origin.board)) {
          if (meta.boxOpen) this._dismissToList(origin, () => this._fail('articleShortcutSearch_missing'));
          else this._fail('articleShortcutSearch_missing', keep);
          return;
        }
        origin.aid = info.aid;
        this._selectThenQuery(origin, meta.boxOpen, 'forward');
      }
    });
    return true;
  }

  _selectThenQuery(origin, dismissFirst, mode) {
    const select = () => {
      if (!this.core.aidNavigation.selectArticle(origin.board, origin.aid, result => {
        if (!result.ok) return this._stopMissing(origin);
        this._query(origin, mode);
      })) this._fail();
    };
    if (dismissFirst) this._dismissToList(origin, select);
    else select();
  }

  _dismissToList(origin, done) {
    this._enqueue({
      keys: ' ',
      kind: 'shortcut-dismiss-info',
      fullRepaint: true,
      expect: (snapshot, facts) => boardList(facts, origin.board),
      onDone: done
    });
  }

  _enqueue(step) {
    this.core.commandQueue.enqueue({
      ...SLOW_STEP_BUDGET,
      fullRepaint: false,
      ...step,
      onFail: step.onFail || (() => this._fail()),
      onFlushed: () => this._fail()
    });
  }

  _query(origin, mode) {
    // The AID navigation has released its list hold. Reacquire synchronously
    // before queuing our query, so list paging cannot interleave commands.
    this.core.listSession?.beginExternalNavigation({ fromIdle: true });
    const kind = origin.query.kind;
    const steps = kind === 'author' ? buildSearchSteps('author', origin.query.value) : null;
    if (kind === 'author' && !steps) return this._reopen(origin, 'articleShortcutSearch_failed', this.op.emptied);
    const submit = () => this._enqueue({
      ...(steps ? steps[1] : { keys: 'S', fullRepaint: true }),
      kind: `shortcut-${kind}-submit`,
      expect: (snapshot, facts) => {
        const last = facts.rowTexts[facts.rows - 1] || '';
        // vmsg prints this known result on the input row and waits for a key,
        // even when its floating pause label does not fit the terminal width.
        if (facts.curY === facts.rows - 1 && MESSAGE.test(last)) {
          return { notice: /找不到符合條件的文章/.test(last) ? 'articleShortcutSearch_empty' : 'articleShortcutSearch_failed' };
        }
        return resultList(facts, origin.board) ? { results: true } : false;
      },
      onDone: result => {
        if (result.notice) {
          this._dismissToList(origin, () => this._reopen(origin, result.notice, this.op.emptied));
          return;
        }
        if (mode === 'forward') {
          this.route = searchedFrom(this.route, origin);
          recordFor(this.core).end(origin.position, 'done');
        } else {
          this.route = rebuilt(this.route);
        }
        this._finish();
        this._resultsHint(kind);
      }
    });
    // Native S uses subject(selectedHeader.title), without a prompt. It is
    // different from slash keyword search and must follow verified selection.
    if (steps) this._enqueue({ ...steps[0], kind: 'shortcut-author-open', fullRepaint: true, onDone: submit });
    else submit();
  }

  handleBack(event) {
    if (this.active || event.ctrlKey || event.altKey || event.metaKey) return false;
    const step = backStep(this.route);
    if (!step) return false;
    const core = this.core;
    const board = this.route.board;
    if (step.kind === 'restore') {
      if (!LIST_BACK_KEYS.includes(event.key) || this._listShown(board) !== 'results') return false;
      this.pending = null;
      this._begin({ missing: returnMissing });
      this._reopen(step.origin, 'articleShortcutSearch_returned', returned);
      return true;
    }
    const view = core.view;
    const at = this.route.at;
    const here = this.route.phase === 'reopened'
      ? core.buf.pageState === 3 && ARTICLE_BACK_KEYS.includes(event.key) && sameBoard(view._articleBoard, board) &&
        !!at && view._articleAuthor === at.author && view._articleTitle === at.title
      : this._listShown(board) === 'full' && LIST_BACK_KEYS.includes(event.key);
    if (!here) return false;
    // Rebuilding results selects the newest entry; never reopen an article
    // inside them. The following Back restores their source by AID instead.
    this.pending = null;
    this._begin({ missing: returnMissing, emptied: returned });
    this._selectThenQuery(step.origin, false, 'rebuild');
    return true;
  }

  // Which list of `board` the reader sees: 'results', 'full' or null. While
  // the easy-reading list shows its accumulated cards, its background fill
  // keeps rewriting the terminal behind them (blank footers after number
  // jumps, rows not yet decoded); its own board and numbering space are then
  // the evidence. Legacy captions cannot tell results from the full list, so
  // a raw result caption still counts as results.
  _listShown(board) {
    const facts = searchGateFacts(this.core);
    const session = this.core.listSession;
    if (session?.state === 'active') {
      const shown = session.readingPosition();
      if (!shown || !sameBoard(boardNameFromKey(shown.board), board)) return null;
      return shown.mode === 'select' || resultList(facts, board) ? 'results' : 'full';
    }
    if (resultList(facts, board)) return 'results';
    return boardList(facts, board) ? 'full' : null;
  }

  _reopen(origin, notice, transition) {
    const bookmark = { ...origin.position, feature: 'article-shortcut-return' };
    if (!this.core.aidNavigation.startResume({
      kind: 'article', board: origin.board, aid: origin.aid, bookmark
    }, result => {
      if (!result.ok) return this._stopMissing(origin);
      this.route = transition(this.route);
      this.pending = null;
      this._finish();
      this._hint(notice);
    })) this._fail();
  }

  _stopMissing(origin) {
    const facts = searchGateFacts(this.core);
    const rows = facts?.rowTexts || [];
    const paused = PRESS_ANY_KEY.test(rows[facts?.rows - 1] || '') &&
      AID_NOT_FOUND_RE.test(rows[facts?.rows - 2] || '') &&
      sameBoard(parseBoardName(rows[0]), origin.board);
    const missing = this.op.missing;
    // Failed #AID pauses above the list; leave that known message before
    // handing control back, never press Enter on the replacement selection.
    if (paused) this._dismissToList(origin, () => this._fail('articleShortcutSearch_missing', missing));
    else this._fail('articleShortcutSearch_missing', missing);
  }

  _finish() {
    this.active = false;
    this.pending = null;
    this.op = null;
    recordFor(this.core).releaseExternal();
  }

  // Origins survive only where the route can still be verified: the article
  // that never left, or the full board list standing in for a route article.
  _fail(notice = 'articleShortcutSearch_failed', transition = stoppedAtBoardList) {
    if (!this.active) return;
    if (this.pending?.position) recordFor(this.core).end(this.pending.position, 'fail');
    if (this.route && transition !== keep) {
      this.route = fullBoardList(searchGateFacts(this.core), this.route.board) ? transition(this.route) : null;
    }
    this._finish();
    this._hint(notice);
  }

  _screen() {
    const core = this.core;
    const view = core.view;
    if (core.buf.pageState === 3) {
      return { kind: 'article', board: view._articleBoard, author: view._articleAuthor, title: view._articleTitle };
    }
    if (core.buf.pageState === 1) return { kind: 'menu' };
    const facts = searchGateFacts(core);
    const board = parseBoardName(facts?.rowTexts[0]);
    if (!board) return { kind: 'other' };
    if (resultList(facts, board)) return { kind: 'results', board };
    if (boardList(facts, board) || !sameBoard(board, this.route.board)) return { kind: 'boardList', board };
    return { kind: 'other' };
  }

  noteSettle() {
    if (this._explainLater && this.core.conn?.isConnected) {
      this._explainLater = false;
      this._hint('articleShortcutSearch_recoveryInactive');
    }
    if (this.active || !this.route) return;
    this.route = observe(this.route, this._screen());
  }

  noteOtherSearch() {
    if (!this.active) this.route = null;
  }

  // Disconnection. A route captured by suspendForRecovery stays suspended.
  reset() {
    this.route = null;
    if (this.active) this._fail();
  }

  // Recovery hooks, called by reconnect_resume.js with the plan it will
  // resume. Automatic recovery's intermediate screens (login, main menu, board
  // entry) never reach the suspended route; only the plan's outcome does.

  _currentArticle() {
    const view = this.core.view;
    return this.core.buf.pageState === 3
      ? { board: view._articleBoard, author: view._articleAuthor, title: view._articleTitle }
      : null;
  }

  // The connection closed after login; `plan` is where reconnection returns.
  suspendForRecovery(plan) {
    const route = this.route;
    this.route = null;
    const target = route && recoveryTarget(plan, this._currentArticle());
    const had = !!this.suspended;
    this.suspended = target && sameBoard(route.board, target.board) ? { route, target } : null;
    if (!this.suspended && (route || had)) this._explain();
  }

  // The page may be closed or discarded: store the live (or still suspended)
  // route beside the reconnect-resume snapshot taken for the same `plan`.
  persistForRecovery(plan) {
    let record = null;
    if (this.route) record = recoveryRecord(this.route, recoveryTarget(plan, this._currentArticle()), Date.now());
    else if (this.suspended && plan && plan.board === this.suspended.target.board) {
      record = recoveryRecord(this.suspended.route, this.suspended.target, Date.now());
    }
    try {
      if (record) window.localStorage.setItem(SEARCH_RETURN_KEY, JSON.stringify(record));
      else window.localStorage.removeItem(SEARCH_RETURN_KEY);
    } catch (e) {
      // Storage blocked or full: the route simply does not survive a reload.
    }
  }

  // Startup: `plan` is the reconnect-resume plan restored from its snapshot,
  // or null. An expired or damaged record was already discarded silently.
  restoreForRecovery(plan) {
    const stored = this._stored;
    this._stored = null;
    if (!stored) return;
    if (followsPlan(stored.target, plan)) this.suspended = stored;
    else this._explain();
  }

  // The resume transaction for `plan` ended with `result`.
  recoveryEnded(plan, result) {
    const suspended = this.suspended;
    this.suspended = null;
    if (!suspended) return;
    const route = result?.ok ? recovered(suspended.route, suspended.target, plan, this._landed(suspended.target.board)) : null;
    if (!route) return this._explain();
    this.route = route;
    this._hint('articleShortcutSearch_recovered');
  }

  // Recovery will not run (logout, canceled, superseded, user moved first).
  abandonRecovery(reason) {
    if (!this.suspended) return;
    this.suspended = null;
    if (reason !== 'logout') this._explain();
  }

  _landed(board) {
    const article = this._currentArticle();
    if (article) return { kind: 'article', ...article };
    return this._listShown(board) === 'full' ? { kind: 'boardList', board } : { kind: 'other' };
  }

  _explain() {
    if (this.core.conn?.isConnected) this._hint('articleShortcutSearch_recoveryInactive');
    else this._explainLater = true;
  }
}
