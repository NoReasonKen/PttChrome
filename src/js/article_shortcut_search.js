import { searchGateFacts, buildSearchSteps, searchKindOfKey, isSearchPromptFrame } from './article_search';
import { parsePagerFooterContext } from './string_util';
import { SLOW_STEP_BUDGET, AID_NOT_FOUND_RE } from './aid_navigation';
import { parseBoardName, boardNameFromKey, sameBoard } from './screen_titles';
import { serializedOpHint } from './serialized_op_gate';
import { recordFor } from './reading_record';
import {
  searchedFrom, backStep, returned, returnMissing, rebuilt,
  stoppedAtBoardList, reopenedAfterEmptySearch, observe,
  recoveryTarget, recoveryRecord, recovered, followsPlan
} from './search_return_history';
import { takeStoredRecovery, storeRecovery } from './search_return_storage';
import { i18n } from './i18n';
import { isBoardArticleList as boardList, isSearchResultsFrame as resultList, searchResultsLanded, SEARCH_RESULT_NOTICE as MESSAGE } from './search_results_screen';
import { recordSearchResults, readSearchResultsContext, clearSearchResultsContext } from './search_results_context';
import { footerCaption } from './screen_captions';
import { PAGE } from './page_stack';
import { coverWithArticle } from './hidden_article_route';
import { EMPTY_TOOLBAR_CONTEXT } from './mobile_toolbar';
import { readEffectivePrefs } from './pref_storage';

const PRESS_ANY_KEY = /(?:請)?按任意鍵繼續|請按 空白鍵 繼續/;
// Results the easy-reading list has not presented by then show as they are.
const COVER_BOUND_MS = 5000;
const KEY_LEFT = '\x1b[D';
// A new author search, not a condition added to results (read.c#ask_filter_predicate).
const FRESH_AUTHOR_PROMPT = /^搜尋作者: /;
const LIST_BACK_KEYS = ['ArrowLeft', 'q', 'e'];
const ARTICLE_BACK_KEYS = ['ArrowLeft', 'q'];
const keep = route => route;

// The parsed identity of the article header on screen: { board, author, title }.
export function articleIdentity(core) {
  const view = core.view;
  return { board: view._articleBoard, author: view._articleAuthor, title: view._articleTitle };
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
    // The source article over the screen while its search runs, under the
    // App Bar it had (#83).
    this.cover = null;
    this.coverAppBar = null;
    this._uncoverTimer = null;
    this._explainLater = false;
    this._stored = takeStoredRecovery();
    this._settled = () => this.noteSettle();
    core.buf.addEventListener('screenSettled', this._settled);
  }

  // Returns the notice shown, for an owner that shows it again later.
  _hint(key) {
    const notice = { message: i18n(key), duration: 5000 };
    this.core.view.flashListHint(notice.message, notice.duration);
    return notice;
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
    const article = articleIdentity(core);
    if (!['author', 'thread'].includes(kind) || serializedOpHint(core) || core.modalShown ||
        !core.conn?.isConnected || core.buf.pageState !== 3 ||
        !article.board || (kind === 'author' ? !article.author : !article.title)) return false;
    // The route is board-scoped; an article elsewhere starts a new one.
    if (this.route && !sameBoard(this.route.board, article.board)) this.route = null;
    const origin = {
      ...article,
      query: { kind, value: kind === 'author' ? article.author : article.title },
      position: recordFor(core).begin('article-shortcut-search')
    };
    this.pending = origin;
    const fast = this._fastRoute(origin);
    core.articleGestures?.captureArticleLayer();
    this._cover();
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
        if (fast && !meta.boxOpen) this._fastQuery(origin);
        else this._selectThenQuery(origin, meta.boxOpen, 'forward');
      }
    });
    return true;
  }

  // The fast route (#86) is taken only where the app knows PTT's state: a
  // plain article, not one of pmore's movies that take Left themselves,
  // opened from its board's full list. Same-thread search also needs PTT's
  // selection there on this article.
  _fastRoute(origin) {
    const below = this.core.articleGestures?.fullListBelow();
    const kind = origin.query.kind;
    if (!below || (kind === 'thread' && !below.selected)) return false;
    const buf = this.core.buf;
    return parsePagerFooterContext(buf.getRowText(buf.rows - 1, 0, buf.cols)) === 'reading';
  }

  _selectThenQuery(origin, dismissFirst, mode) {
    const select = () => {
      if (!this.core.aidNavigation.selectArticle(origin.board, origin.aid, result => {
        if (result.ok) return this._query(origin, mode);
        // Rebuilt author results do not need their source: the author is known.
        // Same-thread search reads the selected source header, so it stops.
        if (mode === 'rebuild' && origin.query.kind === 'author') return this._queryWithoutSource(origin, mode);
        this._stopMissing(origin);
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
    // Native S is sent from the list, where PTT's cursor already sits on an entry.
    const submit = () => this._submit(origin, mode, steps ? steps[1] : { keys: 'S', fullRepaint: true }, { offEntries: !!steps });
    // Native S uses subject(selectedHeader.title), without a prompt. It is
    // different from slash keyword search and must follow verified selection.
    if (steps) this._enqueue({ ...steps[0], kind: 'shortcut-author-open', fullRepaint: true, onDone: submit });
    else submit();
  }

  // From an article opened from its board's full list, the keys that do no
  // harm wherever they land go together (#86): Left leaves the article, `a`
  // asks for an author, and `S` searches the thread of the article Left
  // leaves selected. The author id waits for PTT's fresh-search prompt: its
  // letters are list commands anywhere else.
  _fastQuery(origin) {
    const thread = origin.query.kind === 'thread';
    const steps = thread ? null : buildSearchSteps('author', origin.query.value);
    // An author the prompt cannot take is the verified route's to report.
    if (!thread && !steps) return this._selectThenQuery(origin, false, 'forward');
    this.core.listSession?.beginExternalNavigation({ fromIdle: true });
    // The pager parks PTT's cursor on its footer row, off every entry.
    if (thread) return this._submit(origin, 'forward', { keys: KEY_LEFT + 'S', fullRepaint: true }, { offEntries: true });
    this._enqueue({
      keys: KEY_LEFT + steps[0].keys,
      kind: 'shortcut-author-fast-open',
      fullRepaint: true,
      expect: (snapshot, facts) => isSearchPromptFrame('author', facts) && {
        fresh: FRESH_AUTHOR_PROMPT.test(facts.rowTexts[facts.rows - 1]) && sameBoard(parseBoardName(facts.rowTexts[0]), origin.board)
      },
      onDone: prompt => prompt.fresh ? this._submit(origin, 'forward', steps[1], { offEntries: true }) : this._leavePrompt(origin)
    });
  }

  // PTT asked something else than expected, such as adding a condition to
  // results: an empty answer cancels it, and the verified route runs from
  // the list.
  _leavePrompt(origin) {
    this._enqueue({
      keys: '\r',
      kind: 'shortcut-prompt-cancel',
      fullRepaint: true,
      expect: (snapshot, facts) => !isSearchPromptFrame('author', facts),
      onDone: () => this._selectThenQuery(origin, false, 'forward')
    });
  }

  // `offEntries`: the step is sent while PTT's cursor is off every list entry
  // (a prompt, the pager), so a results frame with the cursor on an entry was
  // parked there by the results themselves. From the list, the first settle
  // of the results can still show the old cursor (ListSession's
  // RESUME_QUIET_MS).
  _submit(origin, mode, step, { offEntries }) {
    const kind = origin.query.kind;
    this._enqueue({
      ...step,
      kind: `shortcut-${kind}-submit`,
      expect: (snapshot, facts) => {
        const last = facts.rowTexts[facts.rows - 1] || '';
        // vmsg prints this known result on the input row and waits for a key,
        // even when its floating pause label does not fit the terminal width.
        if (facts.curY === facts.rows - 1 && MESSAGE.test(last)) {
          return { notice: /找不到符合條件的文章/.test(last) ? 'articleShortcutSearch_empty' : 'articleShortcutSearch_failed' };
        }
        // `proven`: the caption names results; the legacy caption every list
        // shares does not.
        return searchResultsLanded(facts, origin.board) ? { results: true, proven: resultList(facts, origin.board, false) } : false;
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
        recordSearchResults(this.core, { board: origin.board, filters: [kind === 'thread'
          ? { kind, aid: origin.aid, title: origin.title }
          : { kind, value: origin.query.value }] });
        // Results proven by their caption and cursor are taken over at once
        // (#86). Under the legacy caption the list cannot tell them from the
        // full list, and takes them over after its quiet wait as before.
        this._finish({ landed: result.proven && offEntries });
        this._uncoverOnResults();
        this._resultsHint(kind);
      }
    });
  }

  handleBack(event) {
    if (this.active || event.ctrlKey || event.altKey || event.metaKey) return false;
    const step = backStep(this.route);
    if (!step) return false;
    const core = this.core;
    const board = this.route.board;
    if (step.kind === 'restore') {
      if (!LIST_BACK_KEYS.includes(event.key) || this._listShown(board) !== 'results') return false;
      if (this._revealBelow(event)) return true;
      clearSearchResultsContext(core);
      this.pending = null;
      this._begin({ missing: returnMissing });
      this._reopen(step.origin, 'articleShortcutSearch_returned', returned);
      return true;
    }
    const at = this.route.at;
    const article = this._currentArticle();
    const here = this.route.phase === 'reopened'
      ? !!article && ARTICLE_BACK_KEYS.includes(event.key) && sameBoard(article.board, board) &&
        !!at && article.author === at.author && article.title === at.title
      : this._listShown(board) === 'full' && LIST_BACK_KEYS.includes(event.key);
    if (!here) return false;
    if (this._revealBelow(event)) return true;
    // Rebuilding results selects the newest entry; never reopen an article
    // inside them. The following Back restores their source by AID instead.
    this.pending = null;
    this._begin({ missing: returnMissing, emptied: returned });
    this._selectThenQuery(step.origin, false, 'rebuild');
    return true;
  }

  // The page kept below slides into view first (#49); its Back comes back
  // here once the stack sends it.
  _revealBelow(event) {
    return !!this.core.articleGestures?.handleBack(event);
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
      this._uncover();
      this.core.articleGestures?.pagePresented(PAGE.ARTICLE);
      this._hint(notice);
    })) this._fail();
  }

  // Failed #AID pauses with a known message above the full board list.
  _missingPause(origin) {
    const facts = searchGateFacts(this.core);
    const rows = facts?.rowTexts || [];
    return PRESS_ANY_KEY.test(rows[facts?.rows - 1] || '') &&
      AID_NOT_FOUND_RE.test(rows[facts?.rows - 2] || '') &&
      sameBoard(parseBoardName(rows[0]), origin.board);
  }

  _stopMissing(origin) {
    const missing = this.op.missing;
    // Leave the known message before handing control back, never press Enter
    // on the replacement selection.
    if (this._missingPause(origin)) this._dismissToList(origin, () => this._fail('articleShortcutSearch_missing', missing));
    else this._fail('articleShortcutSearch_missing', missing);
  }

  // The source could not be selected, but its query can still run from the
  // verified full board list. Its own Back later finds the source missing.
  _queryWithoutSource(origin, mode) {
    const query = () => {
      if (fullBoardList(searchGateFacts(this.core), origin.board)) this._query(origin, mode);
      else this._stopMissing(origin);
    };
    if (this._missingPause(origin)) this._dismissToList(origin, query);
    else query();
  }

  _finish(release) {
    this.active = false;
    this.pending = null;
    this.op = null;
    recordFor(this.core).releaseExternal(release);
  }

  _cover() {
    this._uncover();
    this.coverAppBar = this.core._screenContext?.appBar || null;
    this.cover = coverWithArticle(this.core.view);
    this.core._refreshScreenContext?.();
  }

  _uncover() {
    clearTimeout(this._uncoverTimer);
    this._uncoverTimer = null;
    if (!this.cover) return;
    this.cover.destroy();
    this.cover = null;
    this.core._refreshScreenContext?.();
  }

  // The results have landed: the easy-reading list takes over once it
  // presents them, PTT's own list at once.
  _uncoverOnResults() {
    if (!this.cover) return;
    if (!readEffectivePrefs().enableEasyReadingList) return this._uncover();
    this._uncoverTimer = setTimeout(() => this._uncover(), COVER_BOUND_MS);
  }

  // The easy-reading list presented a page.
  listPresented() {
    if (!this.active) this._uncover();
  }

  // While the cover is up, the toolbar and App Bar stay those of the article
  // it shows.
  toolbarContext() {
    if (!this.cover) return null;
    return { ...EMPTY_TOOLBAR_CONTEXT, appBar: this.coverAppBar || EMPTY_TOOLBAR_CONTEXT.appBar, locked: true };
  }

  // Origins survive only where the route can still be verified: the article
  // that never left, or the full board list standing in for a route article.
  _fail(notice = 'articleShortcutSearch_failed', transition = stoppedAtBoardList) {
    if (!this.active) return;
    this._uncover();
    // A search that found nothing keeps no layer of its source.
    this.core.articleGestures?.dropPendingLayer();
    if (this.pending?.position) recordFor(this.core).end(this.pending.position, 'fail');
    if (this.route && transition !== keep) {
      this.route = fullBoardList(searchGateFacts(this.core), this.route.board) ? transition(this.route) : null;
    }
    this._finish();
    this._hint(notice);
  }

  _screen() {
    const core = this.core;
    const article = this._currentArticle();
    if (article) return { kind: 'article', ...article };
    if (core.buf.pageState === 1) return { kind: 'menu' };
    const shown = this._listShown(this.route.board);
    if (shown) return { kind: shown === 'results' ? 'results' : 'boardList', board: this.route.board };
    const facts = searchGateFacts(core);
    const board = parseBoardName(facts?.rowTexts[0]);
    if (!board) return { kind: 'other' };
    if (resultList(facts, board)) return { kind: 'results', board };
    if (boardList(facts, board) || !sameBoard(board, this.route.board)) return { kind: 'boardList', board };
    return { kind: 'other' };
  }

  noteSettle() {
    if (this.core.articleResize?.active || this.core.listResize?.active) return;
    if (this._explainLater && this.core.conn?.isConnected) {
      this._explainLater = false;
      this._hint('articleShortcutSearch_recoveryInactive');
    }
    // Query metadata belongs to the current results even without a shortcut
    // return route. Automatic navigation and background paging own transients.
    if (!this.active && !this.core.searchInFlight && !this.core.aidNavigation?.active) {
      const context = readSearchResultsContext(this.core);
      const facts = context && searchGateFacts(this.core);
      const board = parseBoardName(facts?.rowTexts[0]);
      if (context && (this.core.buf.pageState === 1 ||
          (facts?.inputField && this.core.listSession?.state !== 'active' && !this.core.commandQueue?.inFlightKind) ||
          footerCaption(facts?.rowTexts[facts.rows - 1]) === '文摘列表' ||
          (this.core.buf.pageState === 2 && this._listShown(context.board) === 'full') ||
          (board && !sameBoard(board, context.board)))) {
        clearSearchResultsContext(this.core);
      }
    }
    if (this.active || !this.route) return;
    this.route = observe(this.route, this._screen());
  }

  // A search key pressed by the reader. Only list searches replace the route:
  // inside an article the same keys are PTT's in-article text search and
  // reading commands. `S` is the native same-thread search of the list.
  noteSearchKey(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || this.core.buf.pageState !== 2) return;
    if (LIST_BACK_KEYS.includes(event.key)) clearSearchResultsContext(this.core);
    if (searchKindOfKey(event.key) || event.key === 'S') this.noteOtherSearch();
    if (event.key === 'S') clearSearchResultsContext(this.core);
  }

  noteOtherSearch() {
    if (!this.active) this.route = null;
  }

  // Disconnection. A route captured by suspendForRecovery stays suspended.
  reset() {
    this.route = null;
    clearSearchResultsContext(this.core);
    if (this.active) this._fail();
    this._uncover();
  }

  // Recovery hooks, called by reconnect_resume.js with the plan it will
  // resume. Automatic recovery's intermediate screens (login, main menu, board
  // entry) never reach the suspended route; only the plan's outcome does.

  _currentArticle() {
    return this.core.buf.pageState === 3 ? articleIdentity(this.core) : null;
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
    else if (this.suspended && plan && sameBoard(plan.board, this.suspended.target.board)) {
      record = recoveryRecord(this.suspended.route, this.suspended.target, Date.now());
    }
    storeRecovery(record);
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

  // The resume transaction for `plan` ended with `result`. Returns the notice
  // explaining the outcome, if any.
  recoveryEnded(plan, result) {
    const suspended = this.suspended;
    this.suspended = null;
    if (!suspended) return;
    const route = result?.ok ? recovered(suspended.route, suspended.target, plan, this._landed(suspended.target.board)) : null;
    if (!route) return this._explain();
    this.route = route;
    return this._hint('articleShortcutSearch_recovered');
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
    const shown = this._listShown(board);
    return shown ? { kind: shown === 'full' ? 'boardList' : 'results', board } : { kind: 'other' };
  }

  _explain() {
    if (this.core.conn?.isConnected) return this._hint('articleShortcutSearch_recoveryInactive');
    this._explainLater = true;
  }
}
