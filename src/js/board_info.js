// Board information (#288): `i` / `I` on the easy-reading article list, 看板資訊
// in the list's context menu (desktop) and in the list's More sheet (phone).
// PTT's `i` (bbs.c#bbs_cmd_config → board.c#b_config) draws the board's
// settings as a PSB list of read-only rows over more than one page; the app
// reads every page and shows the rows, as PTT prints them, in its own sheet
// (mobile) or dialog (desktop). Read-only for everyone: no Ctrl-P editing and
// no reader for the moderation log (its row is shown as text).
//
// PTT's screen is never shown: it is held under the list while the sequence
// runs, each key going out only after PTT answered the one before
// (docs/pttbbs-screen-protocol.md §11.10):
//   `i`        ⇒ the first page (board_info_parse.parseBoardInfoPage)
//   PgDn       ⇒ the next page, until a page is not full or brings nothing new
//   ←          ⇒ the list (ListSession.showsHeldList); the list takes its frame
//                back with its rows, selection and viewport (resumeAfterHelp)
// The sheet opens as soon as the rows are read; PTT is left under it, so
// closing the sheet sends nothing. When PTT draws the list again instead (no
// board header), the list comes back with a hint. A board information screen
// whose rows do not read is left with ← (the PSB's own quit key) and the hint;
// any other screen gets no key at all.
import { i18n } from './i18n';
import { HINT_ERROR } from './status_hint';
import { recordFor } from './reading_record';
import { serializedOpHint } from './serialized_op_gate';
import { isBoardInfoScreen, parseBoardInfoPage, mergeBoardInfoPage } from './board_info_parse';

const SOURCE = 'boardInfo';
const HINT_MS = 3000;
const KEY_PAGE_DOWN = '\x1b[6~';
const KEY_LEAVE = '\x1b[D';
// b_config has about 30 items, two pages on a 24-row screen; a short screen
// needs more. More than this is no board information.
const MAX_PAGES = 8;
// Each step's budget, as the article information's `Q` (aid_navigation's
// STEP_PROBE_AFTER_MS / STEP_PROBE_WINDOW_MS / STEP_HARD_MS): a silent PTT is
// asked where it is after 700 ms. Not imported: aid_navigation reaches this
// module through list_session, so its constants are not yet set when this
// module runs.
const BUDGET = { timeoutMs: 700, probeTimeoutMs: 700, hardTimeoutMs: 3000 };

export class BoardInfo {
  constructor(core) {
    this.core = core;
    // idle → list (the sequence over the list)
    this.phase = 'idle';
    this._bookmark = null;
    this._offBack = null;
    this._info = null;
    this._pages = 0;
  }

  // The wire belongs to the sequence (serializedOpHint).
  get busy() {
    return this.phase !== 'idle';
  }

  // term_view holds PTT's frames under the list until it is back
  // (_navigationHeld).
  get holding() {
    return this.phase === 'list';
  }

  // Whether the information can be asked for now: list easy reading presents
  // a board's article list (its full list or search results; not the
  // mailbox, the user list or the digest list, whose tables have no `i`) and
  // is idle, and nothing else runs on the wire. The predicate of every
  // entrance (the key, the context menu, More).
  available() {
    const core = this.core;
    const ls = core && core.listSession;
    if (this.phase !== 'idle' || !ls) return false;
    if (ls.isUserList() || ls.isMailList() || ls.isDigestList()) return false;
    if (ls.state !== 'active' || !core.buf || core.buf.listRenderMode !== 'buffer') return false;
    if (typeof core.activeListSession === 'function' && core.activeListSession() !== ls) return false;
    return !serializedOpHint(core);
  }

  _hint(text, level) {
    this.core.view?.flashListHint?.(text, HINT_MS, level);
  }

  _refused(text) {
    this._hint(text, HINT_ERROR);
    return false;
  }

  // Ask PTT for the board information with `key` (the `i` or `I` typed; `i`
  // for the menus). Returns whether it was sent; when not, a hint says why.
  start(key = 'i') {
    const core = this.core;
    const ls = core && core.listSession;
    const busy = serializedOpHint(core);
    if (busy) return this._refused(busy);
    if (!this.available()) return this._refused(i18n('boardInfo_unavailable'));
    this.phase = 'list';
    this._info = null;
    this._pages = 0;
    this._bookmark = recordFor(core).begin('board-info');
    // The system Back during the sequence counts for nothing else.
    this._offBack = core.registerSheetDismiss
      ? core.registerSheetDismiss(() => this._hint(i18n('boardInfo_busy')))
      : null;
    // Terminal keys and taps stop until the list is back.
    core.setModalOpen?.(SOURCE, true);
    core._refreshScreenContext?.();
    ls.beginBoardInfo([this._pageStep(key === 'I' ? 'I' : 'i', 'board-info')]);
    return true;
  }

  // The step that brings a page: its answer is the page read, or `list` when
  // PTT shows the list instead (b_config found no board header).
  _pageStep(keys, kind) {
    const ls = this.core.listSession;
    return {
      keys,
      kind,
      ...BUDGET,
      expect: (snapshot, facts) => {
        const page = parseBoardInfoPage(facts && facts.rowTexts);
        if (page) return { page };
        return ls.showsHeldList() ? { list: true } : false;
      },
      onDone: (answer) => this._pageAnswered(answer),
      onFail: (reason, facts) => this._failed(facts)
    };
  }

  _pageAnswered(answer) {
    if (this.phase !== 'list') return;
    if (answer.list) return void queueMicrotask(() => this._backOnList('fail', i18n('boardInfo_unavailable'), HINT_ERROR));
    const step = mergeBoardInfoPage(this._info, answer.page);
    if (!step) return void this._leave(i18n('boardInfo_unavailable'));
    this._info = step.info;
    this._pages += 1;
    if (step.more && this._pages < MAX_PAGES) {
      const sent = this.core.listSession.continueUserQuery(this._pageStep(KEY_PAGE_DOWN, 'board-info-page'));
      if (!sent) this._backOnList('fail', i18n('boardInfo_failed'), HINT_ERROR);
      return;
    }
    if (step.more) return void this._leave(i18n('boardInfo_unavailable'));
    const info = this._info;
    this._leave(null);
    this.core.openBoardInfo?.(info);
  }

  // Leave PTT's board information with ←; the list is back once PTT shows it.
  // `text`: the hint when the rows were not shown.
  _leave(text) {
    if (this.phase !== 'list') return;
    const ls = this.core.listSession;
    const outcome = text ? 'fail' : 'done';
    const level = text ? HINT_ERROR : undefined;
    const sent = ls.continueUserQuery({
      keys: KEY_LEAVE,
      kind: 'board-info-leave',
      ...BUDGET,
      expect: () => ls.showsHeldList(),
      onDone: () => queueMicrotask(() => this._backOnList(outcome, text, level)),
      onFail: () => this._backOnList('fail', i18n('boardInfo_failed'), HINT_ERROR)
    });
    if (!sent) this._backOnList('fail', i18n('boardInfo_failed'), HINT_ERROR);
  }

  // A page did not come: PTT's board information that does not read is left
  // with ←; on any other screen nothing is guessed.
  _failed(facts) {
    if (this.phase !== 'list') return;
    if (isBoardInfoScreen(facts ? facts.rowTexts : this._screenRows()))
      return void this._leave(i18n('boardInfo_unavailable'));
    this._backOnList('fail', i18n(facts ? 'boardInfo_unavailable' : 'boardInfo_failed'), HINT_ERROR);
  }

  _screenRows() {
    const buf = this.core.buf;
    if (!buf || typeof buf.getRowText !== 'function') return null;
    return Array.from({ length: buf.rows }, (_, r) => buf.getRowText(r, 0, buf.cols));
  }

  // The list is PTT's screen again (or the sequence gave up): the list takes
  // the frame back with its rows and selection, the hold ends.
  _backOnList(outcome, text, level) {
    if (this.phase !== 'list') return;
    const core = this.core;
    const bm = this._bookmark;
    this._release();
    core.listSession?.resumeAfterHelp?.(true);
    recordFor(core).end(bm, outcome, { only: 'list' });
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
    if (text) this._hint(text, level);
  }

  _release() {
    this.phase = 'idle';
    this._bookmark = null;
    this._info = null;
    this._pages = 0;
    if (this._offBack) this._offBack();
    this._offBack = null;
    this.core.setModalOpen?.(SOURCE, false);
  }

  // The connection closed mid-sequence (App.onClose): PTT's screens and the
  // list are gone. Drop what the sequence holds, so the reconnect starts clean.
  reset() {
    if (this.phase === 'idle') return;
    const core = this.core;
    const bm = this._bookmark;
    this._release();
    recordFor(core).end(bm, 'fail', { only: 'list' });
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
  }
}

// i / I on the article list, and 看板資訊 in the context menu and More.
// Returns true when `i` was sent, false (with a hint) when not.
export function showBoardInfo(core, key) {
  const b = core && core.boardInfo;
  return !!b && b.start(key);
}
