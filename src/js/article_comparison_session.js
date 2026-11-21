import { ArticleComparison, nearbyPageRange } from './article_comparison';
import { reportBug } from './bug_event';
import { parseComment, rowToText } from './comment_parse';
import { i18n } from './i18n';
import { recordFor } from './reading_record';
import { followScrollRestore } from './scroll_restore_follow';
import { serializedOpHint } from './serialized_op_gate';
import { STACK_NOTICE_MS } from './stack_layer';
import { parseStatusRow, statusSignature } from './string_util';
import { internRow } from './term_char_intern';

const FORWARD = '\x1b[6~';
const KIND = 'article-comparison';
const TIMEOUT_MS = 2500;

function completePage(buf) {
  if (buf.pageState !== 3 || buf.cur_y !== buf.rows - 1 || buf.cur_x !== buf.cols - 1)
    return null;
  return parseStatusRow(buf.getRowText(buf.rows - 1));
}

// Retains the reading surface while checking PTT's copy. A background step
// owns just one CommandQueue request and never probes or retries it. A
// foreground command in the queue therefore runs before comparison resumes.
export class ArticleComparisonSession {
  constructor(core, content, range) {
    this.core = core;
    this.content = content;
    this.connection = core.conn;
    this.instance = core.view._articleInstanceId;
    this.article = core.easyReading._articleKey;
    this.comparison = new ArticleComparison(content.pageLines, range, content.whole);
    this.bookmark = recordFor(core).begin(KIND);
    this.deferred = [];
    this.adopted = false;
    this.cancelled = false;
    this.waitForWrites = null;
    this.requesting = false;
    this.scroll = () => this.movedWhileReading();
    this.noteScrollInput = () => { this.scrollInput = true; };
  }

  static start(core, content, anchor) {
    const index = content.pageIndex;
    const { rows, cols } = core.buf;
    const status = completePage(core.buf);
    if (index?.rows !== rows || index.cols !== cols || status?.rowIndexStart !== 1) return null;
    const range = nearbyPageRange(index.pages, anchor);
    if (!range) return null;
    const session = new ArticleComparisonSession(core, content, range);
    core.articleComparison = session;
    session.schedule();
    return session;
  }

  get nearReady() { return this.comparison.nearReady && !this.cancelled; }
  get sendingPage() { return this.core.commandQueue.inFlightKind === KIND; }
  get hidesFrames() {
    if (this.sendingPage) return true;
    const { core } = this;
    return !this.cancelled && this.current() && this.waitForWrites == null &&
      !core.buf.easyReadingFunctionMode && !core.commandQueue.inFlightKind && !serializedOpHint(core);
  }

  current() {
    const { core } = this;
    return this.connection === core.conn && this.connection?.isConnected &&
      this.article === core.easyReading._articleKey && this.instance === core.view._articleInstanceId;
  }

  schedule() {
    if (this.timer != null || this.cancelled || (!this.comparison.next && !this.deferred.length)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    });
  }

  pump() {
    const { core, comparison } = this;
    if (this.cancelled || !core.commandQueue.idle || this.waitForWrites != null ||
        serializedOpHint(core) || core.longPush?.busy || core.buf.easyReadingFunctionMode) return;
    if (this.deferred.length) {
      this.releaseSends(true);
      return;
    }
    if (!comparison.next || (!this.adopted && comparison.nearReady) ||
        (this.adopted && core.articleGestures?.holdsInput())) return;
    if (!this.current()) return this.cancel();
    const from = completePage(core.buf);
    if (!from || from.rowsUnknown) return this.finish('uncertain');
    const last = comparison.rows.previous;
    const realign = comparison.next.forward && last &&
      (from.rowIndexStart !== last.start || from.rowIndexEnd !== last.end);
    const seek = realign ? last.start : comparison.next.seek;
    if (seek === from.rowIndexStart) {
      this.accept(from);
      return;
    }
    if (seek == null && from.pagePercent >= 100) return this.finish('uncertain');
    const signature = statusSignature(from);
    this.requesting = true;
    try {
      core.commandQueue.enqueue({
        kind: KIND,
        keys: seek == null ? FORWARD : ':' + seek + '\r',
        probe: false,
        timeoutMs: TIMEOUT_MS,
        hardTimeoutMs: TIMEOUT_MS,
        expect: () => {
          const status = completePage(core.buf);
          return status && statusSignature(status) !== signature ? status : false;
        },
        onDone: status => {
          if (realign && !this.cancelled) {
            if (status.rowIndexStart === last.start && status.rowIndexEnd === last.end &&
                last.texts.every((text, i) => text === rowToText(core.buf.lines[i]).replace(/\s+$/, '')))
              this.schedule();
            else this.finish('uncertain');
          } else if (!this.cancelled) this.accept(status);
          this.releaseSends(true);
          if (this.abandonAfterPage) this.cancel();
        },
        onFail: () => {
          this.finish('uncertain');
          this.releaseSends(false);
        },
        onFlushed: () => this.cancel()
      });
    } finally {
      this.requesting = false;
    }
  }

  accept(status) {
    const { core, comparison } = this;
    comparison.accept({
      start: status.rowIndexStart, end: status.rowIndexEnd,
      rows: core.buf.lines.slice(0, -1).map(internRow), atEnd: status.pagePercent >= 100
    });
    if (comparison.outcome) this.finish(comparison.outcome);
    else this.schedule();
  }

  // Raw terminal sends share the same one-response yield as queued work.
  // A callback is retained only for the duration of the already-sent page.
  beforeSend(send) {
    if (this.requesting || this.cancelled) return false;
    if (this.afterPage(send)) return true;
    this.awaitForeground();
    return false;
  }

  afterPage(run) {
    if (!this.sendingPage || this.cancelled) return false;
    this.deferred.push(run);
    return true;
  }

  awaitForeground() {
    clearTimeout(this.foregroundTimer);
    this.waitForWrites = this.core.buf.serverWrites;
    this.foregroundTimer = setTimeout(() => this.cancel(), TIMEOUT_MS);
  }

  releaseSends(verified) {
    if (!this.deferred.length) return;
    if (!verified) {
      this.deferred.length = 0;
      this.core.view.flashListHint?.(i18n('stack_actionNotRun'), STACK_NOTICE_MS);
      return;
    }
    if (!this.core.commandQueue.idle || this.waitForWrites != null) return;
    if (this.connection !== this.core.conn || !this.connection.isConnected) return;
    this.deferred.shift()();
    this.schedule();
  }

  settled() {
    if (this.sendingPage) return;
    if (this.core.longPush?.busy) {
      this.interruptedByComment = true;
      return;
    }
    if (this.interruptedByComment && this.core.buf.pageState === 3 &&
        this.article === this.core.easyReading._articleKey) {
      this.interruptedByComment = false;
      this.instance = this.core.view._articleInstanceId;
    }
    if (!this.current() || [1, 2].includes(this.core.buf.settledPageState)) {
      this.cancel();
      return;
    }
    if (this.waitForWrites != null && this.core.buf.settleSnapshot?.serverWrites > this.waitForWrites) {
      this.waitForWrites = null;
      clearTimeout(this.foregroundTimer);
    }
    this.follow?.update();
    this.schedule();
  }

  adopt() {
    const { core, content } = this;
    this.adopted = true;
    core.buf.pageLines = content.pageLines;
    core.view.restoreAccumulation(content);
    core.view._setArticleContext(content.context);
    core.easyReading._articleKey = this.article = content.pageKey;
    core.easyReading.easyReadingReachedPageEnd = content.whole;
    if (content.marks) core.newComments?.restore(content.marks);
    core.view.renderArticleRows(content.pageLines);
    core.nextArticle?.presentArticle();
    setTimeout(() => {
      if (!this.current() || this.cancelled) return;
      this.lastScrollTop = core.view.mainDisplay.scrollTop;
      core.view.mainDisplay.addEventListener('scroll', this.scroll, { passive: true });
      for (const type of ['pointerdown', 'wheel', 'touchmove'])
        core.view.mainDisplay.addEventListener(type, this.noteScrollInput, { passive: true });
    });
    if (this.comparison.outcome) this.presentOutcome();
    else this.schedule();
  }

  followPosition(anchor) {
    if (!anchor) return;
    const { view } = this.core;
    const line = Number(anchor.srow);
    this.follow = followScrollRestore({
      scroller: view.mainDisplay,
      content: view.mainContainer,
      target: () => view.mainContainer?.querySelector(`[type="bbsrow"][srow="${line}"]`),
      measure: () => {
        const top = view.pageRowTop(line);
        return top == null ? null : top - anchor.offset;
      },
      isCurrent: () => this.current() && !this.cancelled &&
        (this.sendingPage || this.core.buf.pageState === 3)
    });
  }

  finish(outcome) {
    if (outcome === 'uncertain') reportBug(this.core, KIND, 'unverifiedFrame', {});
    this.comparison.finish(outcome);
    if (this.bookmark) {
      recordFor(this.core).end(this.bookmark, outcome === 'match' ? 'done' : 'fail');
      this.bookmark = null;
    }
    if (this.adopted) this.presentOutcome();
  }

  presentOutcome() {
    const { comparison } = this;
    if (comparison.outcome !== 'match') {
      this.core.view.flashListHint?.(i18n(comparison.outcome === 'mismatch'
        ? 'stack_articleUpdated' : 'stack_articleComparisonUnverified'), STACK_NOTICE_MS);
      return;
    }
    const added = comparison.extra;
    if (this.content.whole && added.some(row => !parseComment(rowToText(row)))) {
      this.finish('mismatch');
      return;
    }
    if (this.content.whole || this.continuationRequested) this.showExtra();
  }

  movedWhileReading() {
    if (this.content.whole || !this.current()) return;
    const { mainDisplay, chh } = this.core.view;
    const advanced = mainDisplay.scrollTop > this.lastScrollTop;
    this.lastScrollTop = mainDisplay.scrollTop;
    if (this.scrollInput && advanced && mainDisplay.scrollTop + mainDisplay.clientHeight >= mainDisplay.scrollHeight - chh) {
      this.requestContinuation();
    }
  }

  requestContinuation() {
    if (!this.adopted || !this.current()) return false;
    if (!this.content.whole) {
      this.continuationRequested = true;
      if (this.comparison.outcome === 'match') this.showExtra();
    }
    return true;
  }

  showExtra() {
    const { core, content, comparison } = this;
    if (!comparison.extra.length || !this.current()) return;
    const kept = comparison.rows.shownEnd;
    const lines = content.pageLines.slice(0, kept).concat(comparison.extra.splice(0));
    core.buf.pageLines = lines;
    core.easyReading.easyReadingReachedPageEnd = true;
    if (content.whole) core.newComments?.appended(lines, kept);
    else core.newComments?.readToEnd(lines);
    core.view.renderArticleRows(lines);
    core.nextArticle?.presentArticle();
  }

  abandon() {
    if (this.sendingPage) this.abandonAfterPage = true;
    else this.cancel();
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    clearTimeout(this.timer);
    clearTimeout(this.foregroundTimer);
    this.follow?.release();
    this.core.view.mainDisplay?.removeEventListener('scroll', this.scroll);
    for (const type of ['pointerdown', 'wheel', 'touchmove'])
      this.core.view.mainDisplay?.removeEventListener(type, this.noteScrollInput);
    if (this.bookmark) recordFor(this.core).end(this.bookmark, 'cancel');
    if (!this.sendingPage) this.releaseSends(false);
    if (this.core.articleComparison === this) this.core.articleComparison = null;
  }
}
