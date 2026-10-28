import { isSearchPromptFrame } from './article_search';
import { listModeOf } from './list_session';
import { recordFor } from './reading_record';
import { sameBoard } from './screen_titles';
import { serializedOpHint } from './serialized_op_gate';
import { i18n } from './i18n';

const KIND = 'list-resize';
const DEADLINE_MS = 6000;

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
    const s = this.core.listSession;
    return s?.state === 'opening' || s?._renderMode === 'frozen' ||
      !!this.core.articleGestures?.stack?.handingOff;
  }

  _eligible() {
    const s = this.core.listSession;
    return this._available() && s.state === 'active' && s._renderMode === 'buffer' &&
      s._engageEligible() && !!s._boardName && !!this.core.buf.listLines?.length;
  }

  request(cols, rows) {
    if (this.finishing) return true;
    if (this.active) {
      this.pending = cols === this.command.cols && rows === this.command.rows ? null : { cols, rows };
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
    const bookmark = recordFor(core).begin(KIND, { list: s.readingPosition(), listOwner: s });
    const command = this.command = {
      ...this.pending, bookmark,
      board: s._boardName,
      mode: s._selectMode ? 'select' : 'plain',
      deadline: performance.now() + DEADLINE_MS,
    };
    this.pending = null;
    s._freezeForTransaction();
    // Reuse the list owner's absolute frozen-render backstop. Owned settles
    // must not extend this total budget across the two command phases.
    s._frozenStepBudgetMs = DEADLINE_MS;
    s._armFrozenWatchdog();
    this._enqueue(command, 'prompt');
    return true;
  }

  _enqueue(command, phase) {
    const core = this.core;
    const seen = new Set();
    const remaining = Math.max(1, command.deadline - performance.now());
    command.phase = phase;
    core.commandQueue.enqueue({
      kind: KIND,
      keys: phase === 'prompt' ? 's' : '\x03',
      fullRepaint: true,
      probe: false,
      timeoutMs: remaining,
      hardTimeoutMs: remaining,
      onSend: () => {
        if (phase !== 'prompt') return;
        core._setTermSizeNow(command.cols, command.rows);
        core._applyMobileGeometry();
      },
      expect: (snapshot, facts) => {
        for (const row of snapshot?.changedRows || []) {
          if (row >= 0 && row < command.rows) seen.add(row);
        }
        if (this.command !== command || core.buf.cols !== command.cols ||
            core.buf.rows !== command.rows || seen.size < command.rows) return false;
        if (phase === 'prompt') return isSearchPromptFrame('board', facts || {});
        return facts?.kind === 'clean-list' && sameBoard(facts.boardName, command.board) &&
          listModeOf(facts) === command.mode ? facts : false;
      },
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
    if (s._frozenWatchdog) clearTimeout(s._frozenWatchdog);
    s._frozenWatchdog = null;
    s._frozenStepBudgetMs = 0;
    if (outcome === 'done') s._resumeAfterResize(facts);
    else {
      this.pending = null;
      if (s._renderMode === 'frozen' && s.state !== 'idle' && s.state !== 'suspended') {
        s.state = 'functionMode';
        if (outcome === 'fail') s._degradeToNative(i18n('listResize_failed'), { preserveQueue: true });
        else s._enterFunctionMode(null, { preserveQueue: true });
      }
    }
    // A foreign queued command can start here and must see the released screen.
    core.commandQueue.flushKind(KIND);
    recordFor(core).end(command.bookmark, outcome);
    if (outcome === 'done') s._presented?.();
    this.finishing = false;
    if (!this.pump()) s._maybeFill();
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
