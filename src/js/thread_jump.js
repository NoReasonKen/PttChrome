// Far same-thread jumps from an article (#65). PTT's thread jump scans at most
// THREAD_SEARCH_RANGE (500) records from the article being read and treats a
// target beyond that as missing: `[` and `=` show the same article again, `]`
// returns to the article list, and `=` stops on the earliest reply it passed.
// The same-thread search narrows the list to the thread, where the target is
// always in range.
import { articleContextFromListRow, articleContextFromScreen, pageArticleNums } from './comment_parse';
import { searchResultIdentity } from './search_result_anchor';
import { parseStatusRow } from './string_util';
import { HiddenArticleRoute } from './hidden_article_route';
import { isBoardArticleList, isSearchResultsFrame, searchResultsLanded } from './search_results_screen';
import { createUnderlay, raiseSurfaces, releaseSurfaces, paintSurfaces, slideDuration } from './stack_motion';
import { STACK_NOTICE_MS } from './stack_layer';
import { PAGE } from './page_stack';
import { recordFor } from './reading_record';
import { readEffectivePrefs } from './pref_storage';
import { i18n } from './i18n';

const KEYS = { '[': '[', '-': '[', ']': ']', '+': ']', '=': '=' };

// The pager's same-thread key for `key`, its aliases included, or null.
export function threadJumpKey(key) {
  return KEYS[key] || null;
}

// PTT's subject(): a reply or forward of the thread's original.
const REPLY_TITLE = /^(?:re|fw):/i;

// The answer to thread key `key` followed by a redraw, read on its frame.
// `source` is the article the jump started from: { author, title, time }.
//   'landed': another article, so the jump landed;
//   'reply':  a first-in-thread jump on a reply: PTT falls back to the
//             earliest reply it passed when the original lies beyond its range;
//   'same':   the source again, so PTT found nothing within its range;
//   'list':   the article list, the same for a next-in-thread jump;
//   null:     not an answer yet.
export function threadAnswer(facts, source, key) {
  if (facts.kind === 'clean-list') return 'list';
  const rows = facts.rowTexts;
  const status = parseStatusRow(rows[facts.rows - 1] || '');
  if (facts.kind !== 'article' && !status) return null;
  const shown = articleContextFromScreen(rows[0], rows[1], status, rows.slice(2, 4));
  if (!shown?.title) return 'landed';
  if (shown.author === source.author && shown.title === source.title && shown.time === source.time) return 'same';
  return key === '=' && REPLY_TITLE.test(shown.title) ? 'reply' : 'landed';
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

const MODAL_SOURCE = 'threadJump';

const cursorText = facts => facts.rowTexts[facts.curY] || '';

// One same-thread jump typed in an easy-reading article. The key goes out with
// a redraw; when PTT answers that it found nothing, the jump continues through
// the same-thread search and lands where a jump in range would have: the full
// article list underneath, the cursor on the target, the target open. The
// source article stays on screen under its own App Bar, with the progress bar
// running, until the target shows; reader input waits (serializedOpHint).
export class ThreadJump extends HiddenArticleRoute {
  constructor(core) {
    super(core, { name: 'threadJump', kind: 'thread-jump', failed: 'threadJump_failed' });
    this.slide = null;
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
    this.key = k;
    this.source = source;
    this._begin(core._screenContext?.appBar || null);
    this._enqueue({
      keys: k,
      kind: 'thread-jump',
      expect: (snapshot, facts) => {
        const answer = threadAnswer(facts, source, k);
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

  _fullList(facts) {
    const board = this.source.board;
    return isBoardArticleList(facts, board) && !isSearchResultsFrame(facts, board, false) &&
      facts.curY >= 3 && facts.curY < facts.rows - 1 && facts;
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
        this._open('\r', articleContextFromListRow(cursorText(facts), this.source.board));
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

  _finishAtList() {
    if (this._slideToList()) return;
    this.active = false;
    recordFor(this.core).releaseExternal();
    this._end();
  }

  // Under article-list easy reading, the source slides away as on Back, over
  // the list it was opened from, selected at the source, or the dark fallback
  // when that list has no live layer with the source's row, and the list takes
  // over once its session presents it again.
  _slideToList() {
    const core = this.core;
    const stack = core.articleGestures?.stack;
    if (!this.cover || !stack || !readEffectivePrefs().enableEasyReadingList) return false;
    const layer = stack.revealable();
    const underlay = createUnderlay(core, layer, stack.title);
    const surfaces = raiseSurfaces([this.cover.el, document.getElementById('mobileAppBar')]);
    const duration = slideDuration();
    this.slide = { underlay, surfaces, timer: null };
    for (const { node } of surfaces) node.style.transition = `translate ${duration}ms ease-out`;
    paintSurfaces(surfaces, window.innerWidth);
    this.slide.timer = setTimeout(() => {
      this.slide.timer = null;
      stack.begin({
        level: PAGE.ARTICLE,
        // PTT already shows the list: the parked session presents it.
        send: () => {
          this.active = false;
          core.holdBusy?.(false);
          core.setModalOpen(MODAL_SOURCE, true);
          recordFor(core).releaseExternal();
          return true;
        },
        finish: () => this._end(),
        cancel: () => this._end(),
        hint: () => core.view.flashListHint?.(i18n('stack_handoffTimeout'), STACK_NOTICE_MS)
      });
    }, duration);
    return true;
  }

  _removeSlide() {
    const slide = this.slide;
    if (!slide) return;
    this.slide = null;
    clearTimeout(slide.timer);
    releaseSurfaces(slide.surfaces);
    slide.underlay.remove();
    this.core.setModalOpen(MODAL_SOURCE, false);
  }

  _end() {
    this._removeSlide();
    super._end();
  }
}
