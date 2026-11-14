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

// An article the refresh cannot name (one without a header has no board):
// easy reading presents it as PTT shows it, which reads its identity again.
function articleShown(core) {
  const facts = searchGateFacts(core);
  if (!facts || facts.inputField || core.buf.pageState !== 3) return null;
  const last = core.buf.getRowText(core.buf.rows - 1);
  return atPagerStatusRow(last) && parsePagerFooterContext(last) === 'reading' ? { kind: 'article-shown' } : null;
}

export class ArticleHold {
  constructor(core) {
    this.core = core;
    this.held = false;
    this.cover = null;
    this.appBar = null;
  }

  // `source`, `reason`: the bug event; `message`: the message key naming the
  // cause; `cover`: the copy of the article already on screen, or none to copy
  // the article shown now; `parked`: the caller already parked the sessions.
  hold({ source, reason, message, cover, appBar, parked = false }) {
    const core = this.core;
    reportBug(core, source, reason, {});
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
    core.view.flashListHint?.(i18n(message), NOTICE_MS, HINT_ERROR);
  }

  // The App Bar stays the article's; only refresh runs.
  toolbarContext() {
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

  // Disconnection.
  reset() {
    if (this.held) this._release();
  }

  _release() {
    this.held = false;
    this.cover?.destroy();
    this.cover = null;
    this.appBar = null;
    this.core._refreshScreenContext?.();
  }
}
