// A pause screen after Back (#189). With easy reading on, Back from an
// easy-reading article normally lands on the article list, which list easy
// reading presents. PTT can answer the Back with a pause screen first: a
// pressanykey ("請按任意鍵繼續", maybe with a message on the rows above it) or a
// vmsg banner (" ◆ <message> [按任意鍵繼續]"). That screen is data, not a page
// (#155): it is never painted. The page being left stays on screen (on the
// phone, the lower page Back revealed), PTT's message is surfaced as a status
// hint, one key dismisses the pause, and the list that follows is shown only
// through list easy reading.
//
// The hold is the view's held frame (term_view._navigationHeld): while it
// holds, frames that would draw the terminal grid are kept back, and its end
// lets the view draw the frame it held back (term_view.navigationEnded).
//
// Phases:
//   idle        nothing armed.
//   armed       Back was sent from an easy-reading article; PTT's answer is not
//               known yet. Holds only while a pause is on screen, so a Back
//               answered with the list (or anything else) is drawn as before.
//   dismissing  the dismissal key is on the wire (serialized_op_gate keeps the
//               reader's keys off it). Holds.
//   landing     PTT left the pause for the article list; holds until list easy
//               reading has taken it over.
// The hold ends when list easy reading presents the list, on a screen that is
// neither a pause nor the list (drawn as before), on a timeout, on a key of the
// reader's own, or on disconnection.
//
// PTT facts (docs/pttbbs-screen-protocol.md §6.1, src/js/screen_dismiss.js):
// pressanykey and vmsg both wait in `do { i = vkey(); } while (i == 0);`, so
// any real key dismisses them; Ctrl-L is no key, a space is. A paused movie
// ("暫停播放動畫，請按任意鍵繼續或 q 中斷") resumes on any key, so it is not
// a pause here (board_note_skip.js has the same exclusion).
//
// Covered by tests/unit/back_pause_hold.test.js and the offline specs
// mobile_stack_invalidation / back_pause (desktop).
import { classifyListScreen } from './list_session';
import { resolveDismiss, DISMISS_ANY_KEY, KEY_DISMISS } from './screen_dismiss';
import { parseVmsgText } from './push_screen';
import { easyReadingOn, readValuesWithDefault } from './pref_storage';
import { OWNER_ARTICLE_LIST } from './list_render_owner';
import { HINT_ERROR } from './status_hint';

// Back as the keyboard sends it (term_keyboard.js), in either cursor mode.
const BACK_KEYS = ['\x1b[D', '\x1bOD'];

// How long PTT's answer to Back is awaited: the stack handoff's bound
// (page_stack.js#HANDOFF_TIMEOUT_MS) and the board search hold's
// (article_search.js#BOARD_SEARCH_HOLD_MS).
export const ANSWER_MS = 5000;
// How long the list is awaited after the pause, for list easy reading to take
// it over (article_search.js#BOARD_SEARCH_LANDING_MS).
export const LANDING_MS = 6000;
// Pauses dismissed for one Back. PTT shows one; a second is dismissed too, a
// third is drawn as before.
export const MAX_DISMISSALS = 2;
// How long PTT's message stays (article_hold.js#NOTICE_MS).
export const HINT_MS = 4000;

// The dismissal command's windows (board_note_skip.js): a pause answers at once.
const STEP_PROBE_AFTER_MS = 700;
const STEP_PROBE_WINDOW_MS = 700;
const STEP_HARD_MS = 3000;

// pmore.c:163-169: a movie's footer. Its paused form also says 請按任意鍵繼續,
// but there a key plays on.
const MOVIE_FOOTER_RE = /動畫播放中|暫停播放動畫/;
const PAUSE_TEXT_RE = /\s*(?:請按任意鍵繼續|請按 空白鍵 繼續)\s*/;
// VMSG_PAUSE_PAD fills the pause row around the prompt.
const PAUSE_PAD_RE = /[▄\s]+/g;

function stripTrailingRedraw(bytes) {
  return String(bytes == null ? '' : bytes).replace(/\f+$/, '');
}

export function isBackKey(bytes) {
  return BACK_KEYS.indexOf(stripTrailingRedraw(bytes)) !== -1;
}

// Whether the last row is a pause one key dismisses: pressanykey or a vmsg
// banner, not a paused movie, not an input field.
export function isPauseRow(lastRowText, cursorOnInputField = false) {
  const last = String(lastRowText == null ? '' : lastRowText);
  if (MOVIE_FOOTER_RE.test(last)) return false;
  const dismiss = resolveDismiss({ lastRowText: last, cursorOnInputField });
  return !!dismiss && dismiss.kind === DISMISS_ANY_KEY && dismiss.bytes === KEY_DISMISS;
}

const blank = text => !String(text || '').trim();

// The message PTT shows with a pause, or null. A vmsg banner carries it on the
// pause row. A pressanykey shows it on the pause row left of the prompt, or on
// a cleared screen as the only text: at most MESSAGE_ROWS rows. More text is the
// screen the pause was drawn over, not a message, and no hint is shown.
const MESSAGE_ROWS = 2;
export function pauseMessage(rowTexts) {
  const rows = rowTexts || [];
  const n = rows.length;
  if (!n) return null;
  const last = String(rows[n - 1] || '');
  const vmsg = parseVmsgText(last);
  if (vmsg !== null) return vmsg || null;
  const inline = last.replace(PAUSE_TEXT_RE, ' ').replace(PAUSE_PAD_RE, ' ').trim();
  if (inline) return inline;
  const text = [];
  for (let r = 0; r < n - 1; ++r) if (!blank(rows[r])) text.push(String(rows[r]).trim());
  if (!text.length || text.length > MESSAGE_ROWS) return null;
  return text.join(' ');
}

// What a settled screen after Back is: 'pause', 'list' (the article list),
// 'article' (still an article), 'menu' (a menu or board list), or 'unknown'.
export function backAnswerOf(facts) {
  const f = facts || {};
  const rowTexts = f.rowTexts || [];
  const rows = f.rows || rowTexts.length;
  if (isPauseRow(rowTexts[rows - 1], !!f.cursorOnInputField)) return 'pause';
  let kind = f.kind;
  if (kind === undefined) {
    kind = classifyListScreen({
      rowTexts, rows, curX: f.curX, curY: f.curY, row0Reversed: !!f.row0Reversed, row2Reversed: !!f.row2Reversed
    }).kind;
  }
  if (kind === 'clean-list') return 'list';
  if (kind === 'article' || kind === 'menu') return kind;
  return 'unknown';
}

export class BackPauseHold {
  constructor(core, view, termBuf, queue) {
    this.core = core;
    this.view = view;
    this.buf = termBuf;
    this.queue = queue;
    this.phase = 'idle';
    this._dismissals = 0;
    this._writesAtSend = 0;
    this._timer = null;
    // Set by the dismissal command's onSend, taken by noteSent: our own key.
    this._ownSend = false;
    if (termBuf && termBuf.addEventListener)
      termBuf.addEventListener('screenSettled', () => this._onScreenSettled());
  }

  // The view holds its frames (term_view._navigationHeld).
  get holding() {
    if (this.phase === 'dismissing' || this.phase === 'landing') return true;
    return this.phase === 'armed' && this._pauseShown();
  }

  // The dismissal key is on the wire: the reader's keys wait
  // (serialized_op_gate.js).
  get busy() {
    return this.phase === 'dismissing';
  }

  // The screen PTT shows now is a pause this hold dismisses, or the answer to
  // its key: the stack's handoff waits instead of ending (stack_handoff.js).
  absorbs() {
    return this.phase === 'dismissing' || (this.phase === 'armed' && this._pauseShown());
  }

  _pauseShown() {
    const buf = this.buf;
    if (!buf || !buf.getRowText) return false;
    const onField = typeof buf.isCursorOnInputField === 'function' ? buf.isCursorOnInputField() : false;
    return isPauseRow(buf.getRowText(buf.rows - 1, 0, buf.cols), onField);
  }

  _log(name, info) {
    this.core?.debugRecorder?.log?.('backPause.' + name, info || {});
  }

  // Another app-driven run owns the screens after its own Back.
  _othersBusy() {
    const c = this.core || {};
    return !!(c.aidNavigation?.active || c.articleShortcutSearch?.active || c.threadJump?.active ||
      c.headerlessReopen?.active || c.articleResize?.active || c.listResize?.active ||
      c.longPush?.active || c.logout?.active || c.articleHold?.held);
  }

  // An easy-reading article is on screen, as the reader reads it.
  _articleShown() {
    const view = this.view, buf = this.buf;
    return !!(view && buf && view.useEasyReadingMode && buf.pageState === 3 && !buf.easyReadingFunctionMode);
  }

  // Every data send (TelnetConnection.onDataSent).
  noteSent(bytes) {
    if (this._ownSend) {
      this._ownSend = false;
      return;
    }
    // The queue's probe and Ctrl-L redraws are no keys.
    if (!stripTrailingRedraw(bytes)) return;
    // While landing, list easy reading may already read the list it takes
    // over; a key of the reader's own ends the landing by the screen it leads
    // to (_onScreenSettled).
    if (this.phase === 'dismissing' || this.phase === 'landing') return;
    // A key of the reader's own while PTT has not answered: the screens are
    // theirs again.
    if (this.phase === 'armed') this._end('foreign-key');
    if (!isBackKey(bytes) || !this._articleShown() || this._othersBusy() || !easyReadingOn(readValuesWithDefault()))
      return;
    this.phase = 'armed';
    this._dismissals = 0;
    this._writesAtSend = this.buf.serverWrites || 0;
    this._arm(ANSWER_MS, 'answer-timeout');
    this._log('arm', {});
  }

  _arm(ms, reason) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this._end(reason);
    }, ms);
  }

  _facts(snap) {
    const buf = this.buf;
    const rowTexts = [];
    for (let r = 0; r < buf.rows; ++r) rowTexts.push(buf.getRowText(r, 0, buf.cols));
    return {
      rowTexts,
      rows: buf.rows,
      curX: snap ? snap.curX : buf.cur_x,
      curY: snap ? snap.curY : buf.cur_y,
      row0Reversed: buf.isUnicolor ? buf.isUnicolor(0, 0, 29) : false,
      row2Reversed: buf.isUnicolor ? buf.isUnicolor(2, 0, buf.cols - 10) : false,
      cursorOnInputField: typeof buf.isCursorOnInputField === 'function' ? buf.isCursorOnInputField() : false
    };
  }

  _onScreenSettled() {
    if (this.phase !== 'armed' && this.phase !== 'landing') return;
    const snap = this.buf.settleSnapshot;
    // A purely local repaint, or a screen from before the Back, is no answer.
    if (snap && snap.changedRows && snap.changedRows.size === 0 && !snap.cursorMoved) return;
    if (snap && snap.serverWrites != null && snap.serverWrites <= this._writesAtSend) return;
    const facts = this._facts(snap);
    const answer = backAnswerOf(facts);
    if (answer === 'pause') return this._dismiss(facts);
    if (this.phase === 'armed') {
      // Not answered yet, or answered with a screen no pause hides: as before.
      if (answer === 'article' || answer === 'unknown') return;
      return this._end(answer);
    }
    if (answer === 'list') return queueMicrotask(() => this._checkPresented());
    this._end(answer);
  }

  _dismiss(facts) {
    if (this._dismissals >= MAX_DISMISSALS) return this._end('max-dismissals');
    this._dismissals += 1;
    this.phase = 'dismissing';
    clearTimeout(this._timer);
    this._timer = null;
    const message = pauseMessage(facts.rowTexts);
    this._log('dismiss', { round: this._dismissals, message: !!message });
    // PTT's own words, in place of a screen never painted: shown even with
    // status hints off, like article_hold.js's notices.
    if (message) this.view?.flashListHint?.(message, HINT_MS, HINT_ERROR);
    this.queue.enqueue({
      keys: KEY_DISMISS,
      kind: 'back-pause',
      fullRepaint: true,
      timeoutMs: STEP_PROBE_AFTER_MS,
      probeTimeoutMs: STEP_PROBE_WINDOW_MS,
      hardTimeoutMs: STEP_HARD_MS,
      onSend: () => {
        this._ownSend = true;
      },
      onFlushed: () => this._end('flushed'),
      expect: (snapshot, f) => {
        const answer = backAnswerOf({ ...f, cursorOnInputField: this._facts(snapshot).cursorOnInputField });
        if (answer === 'pause') return { again: f };
        if (answer === 'list') return { landed: true };
        if (answer === 'article' || answer === 'menu') return { other: answer };
        return false;
      },
      onDone: result => {
        if (this.phase !== 'dismissing') return;
        if (result.again) return this._dismiss(result.again);
        if (result.other) return this._end(result.other);
        this.phase = 'landing';
        this._writesAtSend = this.buf.serverWrites || 0;
        this._arm(LANDING_MS, 'landing-timeout');
        // List easy reading takes the list over in this same settle.
        queueMicrotask(() => this._checkPresented());
      },
      onFail: reason => {
        this._log('fail', { reason });
        this._end('fail');
      }
    });
  }

  // List easy reading shows the list.
  _checkPresented() {
    if (this.phase !== 'landing') return;
    const buf = this.buf;
    if (buf.listRenderMode === 'buffer' && buf.listRenderOwner === OWNER_ARTICLE_LIST) this._end('presented');
  }

  _end(reason) {
    if (this.phase === 'idle') return;
    clearTimeout(this._timer);
    this._timer = null;
    this.phase = 'idle';
    this._ownSend = false;
    this._log('end', { reason });
    // The frame held back is drawn now, even when PTT sends nothing more.
    this.view?.navigationEnded?.();
  }

  // Disconnection.
  reset() {
    clearTimeout(this._timer);
    this._timer = null;
    this.phase = 'idle';
    this._ownSend = false;
    this._dismissals = 0;
  }
}
