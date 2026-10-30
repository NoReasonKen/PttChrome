// Far same-thread jumps from an article (#65). PTT's thread jump scans at most
// THREAD_SEARCH_RANGE (500) records from the article being read and treats a
// target beyond that as missing: `[` and `=` show the same article again, `]`
// returns to the article list. The same-thread search narrows the list to the
// thread, where the target is always in range.
import { articleContextFromScreen, pageArticleNums } from './comment_parse';
import { searchResultIdentity } from './search_result_anchor';
import { parseStatusRow } from './string_util';
import { SLOW_STEP_BUDGET } from './aid_navigation';
import { isBoardArticleList, isSearchResultsFrame, searchResultsLanded } from './search_results_screen';
import { StackArticleLayer } from './stack_article_layer';
import { EMPTY_TOOLBAR_CONTEXT } from './mobile_toolbar';
import { recordFor } from './reading_record';
import { i18n } from './i18n';

const KEYS = { '[': '[', '-': '[', ']': ']', '+': ']', '=': '=' };

// The pager's same-thread key for `key`, its aliases included, or null.
export function threadJumpKey(key) {
  return KEYS[key] || null;
}

// The answer to a thread key followed by a redraw, read on its frame. `source`
// is the article the jump started from: { author, title, time }.
//   'landed': another article, so the jump landed;
//   'same':   the source again, so PTT found nothing within its range;
//   'list':   the article list, the same for a next-in-thread jump;
//   null:     not an answer yet.
export function threadAnswer(facts, source) {
  if (facts.kind === 'clean-list') return 'list';
  const rows = facts.rowTexts;
  const status = parseStatusRow(rows[facts.rows - 1] || '');
  if (facts.kind !== 'article' && !status) return null;
  const shown = articleContextFromScreen(rows[0], rows[1], status, rows.slice(2, 4));
  if (!shown?.title) return 'landed';
  return shown.author === source.author && shown.title === source.title && shown.time === source.time
    ? 'same' : 'landed';
}

const rowNums = facts => pageArticleNums(facts.rowTexts, facts.curY).slice(3, facts.rows - 1);

// The result number of the row whose identity is `key` (see
// searchResultIdentity), or null when it is not on the page or not unique.
export function findResultRow(facts, key) {
  const nums = rowNums(facts);
  let found = null;
  facts.rowTexts.slice(3, facts.rows - 1).forEach((text, i) => {
    const id = nums[i] != null && searchResultIdentity(text);
    if (!id || id.author !== key.author || id.title !== key.title || id.date !== key.date) return;
    found = found == null ? nums[i] : -1;
  });
  return found > 0 ? found : null;
}

// The first result number on the page, or null.
export function resultsTopNum(facts) {
  return rowNums(facts).find(num => num != null) ?? null;
}

// How many result pages above the last one the source is looked for.
const MAX_RESULT_PAGES = 10;
const LIST_BACK = '\x1b[D';
const PAGE_UP = '\x1b[5~';

const lastRow = facts => facts.rowTexts[facts.rows - 1] || '';
const articleShown = facts => facts.kind === 'article' || !!parseStatusRow(lastRow(facts));
const cursorText = facts => facts.rowTexts[facts.curY] || '';

// One same-thread jump typed in an easy-reading article. The key goes out with
// a redraw; when PTT answers that it found nothing, the jump continues through
// the same-thread search and lands where a jump in range would have: the full
// article list underneath, the cursor on the target, the target open. The
// source article stays on screen under its own App Bar, with the progress bar
// running, until the target shows; reader input waits (serializedOpHint).
export class ThreadJump {
  constructor(core) {
    this.core = core;
    this.active = false;
    this.cover = null;
  }

  // Takes `key` when it is a same-thread key and the article on screen can be
  // told apart from its neighbours. Returns true when it sent the key.
  start(key) {
    const core = this.core;
    const view = core.view;
    const k = threadJumpKey(key);
    const source = { author: view._articleAuthor, title: view._articleTitle, time: view._articleTime, board: view._articleBoard };
    if (!k || this.active || !core.commandQueue || !core.conn?.isConnected || core.buf.pageState !== 3 ||
        !source.author || !source.title || !source.time || !source.board) return false;
    this.active = true;
    this.held = false;
    this.key = k;
    this.source = source;
    this.appBar = core._screenContext?.appBar || null;
    this._cover();
    this._enqueue({
      keys: k,
      kind: 'thread-jump',
      expect: (snapshot, facts) => {
        const answer = threadAnswer(facts, source);
        return answer && { answer, facts };
      },
      onDone: ({ answer, facts }) => {
        if (answer === 'landed') return this._end();
        this._hold();
        if (answer === 'list') this._fromList(facts);
        else this._enqueue({ keys: LIST_BACK, kind: 'thread-jump-list', expect: (snapshot, facts) => this._fullList(facts), onDone: facts => this._fromList(facts) });
      }
    });
    return true;
  }

  // While the source covers the screen, the toolbar and App Bar stay its own.
  toolbarContext() {
    if (!this.active) return null;
    return { ...EMPTY_TOOLBAR_CONTEXT, appBar: this.appBar || EMPTY_TOOLBAR_CONTEXT.appBar, locked: true };
  }

  // Disconnection.
  reset() {
    if (this.active) this._end();
  }

  _enqueue(step) {
    this.core.commandQueue.enqueue({
      ...SLOW_STEP_BUDGET,
      fullRepaint: true,
      ...step,
      onFail: () => this._fail(),
      onFlushed: () => this._fail()
    });
  }

  _fullList(facts) {
    const board = this.source.board;
    return isBoardArticleList(facts, board) && !isSearchResultsFrame(facts, board, false) &&
      facts.curY >= 3 && facts.curY < facts.rows - 1 && facts;
  }

  // The jump continues out of sight: the sessions that would present the
  // screens on the way are parked, as for any external navigation.
  _hold() {
    const core = this.core;
    this.held = true;
    core.holdBusy?.(true);
    core.easyReading?._enterFunctionMode();
    core.listSession?.beginExternalNavigation();
    core.boardListSession?.beginExternalNavigation();
  }

  // The full list, the cursor on the source article.
  _fromList(facts) {
    const board = this.source.board;
    const key = searchResultIdentity(cursorText(facts));
    // Opened from search results, the jump already searched the thread.
    if (isSearchResultsFrame(facts, board, false) || !key) return this._native(false);
    this.sourceNum = facts.cursorRowNum ?? pageArticleNums(facts.rowTexts, facts.curY)[facts.curY];
    this.sourceKey = key;
    this._enqueue({
      keys: 'S',
      kind: 'thread-jump-search',
      expect: (snapshot, facts) => searchResultsLanded(facts, board) && facts,
      onDone: facts => this._locate(facts, 0)
    });
  }

  _locate(facts, pages) {
    const num = findResultRow(facts, this.sourceKey);
    if (num != null) return this._moveInResults(num);
    if ((resultsTopNum(facts) ?? 1) > 1 && pages < MAX_RESULT_PAGES) {
      return this._enqueue({
        keys: PAGE_UP,
        kind: 'thread-jump-page',
        expect: (snapshot, facts) => searchResultsLanded(facts, this.source.board) && facts,
        onDone: facts => this._locate(facts, pages + 1)
      });
    }
    this._native(true);
  }

  // Within the results the target is in range; leaving them keeps the
  // cursor on it in the full list.
  _moveInResults(num) {
    this._enqueue({
      keys: num + '\r' + this.key + LIST_BACK,
      kind: 'thread-jump-move',
      expect: (snapshot, facts) => this._fullList(facts),
      onDone: facts => {
        const target = searchResultIdentity(cursorText(facts));
        const same = target && target.author === this.sourceKey.author && target.title === this.sourceKey.title &&
          target.date === this.sourceKey.date;
        if (same && this.key === ']') return this._finishAtList();
        this._open('\r');
      }
    });
  }

  // Nothing to land on: PTT's own answer, the same article again for `[` and
  // `=`, the list for `]`. `inResults`: the source is selected again first.
  _native(inResults) {
    if (inResults && this.sourceNum == null) return this._fail();
    const select = inResults ? LIST_BACK + this.sourceNum + '\r' : '';
    if (this.key !== ']') return this._open(select + '\r');
    if (!select) return this._finishAtList();
    this._enqueue({ keys: select, kind: 'thread-jump-select', expect: (snapshot, facts) => this._fullList(facts), onDone: () => this._finishAtList() });
  }

  _open(keys) {
    this._enqueue({
      keys,
      kind: 'thread-jump-open',
      expect: (snapshot, facts) => articleShown(facts),
      onDone: () => {
        // Unlock first: easy reading's paging waits for no transaction.
        this.active = false;
        this.core.easyReading?.ensureEnabledOnArticle(true, 'threadJump');
        recordFor(this.core).releaseExternal();
        this._end();
      }
    });
  }

  _finishAtList() {
    this.active = false;
    recordFor(this.core).releaseExternal();
    this._end();
  }

  _fail() {
    if (!this.active) return;
    const held = this.held;
    this._end();
    if (held) recordFor(this.core).releaseExternal({ listNotice: i18n('threadJump_failed') });
    this.core.view.flashListHint?.(i18n('threadJump_failed'), 4000);
  }

  _cover() {
    const layer = StackArticleLayer.capture(this.core.view);
    if (!layer) return;
    this.cover = layer;
    layer.show(true);
    layer.el.style.zIndex = '150';
    for (const type of COVER_INPUT) layer.el.addEventListener(type, event => event.stopPropagation());
  }

  _end() {
    const core = this.core;
    this.active = false;
    this.cover?.destroy();
    this.cover = null;
    core.holdBusy?.(false);
    core._refreshScreenContext?.();
  }
}

// Input on the cover stays on it; nothing reaches the terminal.
const COVER_INPUT = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'contextmenu', 'dblclick'];
