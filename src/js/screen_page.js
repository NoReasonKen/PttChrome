// A page of PTT's own screen over easy reading: the board entry screen (#292,
// board_notes.js) over the article list, an article's ANSI animation (#300,
// article_movie.js) over the article. One controller, one page and one state
// machine; what differs is the page's kind (a small table: the key that asks
// PTT for the screen, its words, how its screens are judged) and what it holds
// underneath (a strategy: the list or the article, how it is told that PTT
// shows it again, and how it takes the frame back).
//
// The page shows PTT's own 80-column screen, every row as PTT draws it (its
// footer included), through a second instance of the shared screen renderer,
// live: each settled frame of a movie is drawn again. It is scaled to fit on a
// phone and keeps the terminal's cell on a desktop. What is held underneath
// stays on screen under the page (term_view draws none of PTT's frames while
// `holding`) and shows at once when the page leaves.
//
// Keys on the page go to PTT as typed (an interactive movie's choices, a long
// screen's paging), except the leave keys: ←, Esc and q, Back and system Back,
// and a swipe right. On pressanykey every key, and a tap on the page, leaves.
// Leaving sends what PTT waits for (the kind's decision), each key only after
// PTT answered the one before, until PTT shows what is held underneath again;
// that takes its frame back. When a movie ends and PTT shows it by itself, the
// page stays on its last frame until the reader leaves (phase `ended`), with
// the screen underneath taken back already.
//
// A failure is said with a hint and holds the page: PTT's screen is never left
// to a guess. A screen that is neither the page's nor what it holds (the
// article's strategy only: PTT left the article) is lost: the article is held
// with a message (article_hold.js). The page asked for while another operation
// runs is refused with a hint and sends nothing.
//
// A kind (board_notes.BOARD_NOTES, article_movie.ARTICLE_MOVIE):
//   source       the modal source and the screen copy's stack layer
//   marker       the page carries data-<marker>-page (over_list_page.js)
//   record       the reading record's feature (reading_record.RESTORE_TABLE)
//   step         the command kind of the key asking PTT; leaving is step-leave
//   keys         what asks PTT for the screen
//   words        i18n keys: title, unavailable, failed, busy, wait; screen:
//                the screen's name in the refusal of typed text
//   under        what the page holds underneath (LIST_UNDER, ARTICLE_UNDER)
//   available(core)   whether the screen can be asked for now (besides the
//                     controller being idle and nothing else on the wire)
//   subtitle(core)    the App Bar's subtitle while the page shows
//   decide(facts)     what PTT's screen waits for: { action: 'skip', key,
//                     shape: 'movie'|'pause'|'pager'|'input' } or not 'skip'
//   entryMessage(facts)  optional: { key, hint } when PTT answers the asking
//                     key with a banner that is no page (a message waiting
//                     for a key): the key is sent and what is held comes back
//                     with the hint
//   shownHint(d)      optional: the i18n key of a hint when the page first
//                     shows the screen judged `d`
//
// A strategy for what is held underneath:
//   begin(core, kind)      the reading record's bookmark; anything to do first
//   send(core, step)       the key asking PTT; returns whether it went out
//   continue(core, step)   one key of the way back; returns whether it went out
//   back(core)             PTT shows what is held underneath again
//   entryBack              whether that is PTT's answer to the asking key (the
//                          list: a board without a screen); otherwise it is a
//                          frame on the way (the article's own Home)
//   lost(core)             PTT shows neither the page's screen nor what it holds
//   takeBack(core, end)    what is held takes PTT's frame back; end() ends the
//                          reading record (its position restored), in the order
//                          what is held needs
//   drop(core, bm)         the connection closed: the bookmark's end, if any
//   hold(core, page)       a lost screen: hold it with the message
//   pageClass              the page's class besides screenPage: what it must
//                          stack over ('' over the list)
import { i18n } from './i18n';
import { HINT_ERROR } from './status_hint';
import { keyEventPredatesModalClose } from './modal_key_gate';
import { recordFor } from './reading_record';
import { serializedOpHint } from './serialized_op_gate';
import { UNSUPPORTED_KEY_HINT, unsupportedPasteHint, unsupportedTextHint } from './unsupported_hint';
import { OverListPage } from './over_list_page';
import { MAX_ROUNDS } from './board_note_skip';
import { listHeaderReversed } from './screen_titles';
import { renderScreen } from './term_ui';
import { releaseScreenLater } from './stack_layer';
import { cloneRow } from './comment_parse';
import { gridCellPx } from './mobile_layout';
import { altRemapCharCode, isAltRemapEvent, isBrowserClipboardEvent, keyEventToBytes } from './term_keyboard';

const HINT_MS = 3000;
// The asking key and each key leaving: PTT answers at once (an entry screen
// is a file read; a movie's first frame comes with it).
export const STEP_BUDGET = { timeoutMs: 3000, probeTimeoutMs: 2000, hardTimeoutMs: 8000 };
// The keys that leave the page and never reach PTT as typed.
const LEAVE_KEYS = ['ArrowLeft', 'Escape', 'q'];
// The screen copy's renderer options: PTT's screen as it is, without the
// article page's floating tools.
const SCREEN_ENHANCE = {
  pageState: 0, debugRecordButton: false, lightsButton: false, mergeCaptionButton: false
};

// What PTT's screen is now, for a kind's decide().
export function screenFacts(buf) {
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
export function screenPageKeyBytes(e) {
  if (isAltRemapEvent(e)) return String.fromCharCode(altRemapCharCode(e));
  return keyEventToBytes(e);
}

// The article list held under the page (#292): the list's own held steps
// (ListSession.beginScreenPage) let it go for the native excursion and keep
// its rows and selection; resumeAfterHelp gives it the frame back.
export const LIST_UNDER = Object.freeze({
  begin: (core, kind) => recordFor(core).begin(kind.record),
  send: (core, step) => {
    core.listSession.beginScreenPage([step]);
    return true;
  },
  continue: (core, step) => !!core.listSession?.continueUserQuery?.(step),
  back: (core) => !!core.listSession?.showsHeldList?.(),
  entryBack: true,
  lost: () => false,
  takeBack: (core, end) => {
    core.listSession?.resumeAfterHelp?.(true);
    end();
  },
  drop: (core, bm) => recordFor(core).end(bm, 'fail'),
  hold: () => {},
  pageClass: ''
});

export class ScreenPage {
  constructor(core, kind) {
    this.core = core;
    this.kind = kind;
    // idle → asking (keys sent) → shown (the page) → leaving (keys sent) → idle
    //                                  ↘ ended (PTT shows what is held) → idle
    this.phase = 'idle';
    this._subtitle = null;
    this._doneHint = null;
    this._underAppBar = null;
    this._bookmark = null;
    this._offBack = null;
    this._shell = null;
    this._screenRoot = null;
    this._screen = null;
    this._onSettled = null;
    this._resumePending = false;
  }

  // term_view holds PTT's frames until what is held is back (_navigationHeld);
  // in `ended` it has its frame back under the page.
  get holding() {
    return this.phase === 'asking' || this.phase === 'shown' || this.phase === 'leaving';
  }

  // PTT's screens are the page's: article easy reading must not take a pmore
  // page of them for an article (easy_reading._navActive).
  get active() {
    return this.holding;
  }

  // The wire and the page belong to the page (serializedOpHint).
  get busy() {
    return this.phase !== 'idle';
  }

  // Whether the page shows (the mobile toolbar works over it).
  get pageShown() {
    return this.phase === 'shown' || this.phase === 'ended';
  }

  // The hint for a key typed while the page runs (serialized_op_gate).
  get busyHint() {
    return i18n(this.kind.words.busy);
  }

  // Whether the screen can be asked for now: the kind's predicate, the page
  // idle and nothing else on the wire. The one predicate of every entrance
  // (the key, the context menu, More).
  available() {
    if (this.phase !== 'idle' || !this.core || !this.kind.available(this.core)) return false;
    return !serializedOpHint(this.core);
  }

  // The App Bar while it runs (mobile_toolbar.mobileToolbarContext): what is
  // held underneath keeps its own until the page shows, then the page's; null
  // when idle.
  appBar() {
    if (this.phase === 'idle') return null;
    if (!this.pageShown) return this._underAppBar;
    return {
      kind: 'other', title: i18n(this.kind.words.title), subtitle: this._subtitle || '',
      time: '', byline: '', newMail: false
    };
  }

  _hint(text, level) {
    this.core.view?.flashListHint?.(text, HINT_MS, level);
  }

  _decision() {
    return this.kind.decide(screenFacts(this.core.buf));
  }

  _back() {
    return !!this.kind.under.back(this.core);
  }

  _lost() {
    return !!this.kind.under.lost(this.core);
  }

  _failed() {
    return i18n(this.kind.words.failed);
  }

  // Ask PTT for the screen. Returns whether the key was sent; when not, a hint
  // says why.
  start() {
    const core = this.core;
    const kind = this.kind;
    const busy = serializedOpHint(core);
    if (busy) {
      this._hint(busy);
      return false;
    }
    if (!this.available()) {
      this._hint(i18n(kind.words.unavailable));
      return false;
    }
    this._subtitle = kind.subtitle(core);
    this._underAppBar = core._screenContext?.appBar || null;
    this._bookmark = kind.under.begin(core, kind);
    this.phase = 'asking';
    // The system Back is the page's for the whole run (see _systemBack).
    this._offBack = core.registerSheetDismiss ? core.registerSheetDismiss(() => this._systemBack()) : null;
    // Terminal keys and taps stop until what is held is back: the screens
    // under it are PTT's.
    core.setModalOpen?.(kind.source, true);
    core._refreshScreenContext?.();
    const sent = kind.under.send(core, {
      keys: kind.keys,
      kind: kind.step,
      // No Ctrl-L behind the key: a playing movie waits for input to stop, and
      // whether Ctrl-L ends that wait is not settled (protocol doc).
      fullRepaint: false,
      ...STEP_BUDGET,
      expect: () => {
        // A banner is drawn over the held screen's rows: it comes first.
        const message = kind.entryMessage ? kind.entryMessage(screenFacts(core.buf)) : null;
        if (message) return { message };
        if (kind.under.entryBack && this._back()) return { back: true };
        if (this._lost()) return { lost: true };
        return this._decision().action === 'skip' ? { page: true } : false;
      },
      onDone: (answer) => {
        if (this.phase !== 'asking') return;
        if (answer.back) queueMicrotask(() => this._backHome('fail', this._failed(), HINT_ERROR));
        else if (answer.lost) this._lostHome();
        else if (answer.message) this._answerMessage(answer.message);
        else this._firstShow();
      },
      onFail: () => this._askFailed()
    });
    if (!sent) this._askFailed();
    return true;
  }

  // PTT answered with a message that waits for a key (no page): the key goes
  // out, and what is held comes back with the message as a hint.
  _answerMessage(message) {
    this.phase = 'leaving';
    this._doneHint = message.hint || null;
    this.core._refreshScreenContext?.();
    this._leaveStep({ key: message.key, shape: 'pause' }, 1);
  }

  // The first frame of the page, with the kind's hint for it (an article
  // that is no movie: PTT asks for a speed).
  _firstShow() {
    const hint = this.kind.shownHint ? this.kind.shownHint(this._decision()) : null;
    this._show();
    if (hint) this._hint(i18n(hint));
  }

  // No screen came in time. What is held is PTT's screen again: it takes it
  // back, with the hint. Any other screen is shown on the page with the hint,
  // where the reader sees it and can leave it.
  _askFailed() {
    if (this.phase !== 'asking') return;
    if (this._back()) return this._backHome('fail', this._failed(), HINT_ERROR);
    if (this._lost()) return this._lostHome();
    this._show();
    this._hint(this._failed(), HINT_ERROR);
  }

  // The system Back: it leaves the page when that shows; before and after,
  // PTT is mid-sequence, so it is answered with the busy hint.
  _systemBack() {
    if (this.pageShown) this.dismiss();
    else if (this.phase !== 'idle') this._hint(this.busyHint);
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
  // next frame, a long screen's next page), unless PTT shows what is held.
  _settled() {
    if (this.phase !== 'shown') return;
    if (this._back()) {
      this.phase = 'ended';
      this._resumePending = true;
      this._stopFollowing();
      // After this settle, as the other excursions take it back.
      queueMicrotask(() => this._underResumed());
      return;
    }
    if (this._lost()) return void this._lostHome();
    this._draw();
  }

  // PTT shows what is held by itself while the page shows (a movie ended, a
  // key stopped it): that takes its frame back under the page, which keeps its
  // last frame until the reader leaves it.
  _underResumed() {
    if (!this._resumePending) return;
    this._resumePending = false;
    const core = this.core;
    const bm = this._bookmark;
    this._bookmark = null;
    this.kind.under.takeBack(core, () => recordFor(core).end(bm, 'done'));
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
  }

  _openPage() {
    if (this._shell) return;
    const kind = this.kind;
    const shell = new OverListPage(this.core.view, {
      marker: kind.marker,
      className: kind.under.pageClass ? 'screenPage ' + kind.under.pageClass : 'screenPage',
      label: i18n(kind.words.title),
      onKey: (e) => this._key(e),
      canSwipe: () => this.pageShown,
      onSwipeLeave: () => this.dismiss()
    });
    const root = document.createElement('div');
    root.className = 'main screenPageScreen';
    root.setAttribute('data-stack-layer', kind.source);
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

  // slide: the page slides out (what is held shows at once under it).
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
  // shows what is held, it leaves as any key does. While a movie plays or a
  // long screen pages it does nothing, and a click that ended a text
  // selection only selected.
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
  // on pressanykey. What is held shows at once; PTT is told what it waits for.
  dismiss() {
    const core = this.core;
    if (this.phase === 'ended') {
      this._closePage(true);
      // Left before what is held took its frame back (the same task).
      this._underResumed();
      this._release();
      core._refreshScreenContext?.();
      return true;
    }
    if (this.phase !== 'shown') return false;
    // PTT showed what is held before this frame was followed.
    if (this._back()) {
      this._closePage(true);
      this._backHome('done');
      return true;
    }
    if (this._lost()) {
      this._lostHome();
      return true;
    }
    const d = this._decision();
    // A screen not known to wait for a key (half drawn, a message of PTT's):
    // no key is guessed; the page stays.
    if (d.action !== 'skip') {
      this._hint(i18n(this.kind.words.wait), HINT_ERROR);
      return true;
    }
    this.phase = 'leaving';
    this._closePage(true);
    core._refreshScreenContext?.();
    this._leaveStep(d, 1);
    return true;
  }

  // One key of the way back: the one PTT's screen waits for, judged anew
  // after each answer, until PTT shows what is held.
  _leaveStep(d, round) {
    const sent = this.kind.under.continue(this.core, {
      keys: d.key,
      kind: this.kind.step + '-leave',
      ...STEP_BUDGET,
      expect: () => {
        if (this._back()) return { back: true };
        if (this._lost()) return { lost: true };
        const next = this._decision();
        // A movie frame drawn before the key that stops a movie arrived is no
        // answer; after any other key (a prompt's) a movie is PTT's answer.
        if (next.action === 'skip' && (next.shape !== 'movie' || d.shape !== 'movie')) return { again: next };
        return false;
      },
      onDone: (answer) => {
        if (this.phase !== 'leaving') return;
        if (answer.back) queueMicrotask(() => this._backHome('done', this._doneHint));
        else if (answer.lost) this._lostHome();
        else if (round >= MAX_ROUNDS) this._leaveFailed();
        else this._leaveStep(answer.again, round + 1);
      },
      onFail: () => this._leaveFailed()
    });
    if (!sent) this._leaveFailed();
  }

  // The way back got nothing held in time. When PTT shows it after all, it
  // takes it; otherwise the page comes back over it with the hint, on the
  // screen PTT shows, and the reader can leave again.
  _leaveFailed() {
    if (this.phase !== 'leaving') return;
    if (this._back()) return this._backHome('fail', this._failed(), HINT_ERROR);
    if (this._lost()) return this._lostHome();
    this._show();
    this._hint(this._failed(), HINT_ERROR);
  }

  // What is held is PTT's screen again: the page is gone, it takes the frame
  // back, the hold ends.
  _backHome(outcome, text, level) {
    if (this.phase === 'idle') return;
    const core = this.core;
    this._closePage(false);
    const bm = this._bookmark;
    this._bookmark = null;
    this._release();
    this.kind.under.takeBack(core, () => recordFor(core).end(bm, outcome));
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
    if (text) this._hint(text, level);
  }

  // PTT shows neither the page's screen nor what it holds: the page is gone
  // and what was held is held with the message (its own recovery).
  _lostHome() {
    if (this.phase === 'idle') return;
    const core = this.core;
    this._closePage(false);
    this._bookmark = null;
    this._release();
    this.kind.under.hold(core, this);
    core._refreshScreenContext?.();
  }

  // Back to idle: the modal source and the Back.
  _release() {
    this.phase = 'idle';
    this._resumePending = false;
    this._subtitle = null;
    this._doneHint = null;
    if (this._offBack) this._offBack();
    this._offBack = null;
    this.core.setModalOpen?.(this.kind.source, false);
  }

  // The connection closed (App.onClose): PTT's screens and what was held are
  // gone. Drop everything without touching it.
  reset() {
    if (this.phase === 'idle') return;
    const core = this.core;
    this._closePage(false);
    const bm = this._bookmark;
    this._bookmark = null;
    this._release();
    if (bm) this.kind.under.drop(core, bm);
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
    const name = this.kind.words.screen;
    this._refuse(what === 'paste' ? unsupportedPasteHint(name) : unsupportedTextHint(name));
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
    const bytes = screenPageKeyBytes(e);
    if (bytes == null) {
      // A modifier alone, an F-key, Alt+← (the browser's Back): the browser's.
      if (!synthetic) return false;
      this._refuse(UNSUPPORTED_KEY_HINT);
      return true;
    }
    // PTT shows what is held: the page only leaves.
    if (this.phase === 'ended') {
      this._refuse(UNSUPPORTED_KEY_HINT);
      return true;
    }
    const d = this._decision();
    // Pressanykey: any key ends the screen, so it leaves the page.
    if (d.action === 'skip' && d.shape === 'pause') {
      this.dismiss();
      return true;
    }
    if (!this.core.sendMachineBytes || !this.core.sendMachineBytes(bytes)) this._refuse(this._failed());
    return true;
  }
}
