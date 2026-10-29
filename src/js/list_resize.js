import { isSearchPromptFrame } from './article_search';
import { listModeOf } from './list_session';
import { recordFor } from './reading_record';
import { sameBoard } from './screen_titles';
import { serializedOpHint } from './serialized_op_gate';
import { RESIZE_TIMEOUT_MS, resizeDeadline, coalesceResize, resizePhase } from './resize_transaction';

const KIND = 'list-resize';

// Canceling CompleteBoard returns FULLUPDATE without entering another board
// or changing the current list's search predicates.
export class ListResize {
  constructor(core) {
    this.core = core;
    this.pending = null;
    this.command = null;
    this.finishing = false;
  }

  get active() { return !!this.command; }
  get listRecord() { return this.command?.bookmark.list || null; }

  _available() {
    return !!(this.core.mobile && this.core.conn?.isConnected &&
      this.core.listSession && this.core.commandQueue);
  }

  _waitingForNavigation() {
    return !!this.core.listSession?.waitingToResize();
  }

  _eligible() {
    return this._available() && !!this.core.listSession.resizeContext();
  }

  request(cols, rows) {
    if (this.finishing) return true;
    if (this.active) {
      this.pending = coalesceResize(cols, rows, this.command);
      return true;
    }
    const buf = this.core.buf;
    if (!this._available() || (!this._eligible() && !this._waitingForNavigation())) {
      this.pending = null;
      return false;
    }
    if (cols === buf.cols && rows === buf.rows) { this.pending = null; return false; }
    this.pending = { cols, rows };
    this.pump();
    return true;
  }

  // request starts immediately when safe. Settled list replies and queue idle
  // retry after background loading; NavigationStack._end retries after Back
  // has aligned its revealed page. Completion handles coalesced dimensions.
  pump() {
    if (this.active || this.finishing) return true;
    if (!this.pending) return false;
    const core = this.core;
    // Back must present and align its real page before a resize may borrow
    // the terminal. Otherwise the prompt looks like an unexpected Back reply.
    if (core.articleGestures?.stack?.handingOff) return false;
    const s = core.listSession;
    if (!this._available() || core.articleResize?.active || core.articleResize?.pending) {
      this.pending = null;
      return false;
    }
    if (this.pending.cols === core.buf.cols && this.pending.rows === core.buf.rows) {
      this.pending = null;
      return false;
    }
    if (!this._eligible()) {
      if (this._waitingForNavigation()) return false;
      const size = this.pending;
      this.pending = null;
      // A foreground navigation may have opened an article or a native screen.
      core.setTermSize(size.cols, size.rows);
      return false;
    }
    if (!core.commandQueue.idle || serializedOpHint(core)) return false;
    const context = s.resizeContext();
    const bookmark = recordFor(core).begin(KIND, { list: s.readingPosition(), listOwner: s });
    const command = this.command = {
      ...this.pending, bookmark,
      ...context,
      deadline: resizeDeadline(),
    };
    this.pending = null;
    s.beginResize(RESIZE_TIMEOUT_MS);
    this._enqueue(command, 'prompt');
    return true;
  }

  _enqueue(command, phase) {
    const core = this.core;
    command.phase = phase;
    core.commandQueue.enqueue({
      kind: KIND,
      keys: phase === 'prompt' ? 's' : '\x03',
      onSend: () => {
        if (phase !== 'prompt') return;
        core._setTermSizeNow(command.cols, command.rows);
        core._applyMobileGeometry();
      },
      ...resizePhase(core, command, () => this.command === command, (_snapshot, facts) => {
        if (phase === 'prompt') return isSearchPromptFrame('board', facts || {});
        return facts?.kind === 'clean-list' && sameBoard(facts.boardName, command.board) &&
          listModeOf(facts) === command.mode ? facts : false;
      }),
      onDone: result => {
        if (this.command !== command) return;
        if (phase === 'prompt') this._enqueue(command, 'redraw');
        else this._finish(command, 'done', result);
      },
      onFail: () => this._finish(command, 'fail'),
      onFlushed: () => this._finish(command, 'cancel'),
    });
  }

  _finish(command, outcome, facts) {
    if (this.command !== command || this.finishing) return;
    const core = this.core;
    const s = core.listSession;
    this.finishing = true;
    this.command = null;
    if (outcome !== 'done') this.pending = null;
    s.endResize(outcome, facts, {
      bookmark: command.bookmark,
      continueResizing: () => {
        this.finishing = false;
        return this.pump();
      },
    });
  }

  fail() {
    if (this.command) this._finish(this.command, 'fail');
  }

  cancel() {
    if (this.finishing) return;
    this.pending = null;
    if (this.command) this._finish(this.command, 'cancel');
  }
}
