// A failed app-driven article operation holds the article (#193): a far
// thread jump, the reopen of an article without a header, fitting the article
// to a new screen size. The reader stays on the article at the reading
// position (a copy of it covers the reading area, see coverWithArticle), sees
// a message naming the cause, the failure is logged as a bug, and nothing
// more is sent: the sessions that would present PTT's screens stay parked and
// keys wait with a message (serializedOpHint). Pull-to-refresh retries from
// what PTT shows. CODING_STANDARDS.md, "A failed check holds the page".
import { coverWithArticle } from './hidden_article_route';
import { refreshTargetOf } from './screen_refresh';
import { searchGateFacts } from './article_search';
import { atPagerStatusRow } from './long_push_gate';
import { parsePagerFooterContext } from './string_util';
import { EMPTY_TOOLBAR_CONTEXT } from './mobile_toolbar';
import { recordFor } from './reading_record';
import { reportBug } from './bug_event';
import { HINT_ERROR } from './status_hint';
import { i18n } from './i18n';

const NOTICE_MS = 4000;
// How long easy reading may still mirror PTT's screen after an operation over
// the article has ended, before the article is held there.
export const LANDING_MS = 5000;

// An article the refresh cannot name (one without a header has no board):
// easy reading presents it as PTT shows it, which reads its identity again.
function articleShown(core) {
  const facts = searchGateFacts(core);
  if (!facts || facts.inputField || core.buf.pageState !== 3) return null;
  const last = core.buf.getRowText(core.buf.rows - 1);
  return atPagerStatusRow(last) && parsePagerFooterContext(last) === 'reading' ? { kind: 'article-shown' } : null;
}

// Whether easy reading presents an article now, outside its native mirror.
export function articlePresented(core) {
  const { view, buf } = core;
  return !!(view?.useEasyReadingMode && buf?.startedEasyReading && buf.pageState === 3 &&
    !buf.easyReadingFunctionMode);
}

export class ArticleHold {
  constructor(core) {
    this.core = core;
    this.held = false;
    this.cover = null;
    this.appBar = null;
    // The operation PttChrome runs over the article now (#209), or null.
    this.running = null;
    // The operation has ended while easy reading still mirrors PTT's screen.
    this._landing = null;
  }

  // An operation PttChrome runs itself over an easy-reading article (a long
  // comment, a jump by article code, logging out, ...) drives PTT through
  // native screens. The article stays on screen while it runs: term_view
  // holds every frame that would draw the terminal grid (_navigationHeld),
  // and the App Bar stays the article's, locked. Call before the operation
  // enters easy reading's native mirror. Returns false, holding nothing, when
  // no easy-reading article is shown (easy reading off, a list, a prompt).
  run(source) {
    const core = this.core;
    if (this.held || this.running || !articlePresented(core)) return false;
    this._clearLanding();
    this.running = source;
    this.appBar = core._screenContext?.appBar || null;
    core._refreshScreenContext?.();
    return true;
  }

  // The operation `source` has ended. The page shown next is easy reading's
  // own (the article again, another article, a list), drawn once easy reading
  // has left its native mirror; a mirror that outlasts LANDING_MS is a screen
  // easy reading cannot present, and the article is held there.
  done(source) {
    if (!source || this.running !== source) return;
    this.running = null;
    const buf = this.core.buf;
    if (buf.easyReadingFunctionMode) this.core.easyReading?.settleFunctionMode();
    if (buf.easyReadingFunctionMode) {
      this._landing = { source, timer: setTimeout(() => this._landed(), LANDING_MS) };
    } else {
      this._released();
    }
  }

  // The operation `source` failed: the article stays shown, held (see hold),
  // with `text`, the message itself, or the message key `message`. `parked`:
  // the operation's sessions are still parked (see hold).
  fail(source, { reason, message, text, parked = false }) {
    if (!source || this.running !== source) return false;
    this.hold({ source, reason, message, text, appBar: this.appBar, parked });
    this.core.view.navigationEnded?.();
    return true;
  }

  // Whether term_view holds the grid frames (_navigationHeld): for an
  // operation, and under a held article, so that the page under the cover is
  // still the article when the hold is released.
  get holding() {
    return this.held || !!this.running || !!(this._landing && this.core.buf.easyReadingFunctionMode);
  }

  _landed() {
    const landing = this._landing;
    this._landing = null;
    if (!landing) return;
    if (!this.core.buf.easyReadingFunctionMode) {
      this._released();
      return;
    }
    this.hold({ source: landing.source, reason: 'unpresented', message: 'articleHold_unpresented',
      appBar: this.appBar, parked: true });
    this.core.view.navigationEnded?.();
  }

  _clearLanding() {
    if (this._landing) clearTimeout(this._landing.timer);
    this._landing = null;
  }

  _released() {
    if (!this.held) this.appBar = null;
    this.core._refreshScreenContext?.();
    this.core.view.navigationEnded?.();
  }

  // `source`, `reason`: the bug event; `message`: the message key naming the
  // cause, or `text`: the message itself; `cover`: the copy of the article
  // already on screen, or none to copy the article shown now; `parked`: the
  // caller already parked the sessions and entered the native mirror.
  hold({ source, reason, message, text, cover, appBar, parked = false }) {
    const core = this.core;
    reportBug(core, source, reason, {});
    this.running = null;
    this._clearLanding();
    if (this.held) {
      cover?.destroy();
    } else {
      this.held = true;
      this.cover = cover || coverWithArticle(core.view);
      this.appBar = appBar || core._screenContext?.appBar || null;
      if (!parked) {
        core.easyReading?._enterFunctionMode();
        core.listSession?.beginExternalNavigation({ fromIdle: true });
        core.boardListSession?.beginExternalNavigation();
      }
      core._refreshScreenContext?.();
    }
    core.view.flashListHint?.(text || i18n(message), NOTICE_MS, HINT_ERROR);
  }

  // The App Bar stays the article's: locked while an operation runs; once
  // held, only refresh runs.
  toolbarContext() {
    if (this.running && !this.held) {
      return { ...EMPTY_TOOLBAR_CONTEXT, appBar: this.appBar || EMPTY_TOOLBAR_CONTEXT.appBar, locked: true };
    }
    if (!this.held) return null;
    return {
      ...EMPTY_TOOLBAR_CONTEXT, appBar: this.appBar || EMPTY_TOOLBAR_CONTEXT.appBar, refresh: true, locked: true
    };
  }

  // Pull-to-refresh: what PTT shows under the held article decides, by the
  // refresh's own reading of the screen. An article is reopened by the
  // article refresh, which restores the reading position; a list or the home
  // dashboard is presented as it is, and so is an article the refresh cannot
  // name. A screen neither can read keeps the hold: no key is guessed. Returns
  // true when the hold was released.
  retry() {
    if (!this.held) return false;
    const core = this.core;
    const target = refreshTargetOf(core) || articleShown(core);
    // A failed recovery (aid_navigation._recover) runs again from wherever PTT is.
    if (!target && core.aidNavigation?.retryRecovery?.()) return true;
    if (!target) {
      reportBug(core, 'articleHold', 'unknownScreen', { pageState: core.buf?.pageState ?? null });
      core.view.flashListHint?.(i18n('articleHold_unknownScreen'), NOTICE_MS, HINT_ERROR);
      return false;
    }
    this._release();
    if (target.kind === 'article' && core.aidNavigation?.refresh()) return true;
    core.easyReading?.settleFunctionMode();
    if (target.kind === 'article-shown') {
      this._repaint();
      return true;
    }
    // Held over an article in easy reading (a resize), the list session could
    // not take part; easy reading has left the article now, so it can.
    if (target.kind === 'article-list' && core.listSession?.state === 'idle') {
      core.listSession.beginExternalNavigation({ fromIdle: true });
    }
    recordFor(core).releaseExternal({ landed: true });
    return true;
  }

  // PTT is back on the article a failed operation left (aid_navigation._recover):
  // the cover lifts and the article is easy reading's own again.
  recovered() {
    if (!this.held) return;
    this._release();
  }

  // A repaint settles the screen, which reads the article's identity again
  // (headerless_reopen). One PTT never answers holds the article again.
  _repaint() {
    this.core.commandQueue.enqueue({
      keys: '\f',
      kind: 'article-retry',
      expect: () => true,
      onFail: reason => this.hold({ source: 'articleHold', reason: `repaint: ${reason || 'timeout'}`, message: 'articleHold_retryTimeout' })
    });
  }

  // Disconnection: an operation still running goes on without the hold.
  reset() {
    this._clearLanding();
    const running = this.running;
    this.running = null;
    if (this.held) this._release();
    else if (running) this._released();
  }

  _release() {
    this.held = false;
    this.cover?.destroy();
    this.cover = null;
    this.appBar = null;
    this.core._refreshScreenContext?.();
    this.core.view.navigationEnded?.();
  }
}
