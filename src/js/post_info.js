// Article information (#261): `Q` on the easy-reading article list and in an
// easy-reading article, and 文章資訊 in the context menu and the article's More
// sheet. PTT's own `Q` (mbbsd/bbs.c#view_postinfo) draws a box with the
// article's code (AID), its web address and its price, and waits for a key;
// the app reads that box and shows it as its own sheet (mobile) or dialog
// (desktop), from which the code and the address can be copied.
//
// The box is never shown: PTT's screens are held under the list or the article
// while the sequence runs, each key going out only after PTT answered the one
// before (docs/pttbbs-screen-protocol.md §8.2):
//   over the list     cursor to the selection, `Q` ⇒ the box, ` ` ⇒ the list
//                     (ListSession.beginPostInfo; the list takes its frame back
//                     with its rows and selection, resumeAfterHelp)
//   over an article   `Q` ⇒ the box over the list (read_post leaves the pager),
//                     ` ` ⇒ the list, Enter ⇒ the article, at the reader's row
//                     (aid_navigation.reopenAfterPostInfo, the article held by
//                     ArticleHold meanwhile, under a copy of itself until the
//                     reading position is restored: run's opts.cover)
// The sheet opens as soon as the box is read; PTT is dismissed under it, so
// closing the sheet sends nothing. Only PTT knows the price, so the box is
// always asked for, also when the article's own 「※ 文章網址」 line would give
// the code (aid_navigation.findLocalPostAid). An article without a code (a bare
// frame line) has no information: a hint says so and no sheet opens.
// A failure stays on the page with a hint; over an article the article is held
// (ArticleHold.fail) and pull-to-refresh retries.
import { i18n } from './i18n';
import { HINT_ERROR } from './status_hint';
import { recordFor } from './reading_record';
import { serializedOpHint } from './serialized_op_gate';
import { articlePresented } from './article_hold';
import { postInfoQueryStep } from './aid_navigation';

const SOURCE = 'postInfo';
const HINT_MS = 3000;
// The only key that closes the box (never `Q`, which toggles PTT's price list).
const KEY_DISMISS = ' ';

export class PostInfo {
  constructor(core) {
    this.core = core;
    // idle → list (the sequence over the list) | article (over an article)
    this.phase = 'idle';
    this._bookmark = null;
    this._offBack = null;
  }

  // The wire belongs to the sequence (serializedOpHint).
  get busy() {
    return this.phase !== 'idle';
  }

  // term_view holds PTT's frames under the list until it is back
  // (_navigationHeld); over an article ArticleHold holds them.
  get holding() {
    return this.phase === 'list';
  }

  // Whether the information can be asked for over the list now: list easy
  // reading presents an article list (not the mailbox, not the user list) and
  // is idle, and nothing else runs on the wire. The predicate of every list
  // entrance (Q, the context menu).
  listAvailable() {
    const core = this.core;
    const ls = core && core.listSession;
    if (this.phase !== 'idle' || !ls || !ls.selectedPostInfoTarget) return false;
    if (ls.isUserList() || ls.isMailList()) return false;
    if (ls.state !== 'active' || !core.buf || core.buf.listRenderMode !== 'buffer') return false;
    if (typeof core.activeListSession === 'function' && core.activeListSession() !== ls) return false;
    return !serializedOpHint(core);
  }

  // Whether it can be asked for over the article on screen: easy reading
  // presents an article opened from a board's article list (a mail has no
  // information, and other pagers do not take `Q`), and nothing else runs.
  // The predicate of every article entrance (Q, the context menu, More).
  articleAvailable() {
    const core = this.core;
    const ls = core && core.listSession;
    const nav = core && core.aidNavigation;
    if (this.phase !== 'idle' || !nav || nav.active || core.connectState !== 1) return false;
    if (!ls || ls.state !== 'suspended' || ls.isMailList() || ls.isUserList()) return false;
    if (!articlePresented(core) || !core.articleHold || core.articleHold.running) return false;
    return !serializedOpHint(core);
  }

  _hint(text, level) {
    this.core.view?.flashListHint?.(text, HINT_MS, level);
  }

  _refused(text) {
    this._hint(text, HINT_ERROR);
    return false;
  }

  // The information of the selected article on the list; `target`
  // (ListSession.postInfoTargetAtRow's, the context menu's row) selects that
  // article first. Returns whether `Q` was sent; when not, a hint says why.
  fromList(target) {
    const core = this.core;
    const ls = core && core.listSession;
    const busy = serializedOpHint(core);
    if (busy) return this._refused(busy);
    if (!this.listAvailable()) return this._refused(i18n('postInfo_unavailable'));
    if (target && !ls.selectPostInfoTarget(target)) return this._refused(i18n('postInfo_gone'));
    if (!ls.selectedPostInfoTarget()) return this._refused(i18n('postInfo_gone'));
    this.phase = 'list';
    this._bookmark = recordFor(core).begin('post-info');
    // The system Back during the sequence counts for nothing else.
    this._offBack = core.registerSheetDismiss
      ? core.registerSheetDismiss(() => this._hint(i18n('postInfo_busy')))
      : null;
    // Terminal keys and taps stop until the list is back.
    core.setModalOpen?.(SOURCE, true);
    core._refreshScreenContext?.();
    ls.beginPostInfo([
      {
        ...postInfoQueryStep({ wholeBox: true }),
        kind: 'post-info',
        onDone: (answer) => this._listAnswered(answer.box),
        onFail: () => this._backOnList('fail', i18n('postInfo_failed'), HINT_ERROR)
      }
    ], () => this.reset());
    return true;
  }

  // PTT shows the box (or its pressanykey): the information is shown, and the
  // box dismissed under it.
  _listAnswered(box) {
    if (this.phase !== 'list') return;
    const ls = this.core.listSession;
    const { timeoutMs, probeTimeoutMs, hardTimeoutMs } = postInfoQueryStep();
    const sent = ls.continueUserQuery({
      keys: KEY_DISMISS,
      kind: 'post-info-dismiss',
      timeoutMs,
      probeTimeoutMs,
      hardTimeoutMs,
      expect: () => ls.showsHeldList(),
      onDone: () => queueMicrotask(() => this._backOnList('done')),
      onFail: () => this._backOnList('fail', i18n('postInfo_failed'), HINT_ERROR)
    });
    if (!sent) return void this._backOnList('fail', i18n('postInfo_failed'), HINT_ERROR);
    this._present(box);
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

  // The information of the article on screen. Returns whether `Q` was sent;
  // when not, a hint says why.
  fromArticle() {
    const core = this.core;
    const busy = serializedOpHint(core);
    if (busy) return this._refused(busy);
    if (!this.articleAvailable()) return this._refused(i18n('postInfo_unavailable'));
    const nav = core.aidNavigation;
    const hold = core.articleHold;
    // The reader's row, frozen when easy reading enters its native mirror.
    const bm = recordFor(core).begin('post-info', { view: core.view, buf: core.buf });
    const lineIndex = bm.article && bm.article.lineIndex != null ? bm.article.lineIndex
      : core.view?.currentLineIndex?.() ?? null;
    // The article is read again from its top: it stays covered at the
    // reader's line until the position is restored.
    if (!hold.run(SOURCE, { cover: true })) return this._refused(i18n('postInfo_unavailable'));
    this.phase = 'article';
    core.easyReading?._enterFunctionMode?.();
    core._refreshScreenContext?.();
    const failed = (reason) => {
      if (this.phase !== 'article') return;
      this.phase = 'idle';
      if (!hold.fail(SOURCE, { reason, message: 'postInfo_failedArticle' }))
        this._hint(i18n('postInfo_failed'), HINT_ERROR);
      core._refreshScreenContext?.();
    };
    nav.queryPostAid({
      kind: 'post-info',
      box: true,
      onFlushed: () => failed('post-info: flushed'),
      onFail: (reason) => failed('post-info: ' + (reason || 'timeout')),
      onDone: (info, box) => {
        nav.reopenAfterPostInfo(lineIndex, {
          onDone: () => {
            if (this.phase !== 'article') return;
            this.phase = 'idle';
            hold.done(SOURCE);
            core._refreshScreenContext?.();
          },
          onFail: () => failed('post-info-reopen: timeout'),
          onFlushed: () => failed('post-info-reopen: flushed')
        });
        this._present(box);
      }
    });
    return true;
  }

  // The box read: its sheet, or the hint of an article without information.
  _present(box) {
    if (!box || !box.aid) return void this._hint(i18n('postInfo_none'));
    this.core.openPostInfo?.(box);
  }

  // The connection closed mid-sequence (App.onClose): PTT's screens and the
  // list are gone. Drop what the sequence holds, so the reconnect starts clean.
  reset() {
    if (this.phase === 'idle') return;
    const core = this.core;
    const bm = this._bookmark;
    const list = this.phase === 'list';
    this._release();
    if (list) recordFor(core).end(bm, 'fail', { only: 'list' });
    core.view?.navigationEnded?.();
    core._refreshScreenContext?.();
  }
}

function controller(core) {
  return core && core.postInfo;
}

// Q on the article list, and 文章資訊 in the context menu (its row's
// `target`). Returns true when `Q` was sent, false (with a hint) when not.
export function showListPostInfo(core, target) {
  const p = controller(core);
  return !!p && p.fromList(target);
}

// Q in an article, and 文章資訊 in its context menu and More sheet.
export function showArticlePostInfo(core) {
  const p = controller(core);
  return !!p && p.fromArticle();
}
