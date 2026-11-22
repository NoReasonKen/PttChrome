// The board entry screen (#292): `b` on the easy-reading article list, 進板畫面
// in the desktop context menu and in the mobile toolbar's More.
//
// PTT's `b` (bbs.c#b_notes) shows the board's entry screen with
// more(notes, NA) (pmore with PMORE_AUTO_EXIT) and waits for a key
// (docs/pttbbs-screen-protocol.md, "The board entry screen"):
//   a plain screen     its first page, then pressanykey 「請按任意鍵繼續」
//   a long one         pmore with no footer prompt; it leaves at its end, then
//                      pressanykey
//   a movie            plays at once (「動畫播放中… 可按 q, Ctrl-C 或其它任意鍵
//                      停止」, 「互動式動畫播放中…」, paused 「暫停播放動畫…」);
//                      a key stops a plain movie, an interactive one takes keys
//                      as its choices but q and Ctrl-C always stop it; when it
//                      ends PTT waits in pressanykey
//   none               「本看板尚無進板畫面。」 at (4,20), then pressanykey
// After that key PTT draws the article list again.
//
// Easy reading presents it as a page of its own over the list, as the user
// query page (user_query.js) does: the list stays on screen under it, held
// (term_view draws none of PTT's frames while `holding`), and shows at once
// when the page leaves. The page shows PTT's own 80-column screen, every row
// as PTT draws it (its footer included), through a second instance of the
// shared screen renderer, live: each settled frame of a movie is drawn again.
// It is scaled to fit on a phone and keeps the terminal's cell on a desktop.
//
// Keys on the page go to PTT as typed (an interactive movie's choices, a long
// screen's paging), except the leave keys: ←, Esc and q, Back and system Back,
// and a swipe right. On pressanykey every key, and a tap on the page, leaves.
// Leaving sends what PTT waits for, each key only after PTT answered the one
// before: q while a movie plays (board_note_skip.boardNoteDecision, shared
// with the skip on board entry), ← out of a long screen, then one space for pressanykey, until PTT
// draws the list; the list takes its frame back with its rows and selection
// (ListSession.resumeAfterHelp). When a movie ends the page stays on its last
// frame until the reader leaves.
//
// pmore answers a key that stops a plain movie with READ_NEXT, and Read()
// then draws the list without pressanykey (pmore.c, see the protocol doc). When
// PTT draws the list while the page shows, the page keeps its last frame, the
// list takes its frame back under it at once, and leaving only closes the page
// (phase `ended`).
//
// A failure is said with a hint and holds the page: PTT's screen is never left
// to a guess. `b` asked for while another operation runs is refused with a
// hint and sends nothing.
import { i18n } from './i18n';
import { HINT_ERROR } from './status_hint';
import { keyEventPredatesModalClose } from './modal_key_gate';
import { recordFor } from './reading_record';
import { serializedOpHint } from './serialized_op_gate';
import { UNSUPPORTED_KEY_HINT, unsupportedPasteHint, unsupportedTextHint } from './unsupported_hint';
import { OverListPage } from './over_list_page';
import { boardNoteDecision, MAX_ROUNDS } from './board_note_skip';
import { listHeaderReversed } from './screen_titles';
import { renderScreen } from './term_ui';
import { releaseScreenLater } from './stack_layer';
import { cloneRow } from './comment_parse';
import { gridCellPx } from './mobile_layout';
import { altRemapCharCode, isAltRemapEvent, isBrowserClipboardEvent, keyEventToBytes } from './term_keyboard';

const SOURCE = 'boardNotes';
const HINT_MS = 3000;
// `b` and each key leaving: PTT answers at once (an entry screen is a file
// read; a movie's first frame comes with it).
const STEP_BUDGET = { timeoutMs: 3000, probeTimeoutMs: 2000, hardTimeoutMs: 8000 };
// The keys that leave the page and never reach PTT as typed.
const LEAVE_KEYS = ['ArrowLeft', 'Escape', 'q'];
// The screen copy's renderer options: PTT's screen as it is, without the
// article page's floating tools.
const SCREEN_ENHANCE = {
  pageState: 0, debugRecordButton: false, lightsButton: false, mergeCaptionButton: false
};

// What PTT's screen is now, for board_note_skip.boardNoteDecision.
function screenFacts(buf) {
  if (buf.changed && typeof buf.updateCharAttr === 'function') buf.updateCharAttr();
  const rowTexts = [];
  for (let r = 0; r < buf.rows; ++r) rowTexts.push(buf.getRowText(r, 0, buf.cols));
  return {
    rowTexts,
    rows: buf.rows,
    curX: buf.cur_x,
    curY: buf.cur_y,
    row0Reversed: buf.isUnicolor ? buf.isUnicolor(0, 0, 29) : false,
    row2Reversed: buf.isUnicolor ? listHeaderReversed(buf) : false
  };
}

// The bytes a key on the page means to PTT, or null when it means none (a
// modifier alone, an F-key). Alt+letter is the app's Ctrl+letter.
export function boardNotesKeyBytes(e) {
  if (isAltRemapEvent(e)) return String.fromCharCode(altRemapCharCode(e));
  return keyEventToBytes(e);
}

export class BoardNotes {
  constructor(core) {
    this.core = core;
    // idle → asking (`b` sent) → shown (the page) → leaving (keys sent) → idle
    //                                      ↘ ended (PTT drew the list) → idle
    this.phase = 'idle';
    this._board = null;
    this._listAppBar = null;
    this._bookmark = null;
    this._offBack = null;
    this._shell = null;
    this._screenRoot = null;
    this._screen = null;
    this._onSettled = null;
    this._resumePending = false;
  }

  // term_view holds PTT's frames until the list is back (_navigationHeld);
  // in `ended` the list has its frame back under the page.
  get holding() {
    return this.phase === 'asking' || this.phase === 'shown' || this.phase === 'leaving';
  }

  // PTT's screens are the entry screen's: article easy reading must not take
  // a long one for an article (easy_reading._navActive).
  get active() {
    return this.holding;
  }

  // The wire and the page belong to the entry screen (serializedOpHint).
  get busy() {
    return this.phase !== 'idle';
  }

  // Whether the page shows (the mobile toolbar works over it).
  get pageShown() {
    return this.phase === 'shown' || this.phase === 'ended';
  }

  // Whether `b` can be asked for now: list easy reading presents an article
  // list (its search results and digest included, where PTT binds `b` too;
  // never the mailbox or the user list) and is idle, and nothing else runs on
  // the wire. The one predicate of every entrance (`b`, the context menu, More).
  available() {
    const core = this.core;
    const ls = core && core.listSession;
    if (this.phase !== 'idle' || !ls || !ls.boardNotesBoard || ls.boardNotesBoard() == null) return false;
    if (!core.buf || core.buf.listRenderMode !== 'buffer') return false;
    if (typeof core.activeListSession === 'function' && core.activeListSession() !== ls) return false;
    return !serializedOpHint(core);
  }

  // The App Bar while it runs (mobile_toolbar.mobileToolbarContext): the
  // list's until the page shows, then the page's; null when idle.
  appBar() {
    if (this.phase === 'idle') return null;
    if (!this.pageShown) return this._listAppBar;
    return {
      kind: 'other', title: i18n('boardNotes_title'), subtitle: this._board || '',
      time: '', byline: '', newMail: false
    };
  }

  _hint(text, level) {
    this.core.view?.flashListHint?.(text, HINT_MS, level);
  }

  _decision() {
    return boardNoteDecision(screenFacts(this.core.buf));
  }

  _listBack() {
    return !!this.core.listSession?.showsHeldList?.();
  }

  // Ask PTT for the entry screen. Returns whether `b` was sent; when not, a
  // hint says why.
  start() {
    const core = this.core;
    const busy = serializedOpHint(core);
    if (busy) {
      this._hint(busy);
      return false;
    }
    if (!this.available()) {
      this._hint(i18n('boardNotes_unavailable'));
      return false;
    }
    const ls = core.listSession;
    this._board = ls.boardNotesBoard();
    this._listAppBar = core._screenContext?.appBar || null;
    this._bookmark = recordFor(core).begin('board-notes');
    this.phase = 'asking';
    // The system Back is the page's for the whole run (see _back).
    this._offBack = core.registerSheetDismiss ? core.registerSheetDismiss(() => this._back()) : null;
    // Terminal keys and taps stop until the list is back: the screens under
    // the held list are PTT's.
    core.setModalOpen?.(SOURCE, true);
    core._refreshScreenContext?.();
    ls.beginBoardNotes([
      {
        keys: 'b',
        kind: 'board-notes',
        // No Ctrl-L behind `b`: a playing movie waits for input to stop, and
        // whether Ctrl-L ends that wait is not settled (protocol doc).
        fullRepaint: false,
        ...STEP_BUDGET,
        expect: () => {
          if (this._listBack()) return { list: true };
          return this._decision().action === 'skip' ? { notes: true } : false;
        },
        onDone: (answer) => {
          if (this.phase !== 'asking') return;
          if (answer.list) queueMicrotask(() => this._backOnList('fail', i18n('boardNotes_failed'), HINT_ERROR));
          else this._show();
        },
        onFail: () => this._askFailed()
      }
    ]);
    return true;
  }

  // No entry screen came in time. PTT's list again: the list takes it back,
  // with the hint. Any other screen is shown on the page with the hint, where
  // the reader sees it and can leave it.
  _askFailed() {
    if (this.phase !== 'asking') return;
    if (this._listBack()) return this._backOnList('fail', i18n('boardNotes_failed'), HINT_ERROR);
    this._show();
    this._hint(i18n('boardNotes_failed'), HINT_ERROR);
  }

  // The system Back: it leaves the page when that shows; before and after,
  // PTT is mid-sequence, so it is answered with the busy hint.
  _back() {
    if (this.pageShown) this.dismiss();
    else if (this.phase !== 'idle') this._hint(i18n('boardNotes_busy'));
  }

  // ---- The page ----

  _show() {
    const core = this.core;
    this.phase = 'shown';
    this._openPage();
    core._refreshScreenContext?.();
    if (!this._onSettled && core.buf && core.buf.addEventListener) {
      this._onSettled = () => this._settled();
      core.buf.addEventListener('screenSettled', this._onSettled);
    }
    this._settled();
  }

  // Every settled frame while the page shows: drawn on the page (a movie's
  // next frame, a long screen's next page), unless PTT drew its list.
  _settled() {
    if (this.phase !== 'shown') return;
    if (this._listBack()) {
      this.phase = 'ended';
      this._resumePending = true;
      this._stopFollowing();
      // After this settle, as the list's other excursions take it back.
      queueMicrotask(() => this._listResumed());
      return;
    }
    this._draw();
  }

  // PTT drew the list by itself while the page shows (a key stopped a movie,
  // READ_NEXT): the list takes its frame back under the page, which keeps its
  // last frame until the reader leaves it.
  _listResumed() {
    if (!this._resumePending) return;
    this._resumePending = false;
    const core = this.core;
    const bm = this._bookmark;
    this._bookmark = null;
    core.listSession?.resumeAfterHelp?.(true);
    recordFor(core).end(bm, 'done');
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
  }

  _openPage() {
    if (this._shell) return;
    const shell = new OverListPage(this.core.view, {
      marker: 'board-notes',
      className: 'boardNotesPage',
      label: i18n('boardNotes_title'),
      onKey: (e) => this._key(e),
      canSwipe: () => this.pageShown,
      onSwipeLeave: () => this.dismiss()
    });
    const root = document.createElement('div');
    root.className = 'main boardNotesScreen';
    root.setAttribute('data-stack-layer', 'boardNotes');
    shell.el.appendChild(root);
    // A tap or a click on the page is a key when any key will do (_tap).
    shell.el.addEventListener('click', () => this._tap());
    this._shell = shell;
    this._screenRoot = root;
    if (!shell.open(() => this._draw())) {
      this._shell = null;
      this._screenRoot = null;
    }
  }

  // The cell the copy is drawn at: the terminal's own on a desktop; on a
  // phone the cell that fits PTT's 80 columns and rows in the page.
  _cellPx() {
    const view = this.core.view;
    const page = this._shell && this._shell.el;
    if (!this.core.mobile || !page) return view.chh;
    const rect = page.getBoundingClientRect();
    return gridCellPx({
      width: rect.width, height: rect.height, rows: this.core.buf.rows, dpr: window.devicePixelRatio || 1
    }) || view.chh;
  }

  // PTT's screen as it is now, on the page. The rows are copied: PTT's buffer
  // is written in place as the next frame comes.
  _draw() {
    const root = this._screenRoot;
    const buf = this.core.buf;
    if (!root || !buf || !buf.lines) return;
    if (buf.changed && typeof buf.updateCharAttr === 'function') buf.updateCharAttr();
    const view = this.core.view;
    const chh = this._cellPx();
    const text = (view.textFontPx ? view.textFontPx(chh) : chh) + 'px';
    root.style.fontSize = text;
    root.style.lineHeight = text;
    root.style.setProperty('--cell-h', chh + 'px');
    root.style.width = (chh / 2) * buf.cols + 'px';
    // The terminal's font (the fontFace pref, set inline on the real screen):
    // its ASCII advance is the half cell the copy's columns are laid out on.
    const face = view.mainDisplay && view.mainDisplay.style.getPropertyValue('font-family');
    if (face) root.style.setProperty('font-family', face, 'important');
    this._screen = renderScreen(buf.lines.map(cloneRow), chh, false, false, root, SCREEN_ENHANCE);
  }

  _stopFollowing() {
    const core = this.core;
    if (this._onSettled && core.buf && core.buf.removeEventListener)
      core.buf.removeEventListener('screenSettled', this._onSettled);
    this._onSettled = null;
  }

  // slide: the page slides out over the list (the list shows at once under it).
  _closePage(slide) {
    this._stopFollowing();
    const shell = this._shell;
    this._shell = null;
    this._screenRoot = null;
    const screen = this._screen;
    this._screen = null;
    if (shell) shell.close(slide);
    // The copy goes with the page; its roots are released after this task.
    releaseScreenLater(screen);
  }

  // A tap (a click on a desktop) on the page: on pressanykey, and once PTT
  // drew its list, it leaves as any key does. While a movie plays or a long
  // screen pages it does nothing, and a click that ended a text selection
  // only selected.
  _tap() {
    if (!this.ownsInput()) return;
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && String(sel).length) return;
    if (this.phase === 'ended') return void this.dismiss();
    const d = this._decision();
    if (d.action === 'skip' && d.shape === 'pause') this.dismiss();
  }

  // ---- Leaving ----

  // Leave the page: Back, system Back, ←, Esc, q, a swipe right, and any key
  // on pressanykey. The list shows at once; PTT is told what it waits for.
  dismiss() {
    const core = this.core;
    if (this.phase === 'ended') {
      this._closePage(true);
      // Left before the list took its frame back (the same task).
      this._listResumed();
      this._release();
      core._refreshScreenContext?.();
      return true;
    }
    if (this.phase !== 'shown') return false;
    // PTT drew its list before this frame was followed.
    if (this._listBack()) {
      this._closePage(true);
      this._backOnList('done');
      return true;
    }
    const d = this._decision();
    // A screen not known to wait for a key (half drawn, a message of PTT's):
    // no key is guessed; the page stays.
    if (d.action !== 'skip') {
      this._hint(i18n('boardNotes_wait'), HINT_ERROR);
      return true;
    }
    this.phase = 'leaving';
    this._closePage(true);
    core._refreshScreenContext?.();
    this._leaveStep(d, 1);
    return true;
  }

  // One key of the way back: the one PTT's screen waits for, judged anew
  // after each answer, until PTT draws the list.
  _leaveStep(d, round) {
    const ls = this.core.listSession;
    const sent = !!ls?.continueUserQuery?.({
      keys: d.key,
      kind: 'board-notes-leave',
      ...STEP_BUDGET,
      expect: () => {
        if (this._listBack()) return { list: true };
        const next = this._decision();
        // A movie frame drawn before the key arrived is no answer.
        if (next.action === 'skip' && next.shape !== 'movie') return { again: next };
        return false;
      },
      onDone: (answer) => {
        if (this.phase !== 'leaving') return;
        if (answer.list) queueMicrotask(() => this._backOnList('done'));
        else if (round >= MAX_ROUNDS) this._leaveFailed();
        else this._leaveStep(answer.again, round + 1);
      },
      onFail: () => this._leaveFailed()
    });
    if (!sent) this._leaveFailed();
  }

  // The way back got no list in time. When PTT shows the list after all, the
  // list takes it; otherwise the page comes back over it with the hint, on
  // the screen PTT shows, and the reader can leave again.
  _leaveFailed() {
    if (this.phase !== 'leaving') return;
    if (this._listBack()) return this._backOnList('fail', i18n('boardNotes_failed'), HINT_ERROR);
    this._show();
    this._hint(i18n('boardNotes_failed'), HINT_ERROR);
  }

  // The list is PTT's screen again: the page is gone, the list takes the
  // frame back with its rows and selection, the hold ends.
  _backOnList(outcome, text, level) {
    if (this.phase === 'idle') return;
    const core = this.core;
    this._closePage(false);
    const bm = this._bookmark;
    this._bookmark = null;
    this._release();
    core.listSession?.resumeAfterHelp?.(true);
    recordFor(core).end(bm, outcome);
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
    if (text) this._hint(text, level);
  }

  // Back to idle: the modal source and the Back.
  _release() {
    this.phase = 'idle';
    this._resumePending = false;
    this._board = null;
    if (this._offBack) this._offBack();
    this._offBack = null;
    this.core.setModalOpen?.(SOURCE, false);
  }

  // The connection closed (App.onClose): PTT's screens, the list and its
  // session are gone. Drop everything without touching the list.
  reset() {
    if (this.phase === 'idle') return;
    const core = this.core;
    this._closePage(false);
    const bm = this._bookmark;
    this._bookmark = null;
    this._release();
    if (bm) recordFor(core).end(bm, 'fail');
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
  }

  // ---- Keys ----

  _key(e) {
    if (!this.takeKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // Whether keys and typed text are the page's to judge: it shows and no sheet
  // or dialog is over it (that one keeps its own keys).
  ownsInput() {
    if (!this.pageShown || !this._shell) return false;
    return !(this.core._openModals && this.core._openModals.size > 1);
  }

  _refuse(text) {
    this.core.view?.flashListHint?.(text, 4000, HINT_ERROR);
  }

  // Text that is no single typed key (an input method's words, a paste):
  // refused, as on the other easy-reading pages. Returns whether the page took it.
  refuseText(text, what) {
    if (!this.ownsInput()) return false;
    this._refuse(what === 'paste' ? unsupportedPasteHint('進板畫面') : unsupportedTextHint('進板畫面'));
    return true;
  }

  // A key for the page: the keyboard's (the page's window listener), and the
  // keys that are no keydown on window (term_view.sendKeyAsUser: the toolbar
  // keypad's keys and a character the soft keyboard typed: `synthetic`). `e`
  // needs key and the modifier flags. Returns whether the page took it.
  takeKey(e, synthetic) {
    if (!this.ownsInput()) return false;
    // A key that closed a sheet over the page (Esc on the More sheet) is
    // already answered.
    if (!synthetic && keyEventPredatesModalClose(e.timeStamp, this.core.anyModalClosedAt)) return false;
    // The browser's: its clipboard keys, Meta combos.
    if (e.metaKey || (!synthetic && isBrowserClipboardEvent(e))) return false;
    const plain = !e.ctrlKey && !e.altKey;
    if (plain && LEAVE_KEYS.includes(e.key)) {
      this.dismiss();
      return true;
    }
    const bytes = boardNotesKeyBytes(e);
    if (bytes == null) {
      // A modifier alone, an F-key, Alt+← (the browser's Back): the browser's.
      if (!synthetic) return false;
      this._refuse(UNSUPPORTED_KEY_HINT);
      return true;
    }
    // PTT has drawn its list: the page only leaves.
    if (this.phase === 'ended') {
      this._refuse(UNSUPPORTED_KEY_HINT);
      return true;
    }
    const d = this._decision();
    // Pressanykey: any key ends the entry screen, so it leaves the page.
    if (d.action === 'skip' && d.shape === 'pause') {
      this.dismiss();
      return true;
    }
    if (!this.core.sendMachineBytes || !this.core.sendMachineBytes(bytes)) this._refuse(i18n('boardNotes_failed'));
    return true;
  }
}

function controller(core) {
  return core && core.boardNotes;
}

// Show the board entry screen (`b`, the context menu, More). Returns whether
// `b` was sent; when not, a hint says why.
export function showBoardNotes(core) {
  const notes = controller(core);
  return !!notes && notes.start();
}
