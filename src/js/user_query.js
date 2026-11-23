// Querying a user from PTT's online user list (#199 phase 2).
//
// PTT's query (talk.c#t_query, `Q` on the user list) asks for an ID, draws the
// user's query screen over the list and waits for a key; after that key it
// draws the list again, after a sleep when another query came shortly before
// (see QUERY_STEP_BUDGET). Easy reading presents the query screen as a page
// of its own, stacked over the list: the list stays on screen under it, held (term_view's held branch draws none of PTT's frames
// while `holding`), and comes back at once when the page is dismissed.
//
// Both entrances (a tap on a user card, and the 查詢網友 sheet) send the same
// sequence, each key only after PTT answered the one before (never typed ahead):
//   1. `Q`           ⇒ PTT's 【查詢網友】 prompt (user_list.isUserQueryPrompt)
//   2. ID + Enter    ⇒ the query screen (the page shows it), the list again
//                      (no such user: 找不到這個使用者), or the usage-limit
//                      alert (user_list.userQueryAlert), dismissed with a space:
//                      a denial gives the list back (a hint says why), a
//                      slowdown goes on to the query screen.
// The ID is never typed at the list: PTT's own list moves under its numbers,
// and `Q` names the user. PTT completes a unique prefix (name.c#usercomplete),
// so the page reads the ID it shows from the screen.
// Leaving the page (Back, system Back, ←, a swipe right) sends one space for
// PTT's 請按任意鍵繼續 and shows the list under it at once; the hold lasts until
// PTT has drawn its list again (through the sleep), and the list takes that
// frame back with its rows and selection (ListSession.resumeAfterHelp).
// A failure stays on the list with a hint: no answer in time, the alert's
// denial, an unknown ID. A query asked for while another operation runs is
// refused with a hint and sends nothing.
//
// The author of an article (#254) is queried the same way from the article
// list: Ctrl-Q (read.c#read_cmd_query) queries the author of the article under
// PTT's cursor, so ListSession.beginAuthorQuery moves PTT's cursor to the
// selected article first, then sends Ctrl-Q alone. PTT answers with the same
// query screen, the alert, or nothing for an author it does not know (the
// list again, drawn by the repaint every step asks for).
import { i18n } from './i18n';
import { HINT_ERROR } from './status_hint';
import { keyEventPredatesModalClose } from './modal_key_gate';
import { recordFor } from './reading_record';
import { serializedOpHint } from './serialized_op_gate';
import { UNSUPPORTED_KEY_HINT, unsupportedPasteHint, unsupportedTextHint } from './unsupported_hint';
import { OverListPage } from './over_list_page';
import {
  isUserQueryPrompt,
  isUserQueryScreen,
  parseUserQueryScreen,
  userListView,
  userQueryAlert
} from './user_list';

// PTT's user IDs: a letter, then letters and digits, at most 12 (IDLEN). The
// sheet accepts a prefix, which PTT completes.
export const USER_QUERY_ID_RE = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const HINT_MS = 3000;
// The answer to ID + Enter, and to the space leaving the page. After the key
// PTT sleeps before it draws the list, only when the previous query ended
// shortly before (talk.c#my_query): 2 s if that was under 1 s earlier, 1 s if
// under 2 s earlier, none otherwise. The budget covers the longest sleep.
const QUERY_STEP_BUDGET = { timeoutMs: 4000, probeTimeoutMs: 3000, hardTimeoutMs: 10000 };
const KEY_DISMISS = ' ';
// Named keys the keyboard types that the page refuses with the hint (the
// keypad's are all refused); the other named keys (F5...) are the browser's.
const REFUSED_NAMED_KEYS = ['Enter', 'Backspace', 'Delete', 'Tab', 'ArrowRight'];
const SOURCE = 'userQuery';

const FIELD_ROWS = [
  ['id', 'userQuery_fieldId'],
  ['nick', 'userQuery_fieldNick'],
  ['money', 'userQuery_fieldMoney'],
  ['logins', 'userQuery_fieldLogins'],
  ['posts', 'userQuery_fieldPosts'],
  ['activity', 'userQuery_fieldActivity'],
  ['mail', 'userQuery_fieldMail'],
  ['lastLogin', 'userQuery_fieldLastLogin'],
  ['lastHost', 'userQuery_fieldLastHost'],
  ['record', 'userQuery_fieldRecord']
];

function screenTexts(buf) {
  const out = [];
  if (!buf || typeof buf.getRowText !== 'function') return out;
  if (buf.changed && typeof buf.updateCharAttr === 'function') buf.updateCharAttr();
  for (let r = 0; r < buf.rows; ++r) out.push(buf.getRowText(r, 0, buf.cols));
  return out;
}

// What PTT answered ID + Enter (or Ctrl-Q, or the space over an alert) with,
// or false while it has not. `listShown` tells the list the query was asked
// from (UserQuery._listShown).
function queryAnswer(buf, listShown) {
  const texts = screenTexts(buf);
  const alert = userQueryAlert(texts);
  if (alert) return { alert };
  if (isUserQueryScreen(buf)) {
    const query = parseUserQueryScreen(texts);
    return query ? { query } : false;
  }
  if (listShown()) return { list: true };
  return false;
}

export class UserQuery {
  constructor(core) {
    this.core = core;
    // idle → asking (`Q` sent) → typing (ID sent) [→ alert (space sent)]
    //      → shown (the page) → leaving (space sent) → idle
    this.phase = 'idle';
    // 'user': asked from the online user list; 'author': an article's author,
    // asked from the article list (#254).
    this._source = 'user';
    this._id = null;
    this._listAppBar = null;
    this._parsed = null;
    this._bookmark = null;
    this._alert = null;
    this._page = null;
    this._onSettled = null;
    this._shell = null;
    this._offBack = null;
    this._recovering = false;
  }

  // term_view holds PTT's frames from `Q` until the list is back (_navigationHeld).
  get holding() {
    return this.phase !== 'idle';
  }

  // The wire belongs to the query (serializedOpHint).
  get busy() {
    return this.phase !== 'idle';
  }

  // Whether a query can be asked for now: list easy reading presents PTT's
  // user list and is idle, and nothing else runs on the wire. The one
  // predicate of every entrance (the card, More, the context menu, the palette).
  available() {
    const core = this.core;
    const ls = core && core.listSession;
    if (this.phase !== 'idle' || !ls || !ls.isUserList || !ls.isUserList()) return false;
    if (ls.state !== 'active' || !core.buf || core.buf.listRenderMode !== 'buffer') return false;
    if (typeof core.activeListSession === 'function' && core.activeListSession() !== ls) return false;
    return !serializedOpHint(core);
  }

  // Whether an article's author can be queried now (#254): list easy reading
  // presents an article list (not the mailbox, not the user list) and is idle,
  // and nothing else runs on the wire.
  authorAvailable() {
    const core = this.core;
    const ls = core && core.listSession;
    if (this.phase !== 'idle' || !ls || !ls.selectedAuthorTarget) return false;
    if (ls.isUserList() || ls.isMailList()) return false;
    if (ls.state !== 'active' || !core.buf || core.buf.listRenderMode !== 'buffer') return false;
    if (typeof core.activeListSession === 'function' && core.activeListSession() !== ls) return false;
    return !serializedOpHint(core);
  }

  // Whether PTT shows the list the query was asked from again.
  _listShown() {
    const core = this.core;
    if (this._source === 'author') return !!core.listSession?.showsHeldList?.();
    return !!userListView(core.buf);
  }

  // Whether the page shows (the mobile toolbar works over it).
  get pageShown() {
    return this.phase === 'shown';
  }

  // The App Bar while the query runs (mobile_toolbar.mobileToolbarContext):
  // the list's until the page shows, then the page's; null when idle.
  appBar() {
    if (this.phase === 'idle') return null;
    if (this.phase !== 'shown') return this._listAppBar;
    const p = this._parsed;
    return {
      kind: 'other', title: i18n('userQuery_title'), subtitle: p ? p.id : this._id || '',
      time: '', byline: '', newMail: false
    };
  }

  // The system Back while the query runs: it leaves the page when that shows;
  // before and after it PTT is mid-sequence, so it is answered with the busy
  // hint and counts for nothing else (history_back_guard would take it for an
  // escape attempt).
  _back() {
    if (this.phase === 'shown') this.dismiss();
    else if (this.phase !== 'idle') this._hint(i18n('userQuery_busy'));
  }

  _hint(text, level) {
    this.core.view?.flashListHint?.(text, HINT_MS, level);
  }

  // Ask PTT for user `id` (see the module comment). Returns whether the
  // sequence was sent; when not, a hint says why.
  query(id) {
    const core = this.core;
    const ls = core && core.listSession;
    const busy = serializedOpHint(core);
    if (busy) {
      this._hint(busy);
      return false;
    }
    if (!this.available()) {
      this._hint(ls && ls.state !== 'active' && ls.isUserList?.() ? i18n('userQuery_busy') : i18n('userQuery_unavailable'));
      return false;
    }
    // A user who logged off (`< 離站中..>`) has no ID to ask for.
    if (id == null) {
      this._hint(i18n('userQuery_gone'));
      return false;
    }
    if (!USER_QUERY_ID_RE.test(String(id || ''))) return false;
    this._begin('user', id, 'asking');
    ls.beginUserQuery([
      {
        keys: 'Q',
        kind: 'user-query',
        expect: () => isUserQueryPrompt(core.buf),
        onDone: () => {
          this.phase = 'typing';
        },
        onFail: () => this._fail()
      },
      {
        keys: this._id + '\r',
        kind: 'user-query',
        ...QUERY_STEP_BUDGET,
        expect: () => queryAnswer(core.buf, () => this._listShown()),
        onDone: (answer) => this._answered(answer),
        onFail: () => this._fail()
      }
    ]);
    return true;
  }

  // Ask PTT for the author of the selected article (#254, see the module
  // comment); `target` (authorQueryTargetAtRow's) selects that article first.
  // Returns whether Ctrl-Q was sent; when not, a hint says why.
  queryAuthor(target) {
    const core = this.core;
    const ls = core && core.listSession;
    const busy = serializedOpHint(core);
    if (busy) {
      this._hint(busy);
      return false;
    }
    if (!this.authorAvailable()) {
      this._hint(i18n('authorQuery_unavailable'));
      return false;
    }
    if (target && !ls.selectAuthorQueryTarget(target)) {
      this._hint(i18n('authorQuery_noAuthor'));
      return false;
    }
    const article = ls.selectedAuthorTarget();
    if (!article || !USER_QUERY_ID_RE.test(article.author)) {
      this._hint(i18n('authorQuery_noAuthor'));
      return false;
    }
    this._begin('author', article.author, 'typing');
    ls.beginAuthorQuery([
      {
        keys: '\x11',
        kind: 'author-query',
        ...QUERY_STEP_BUDGET,
        expect: () => queryAnswer(core.buf, () => this._listShown()),
        onDone: (answer) => this._answered(answer),
        onFail: () => this._fail()
      }
    ], () => this.reset());
    return true;
  }

  // The state a query starts in, whichever its entrance.
  _begin(source, id, phase) {
    const core = this.core;
    this._source = source;
    this._id = String(id);
    this._alert = null;
    this._parsed = null;
    this._listAppBar = core._screenContext?.appBar || null;
    this._bookmark = recordFor(core).begin('user-query');
    this.phase = phase;
    // The system Back is the query's for the whole run (see _back).
    this._offBack = core.registerSheetDismiss ? core.registerSheetDismiss(() => this._back()) : null;
    // Terminal keys and taps stop until the list is back: the screens under
    // the held list are PTT's, and a tap there must not answer them.
    core.setModalOpen?.(SOURCE, true);
    core._refreshScreenContext?.();
  }

  _answered(answer) {
    if (this.phase === 'idle') return;
    if (answer.alert) return this._dismissAlert(answer.alert);
    if (answer.query) return this._show(answer.query);
    // PTT drew the list again: no such user, or the alert's denial. The list
    // takes its frame back after this settle (help_menu does the same).
    const text = this._alert && this._alert.status === 'denied' ? i18n('userQuery_flood')
      : i18n(this._source === 'author' ? 'authorQuery_notFound' : 'userQuery_notFound');
    queueMicrotask(() => this._backOnList('cancel', text, HINT_ERROR));
  }

  // The usage-limit alert: one space dismisses it (screen_dismiss.KEY_DISMISS).
  _dismissAlert(alert) {
    this._alert = alert;
    this.phase = 'alert';
    const core = this.core;
    const sent = core.listSession.continueUserQuery({
      keys: KEY_DISMISS,
      kind: 'user-query-alert',
      ...QUERY_STEP_BUDGET,
      expect: () => {
        const a = queryAnswer(core.buf, () => this._listShown());
        // The alert still up (its own redraw) is not an answer.
        return a && !a.alert ? a : false;
      },
      onDone: (answer) => this._answered(answer),
      onFail: () => this._fail()
    });
    if (!sent) this._fail();
  }

  // A step got no answer, or the leave could not be sent. After the ID (or the
  // leave) PTT may still sit at the Q prompt, the alert or the query screen,
  // waiting for a key: one more key (Enter leaves the prompt, the alert and the
  // query screen; a space after a leave) makes it draw its list, and only then
  // does the list take its frame back. When that cannot be sent, or is not
  // answered either, the list takes the frame anyway, with the hint. Over the
  // article list (#254) Enter opens an article, so the key goes out only while
  // PTT shows the query screen or the alert.
  _fail() {
    if (this.phase === 'idle') return;
    const text = this._alert ? i18n('userQuery_flood') : i18n('userQuery_failed');
    const core = this.core;
    const waiting = ['typing', 'alert', 'leaving'].includes(this.phase) && !this._recovering &&
      !this._listShown() && (this._source !== 'author' || isUserQueryScreen(core.buf) ||
        !!userQueryAlert(screenTexts(core.buf)));
    if (waiting) {
      this._recovering = true;
      this._closePage(false);
      const sent = core.listSession?.continueUserQuery?.({
        keys: this.phase === 'leaving' ? KEY_DISMISS : '\r',
        kind: 'user-query-recover',
        ...QUERY_STEP_BUDGET,
        expect: () => this._listShown(),
        onDone: () => queueMicrotask(() => this._backOnList('fail', text, HINT_ERROR)),
        onFail: () => this._backOnList('fail', text, HINT_ERROR)
      });
      if (sent) return;
    }
    this._backOnList('fail', text, HINT_ERROR);
  }

  // The list is PTT's screen again (or the query gave up): the page is gone,
  // the list takes the frame back with its rows and selection, the hold ends.
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

  // Back to idle: the modal source, the Back and the reading-record bookmark.
  // Returns the bookmark for the caller to end.
  _release() {
    this.phase = 'idle';
    this._recovering = false;
    if (this._offBack) this._offBack();
    this._offBack = null;
    this._alert = null;
    this.core.setModalOpen?.(SOURCE, false);
  }

  // The connection closed mid-query (App.onClose): PTT's screens, the list and
  // its session are gone. Drop everything the query holds without touching the
  // list (it is disabled), so the reconnect starts clean.
  reset() {
    if (this.phase === 'idle') return;
    const core = this.core;
    this._closePage(false);
    const bm = this._bookmark;
    this._bookmark = null;
    this._release();
    recordFor(core).end(bm, 'fail');
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
  }

  // ---- The page ----

  _show(parsed) {
    const core = this.core;
    this._parsed = parsed;
    this.phase = 'shown';
    this._openPage();
    core._refreshScreenContext?.();
    // Later frames of the same screen (the plan drawn after the rows, a redraw
    // after a resize) update the page.
    if (!this._onSettled && core.buf && core.buf.addEventListener) {
      this._onSettled = () => this._settled();
      core.buf.addEventListener('screenSettled', this._onSettled);
    }
  }

  _settled() {
    if (this.phase !== 'shown') return;
    const buf = this.core.buf;
    if (isUserQueryScreen(buf)) {
      const parsed = parseUserQueryScreen(screenTexts(buf));
      if (parsed && JSON.stringify(parsed) !== JSON.stringify(this._parsed)) {
        this._parsed = parsed;
        this._fillPage();
        this.core._refreshScreenContext?.();
      }
      return;
    }
    // PTT left the query screen by itself and shows the list.
    if (this._listShown()) queueMicrotask(() => this._backOnList('cancel'));
  }

  // Leave the page: Back, system Back, ←, a swipe right. The list shows at
  // once; PTT is told with one space (only while it shows the query screen,
  // which waits for that key), and the list is held until PTT draws it.
  dismiss() {
    if (this.phase !== 'shown') return false;
    const core = this.core;
    this.phase = 'leaving';
    this._closePage(true);
    core._refreshScreenContext?.();
    if (!isUserQueryScreen(core.buf)) {
      if (this._listShown()) this._backOnList('cancel');
      else this._fail();
      return true;
    }
    const sent = core.listSession.continueUserQuery({
      keys: KEY_DISMISS,
      kind: 'user-query-leave',
      ...QUERY_STEP_BUDGET,
      expect: () => this._listShown(),
      onDone: () => queueMicrotask(() => this._backOnList('cancel')),
      onFail: () => this._fail()
    });
    if (!sent) this._fail();
    return true;
  }

  _openPage() {
    if (this._page) return;
    const shell = new OverListPage(this.core.view, {
      marker: 'user-query',
      className: 'userQueryPage',
      label: i18n('userQuery_title'),
      // The page takes its own keys (terminal keys stopped at query()).
      onKey: (e) => this._key(e),
      canSwipe: () => this.phase === 'shown',
      onSwipeLeave: () => this.dismiss()
    });
    const scroll = document.createElement('div');
    scroll.className = 'userQueryScroll';
    shell.el.appendChild(scroll);
    this._page = shell.el;
    this._shell = shell;
    this._fillPage();
    if (!shell.open()) {
      this._page = null;
      this._shell = null;
    }
  }

  _fillPage() {
    const page = this._page;
    const p = this._parsed;
    if (!page || !p) return;
    page.setAttribute('data-user-id', p.id);
    const scroll = page.firstChild;
    const top = scroll.scrollTop;
    scroll.textContent = '';
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const values = { ...p, record: [p.five && '五子棋 ' + p.five, p.chess && '象棋 ' + p.chess].filter(Boolean).join('／') };
    const list = el('dl', 'userQueryFields');
    for (const [field, label] of FIELD_ROWS) {
      if (!values[field]) continue;
      const row = el('div', 'userQueryRow');
      row.setAttribute('data-field', field);
      row.appendChild(el('dt', 'userQueryLabel', i18n(label)));
      row.appendChild(el('dd', 'userQueryValue', values[field]));
      list.appendChild(row);
    }
    scroll.appendChild(list);
    const plan = el('section', 'userQueryPlan');
    plan.setAttribute('data-user-query-plan', p.plan.length ? '' : 'none');
    plan.appendChild(el('h2', 'userQueryPlanTitle', i18n('userQuery_plan')));
    plan.appendChild(p.plan.length ? el('pre', 'userQueryPlanText', p.plan.join('\n'))
      : el('p', 'userQueryPlanEmpty', i18n('userQuery_noPlan')));
    scroll.appendChild(plan);
    scroll.scrollTop = top;
  }

  _key(e) {
    if (!this.takeKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // Whether keys and typed text are the page's to judge: it shows and no sheet
  // or dialog is over it (that one keeps its own keys).
  ownsInput() {
    if (this.phase !== 'shown' || !this._page) return false;
    return !(this.core._openModals && this.core._openModals.size > 1);
  }

  _refuse(text) {
    this.core.view?.flashListHint?.(text, 4000, HINT_ERROR);
  }

  // Text that is no single typed key (an input method's words, a paste) while
  // the page shows: refused with the hint of the other easy-reading pages.
  // Returns whether the page took it.
  refuseText(text, what) {
    if (!this.ownsInput()) return false;
    this._refuse(what === 'paste' ? unsupportedPasteHint('查詢頁') : unsupportedTextHint('查詢頁'));
    return true;
  }

  // A key for the page: the keyboard's (the window listener above), and the
  // keys that are no keydown on window (term_view.sendKeyAsUser: the toolbar
  // keypad's keys, and a character the soft keyboard typed: `synthetic`). `e`
  // needs key and the modifier flags. Returns whether the page took it: every
  // key while the page shows, so none of them reaches the list held under it.
  // The page's own keys act (below); any other is refused with the hint
  // easy reading gives elsewhere. Only the keyboard's modified keys and
  // browser keys (F5, F12...) pass, since the browser owns them.
  takeKey(e, synthetic) {
    if (!this.ownsInput()) return false;
    // A modified key is not the page's: the browser's (Alt+← is its Back,
    // Ctrl+q...). A synthetic one (the keypad with Ctrl armed) is refused.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (!synthetic) return false;
      this._refuse(UNSUPPORTED_KEY_HINT);
      return true;
    }
    // A key that closed a sheet over the page (Esc on the More sheet) is
    // already answered: the sheet was the top-most layer, the page is next.
    // The sheet's own handler ran first and closed it before this one.
    if (!synthetic && keyEventPredatesModalClose(e.timeStamp, this.core.anyModalClosedAt)) return false;
    const scroll = this._page.firstChild;
    const step = 40;
    const pageStep = Math.max(step, scroll.clientHeight - step);
    switch (e.key) {
      case 'ArrowLeft':
      case 'Escape':
      case 'q':
        this.dismiss();
        break;
      case 'ArrowUp':
        scroll.scrollTop -= step;
        break;
      case 'ArrowDown':
        scroll.scrollTop += step;
        break;
      case 'PageUp':
        scroll.scrollTop -= pageStep;
        break;
      case 'PageDown':
      case ' ':
        scroll.scrollTop += pageStep;
        break;
      case 'Home':
        scroll.scrollTop = 0;
        break;
      case 'End':
        scroll.scrollTop = scroll.scrollHeight;
        break;
      default:
        // Modifier keys alone, and the shortcuts of the browser, pass.
        if (!synthetic && (e.ctrlKey || e.metaKey || e.altKey ||
            (e.key.length > 1 && !REFUSED_NAMED_KEYS.includes(e.key)))) return false;
        this._refuse(UNSUPPORTED_KEY_HINT);
    }
    return true;
  }

  // slide: the page slides out over the list (the list shows at once under it).
  _closePage(slide) {
    const core = this.core;
    if (this._onSettled && core.buf && core.buf.removeEventListener)
      core.buf.removeEventListener('screenSettled', this._onSettled);
    this._onSettled = null;
    const shell = this._shell;
    this._shell = null;
    this._page = null;
    if (shell) shell.close(slide);
  }
}

function controller(core) {
  return core && core.userQuery;
}

// Query the user `id` on a card of the user list (a tap on it). Returns true
// when the query was sent, false (with a hint) while another operation runs
// or when easy reading does not present the user list.
export function queryUser(core, id) {
  const q = controller(core);
  return !!q && q.query(id);
}

// Query the author of the selected article on the article list (#254): Ctrl-Q,
// and 查詢作者 in the context menu, whose `target` (a row's article) is
// selected first. Returns true when Ctrl-Q was sent, false (with a hint) when
// not.
export function queryAuthor(core, target) {
  const q = controller(core);
  return !!q && q.queryAuthor(target);
}

// Open the app's 查詢網友 sheet (the search sheet asking for a user ID); its
// confirm queries that ID. Returns whether the sheet opened; when not, a hint
// says why.
export function promptUserQuery(core) {
  const q = controller(core);
  if (!q) return false;
  const busy = serializedOpHint(core);
  if (busy || !q.available()) {
    q._hint(busy || i18n('userQuery_unavailable'));
    return false;
  }
  return !!(core.openUserQuerySheet && core.openUserQuerySheet());
}
