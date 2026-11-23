// Where the board is (#293): Ctrl-W and Ctrl-Y (and their Alt aliases) on the
// easy-reading article list, 我在哪 in the list's context menu (desktop) and in
// the list's More sheet (phone). PTT's own Ctrl-W / Ctrl-Y (mbbsd/bbs.c#whereami)
// draws the board's place in its class tree and waits on pressanykey; the app
// reads that screen (whereami_parse.parseWhereAmI) and shows it as its own card
// (mobile: sheet; desktop: dialog), asked from PTT once.
//
// PTT's screen is never shown: it is held under the list while the sequence runs,
// each key going out only after PTT answered the one before
// (docs/pttbbs-screen-protocol.md §11.10 「`[^W]`/`[^Y]` 我在哪」):
//   Ctrl-W    ⇒ the screen (parseWhereAmI), with its pressanykey
//   ␣         ⇒ the list (ListSession.showsHeldList); the list takes its frame
//                back with its rows, selection and viewport (resumeAfterHelp)
// The card opens as soon as the screen is read and PTT's pause is answered under
// it, so closing the card sends nothing (as board_info.js and post_info.js). PTT
// drawing the list again instead (a list without a board) gives the hint; a
// screen that does not read is left with a key and the hint; any other screen
// gets no key at all.
import { i18n } from './i18n';
import { HINT_ERROR } from './status_hint';
import { recordFor } from './reading_record';
import { serializedOpHint } from './serialized_op_gate';
import { isWhereAmIScreen, parseWhereAmI, whereAmIPaused } from './whereami_parse';

const SOURCE = 'whereAmI';
const HINT_MS = 3000;
// The control codes of Ctrl-W and Ctrl-Y, the two keys of bbs.c's read tables.
export const WHEREAMI_KEYS = [23, 25];
// The only key that answers the pause (screen_dismiss.KEY_DISMISS; not
// imported: the same string, and this module loads before aid_navigation).
const KEY_DISMISS = ' ';
// As board_info.js: a silent PTT is asked where it is after 700 ms.
const BUDGET = { timeoutMs: 700, probeTimeoutMs: 700, hardTimeoutMs: 3000 };

export class WhereAmI {
  constructor(core) {
    this.core = core;
    // idle → list (the sequence over the list)
    this.phase = 'idle';
    this._bookmark = null;
    this._offBack = null;
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

  // Whether it can be asked for now: list easy reading presents a board's
  // article list, its search results or its digest (not the mailbox or the user
  // list) and is idle, and nothing else runs on the wire. The predicate of every
  // entrance (the keys, the context menu, More).
  available() {
    const core = this.core;
    const ls = core && core.listSession;
    if (this.phase !== 'idle' || !ls) return false;
    if (ls.isUserList() || ls.isMailList()) return false;
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

  // Ask PTT where the board is with `code` (23 Ctrl-W, 25 Ctrl-Y; the menus
  // send Ctrl-W). Returns whether it was sent; when not, a hint says why.
  start(code = 23) {
    const core = this.core;
    const ls = core && core.listSession;
    const busy = serializedOpHint(core);
    if (busy) return this._refused(busy);
    if (!this.available()) return this._refused(i18n('whereAmI_unavailable'));
    this.phase = 'list';
    this._bookmark = recordFor(core).begin('whereami');
    // The system Back during the sequence counts for nothing else.
    this._offBack = core.registerSheetDismiss
      ? core.registerSheetDismiss(() => this._hint(i18n('whereAmI_busy')))
      : null;
    // Terminal keys and taps stop until the list is back.
    core.setModalOpen?.(SOURCE, true);
    core._refreshScreenContext?.();
    ls.beginWhereAmI([
      {
        keys: String.fromCharCode(WHEREAMI_KEYS.includes(code) ? code : 23),
        kind: 'whereami',
        ...BUDGET,
        // PTT draws the screen with its pause; the list again means a list
        // without a board (`bid` 0: whereami does nothing).
        expect: (snapshot, facts) => {
          const rows = facts && facts.rowTexts;
          const where = parseWhereAmI(rows);
          if (where && whereAmIPaused(rows)) return { where };
          return ls.showsHeldList() ? { list: true } : false;
        },
        onDone: (answer) => this._answered(answer),
        onFail: (reason, facts) => this._failed(facts)
      }
    ]);
    return true;
  }

  _answered(answer) {
    if (this.phase !== 'list') return;
    if (answer.list) return void queueMicrotask(() => this._backOnList('fail', i18n('whereAmI_unavailable'), HINT_ERROR));
    this._dismiss(answer.where);
  }

  // Answer PTT's pause: the list is back once PTT draws it. `where`: the screen
  // read, shown at once; null when it was not read, which gets the hint.
  _dismiss(where) {
    const ls = this.core.listSession;
    const text = where ? null : i18n('whereAmI_unavailable');
    const level = where ? undefined : HINT_ERROR;
    const sent = ls.continueUserQuery({
      keys: KEY_DISMISS,
      kind: 'whereami-dismiss',
      ...BUDGET,
      expect: () => ls.showsHeldList(),
      onDone: () => queueMicrotask(() => this._backOnList(where ? 'done' : 'fail', text, level)),
      onFail: () => this._backOnList('fail', i18n('whereAmI_failed'), HINT_ERROR)
    });
    if (!sent) return void this._backOnList('fail', i18n('whereAmI_failed'), HINT_ERROR);
    if (where) this.core.openWhereAmI?.(where);
  }

  // The screen did not come: PTT's 我在哪 that does not read is answered with
  // the key; on any other screen nothing is guessed.
  _failed(facts) {
    if (this.phase !== 'list') return;
    const rows = facts ? facts.rowTexts : this._screenRows();
    if (isWhereAmIScreen(rows)) return void this._dismiss(null);
    this._backOnList('fail', i18n(facts ? 'whereAmI_unavailable' : 'whereAmI_failed'), HINT_ERROR);
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

// Ctrl-W / Ctrl-Y on the article list (`code` 23 / 25), and 我在哪 in the
// context menu and More. Returns true when the key was sent, false (with a
// hint) when not.
export function showWhereAmI(core, code) {
  const w = core && core.whereAmI;
  return !!w && w.start(code);
}
