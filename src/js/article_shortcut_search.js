import { searchGateFacts, buildSearchSteps } from './article_search';
import { SLOW_STEP_BUDGET, isSubListTitle, AID_NOT_FOUND_RE } from './aid_navigation';
import { isArticleListFooter, isSubListFooter } from './screen_captions';
import { parseBoardName } from './screen_titles';
import { serializedOpHint } from './serialized_op_gate';
import { recordFor } from './reading_record';
import { i18n } from './i18n';

const sameBoard = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const MESSAGE = /找不到符合條件的文章|搜尋服務異常|已達搜尋條件上限/;
const PRESS_ANY_KEY = /(?:請)?按任意鍵繼續|請按 空白鍵 繼續/;

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

// Own the entire article -> whole-board query -> source return transaction.
// Native Back from a result article remains native; only its result-list exit
// is replaced with a verified AID return.
export class ArticleShortcutSearch {
  constructor(core) {
    this.core = core;
    this.active = false;
    this.route = null;
    this._settled = () => this.noteSettle();
    core.buf.addEventListener('screenSettled', this._settled);
  }

  _hint(key) {
    this.core.view.flashListHint(i18n(key), 5000);
  }

  start(kind = 'author') {
    const core = this.core;
    const view = core.view;
    if (!['author', 'thread'].includes(kind) || serializedOpHint(core) || core.modalShown ||
        !core.conn?.isConnected || core.buf.pageState !== 3 ||
        !view._articleBoard || (kind === 'author' ? !view._articleAuthor : !view._articleTitle)) return false;
    const bookmark = recordFor(core).begin('article-shortcut-search');
    const origin = {
      board: view._articleBoard,
      author: view._articleAuthor,
      title: view._articleTitle,
      bookmark
    };
    this.active = true;
    this.route = null;
    this.pending = origin;
    core.easyReading._enterFunctionMode();
    core.listSession?.beginExternalNavigation();
    core.boardListSession?.beginExternalNavigation();
    const fail = () => this._fail();
    core.aidNavigation.resolvePostAid({
      kind: 'shortcut-origin-info',
      onFlushed: fail,
      onFail: fail,
      onDone: (info, meta) => {
        if (!info?.aid || !sameBoard(info.board, origin.board)) {
          if (meta.boxOpen) this._dismissToList(origin, () => this._fail('articleShortcutSearch_missing'));
          else this._fail('articleShortcutSearch_missing');
          return;
        }
        origin.aid = info.aid;
        const select = () => {
          if (!core.aidNavigation.selectArticle(origin.board, origin.aid, result => {
            if (!result.ok) return this._stopMissing(origin);
            this._query(origin, kind);
          })) this._fail();
        };
        if (meta.boxOpen) this._dismissToList(origin, select);
        else select();
      }
    });
    return true;
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

  _query(origin, kind) {
    // The AID navigation has released its list hold. Reacquire synchronously
    // before queuing our query, so list paging cannot interleave commands.
    this.core.listSession?.beginExternalNavigation({ fromIdle: true });
    const steps = kind === 'author' ? buildSearchSteps('author', origin.author) : null;
    if (kind === 'author' && !steps) return this._restore(origin, 'articleShortcutSearch_failed');
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
          this._dismissToList(origin, () => this._restore(origin, result.notice));
          return;
        }
        this.route = { origin, phase: 'results', query: { kind, value: kind === 'author' ? origin.author : origin.title } };
        recordFor(this.core).end(origin.bookmark, 'done');
        this._finish();
        this._hint(kind === 'author' ? 'articleShortcutSearch_results' : 'articleShortcutSearch_threadResults');
      }
    });
    // Native S uses subject(selectedHeader.title), without a prompt. It is
    // different from slash keyword search and must follow verified selection.
    if (steps) this._enqueue({ ...steps[0], kind: 'shortcut-author-open', fullRepaint: true, onDone: submit });
    else submit();
  }

  handleBack(event) {
    if (this.active || !this.route || event.ctrlKey || event.altKey || event.metaKey ||
        !['ArrowLeft', 'q', 'e'].includes(event.key)) return false;
    const facts = searchGateFacts(this.core);
    if (this.route.phase !== 'results' || !resultList(facts, this.route.origin.board)) return false;
    const origin = this.route.origin;
    this.active = true;
    this.pending = origin;
    this._restore(origin, 'articleShortcutSearch_returned');
    return true;
  }

  _restore(origin, notice) {
    this.route = null;
    this.pending = origin;
    this.active = true;
    const bookmark = { ...origin.bookmark, feature: 'article-shortcut-return' };
    if (!this.core.aidNavigation.startResume({
      kind: 'article', board: origin.board, aid: origin.aid, bookmark
    }, result => {
      if (!result.ok) return this._stopMissing(origin);
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
    // Failed #AID pauses above the list; leave that known message before
    // handing control back, never press Enter on the replacement selection.
    if (paused) this._dismissToList(origin, () => this._fail('articleShortcutSearch_missing'));
    else this._fail('articleShortcutSearch_missing');
  }

  _finish() {
    this.active = false;
    this.pending = null;
    recordFor(this.core).releaseExternal();
  }

  _fail(notice = 'articleShortcutSearch_failed') {
    if (!this.active) return;
    if (this.pending?.bookmark) recordFor(this.core).end(this.pending.bookmark, 'fail');
    this.route = null;
    this._finish();
    this._hint(notice);
  }

  noteSettle() {
    if (this.active || !this.route) return;
    const core = this.core;
    const facts = searchGateFacts(core);
    if (core.buf.pageState === 3 && sameBoard(core.view._articleBoard, this.route.origin.board)) {
      this.route.phase = 'article';
    } else if (resultList(facts, this.route.origin.board)) {
      this.route.phase = 'results';
    } else if (boardList(facts, this.route.origin.board) ||
      (parseBoardName(facts?.rowTexts[0]) && !sameBoard(parseBoardName(facts.rowTexts[0]), this.route.origin.board)) ||
      core.buf.pageState === 1) {
      this.route = null;
    }
  }

  noteOtherSearch() {
    if (!this.active) this.route = null;
  }

  reset() {
    this.route = null;
    if (this.active) this._fail();
  }
}
