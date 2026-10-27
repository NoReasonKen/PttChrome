import { parseStatusRow, statusSignature } from './string_util';
import { rowToText } from './comment_parse';
import { sameBoard } from './screen_titles';
import { ArticleResizeAnchor } from './article_resize_anchor';
import { i18n } from './i18n';

const KIND = 'article-resize';
const DEADLINE_MS = 6000;
const header = lines => lines.slice(0, 3).map(row => rowToText(row).trimEnd()).join('\n');

// pmore fixes its last-page boundary at attachment. Reopen the verified same
// article after NAWS while retaining its rendered long page throughout.
export class ArticleResize {
  constructor(core) {
    this.core = core;
    this.pending = null;
    this.command = null;
    this.finishing = false;
    this.anchor = new ArticleResizeAnchor(core);
  }

  get active() { return !!this.command; }
  get articleRecord() { return this.command?.position.bookmark.article || null; }

  _eligible() {
    const { easyReading: er, buf, conn, view } = this.core;
    return !!(this.core.mobile && conn?.isConnected && er?._enabled && !er._functionMode &&
      buf?.pageLines?.length && view._articleBoard && this.core.commandQueue);
  }

  attach() { this.anchor.attach(() => this.capturePosition()); }
  capturePosition() { if (!this.active && this._eligible()) this.anchor.capture(); }
  afterLayout() { if (!this.active && !this.pending) this.anchor.finishLocal(); }

  request(cols, rows) {
    const { buf } = this.core;
    if (this.finishing) return true;
    if (this.active) {
      this.pending = cols === this.command.cols && rows === this.command.rows ? null : { cols, rows };
      return true;
    }
    if (!this._eligible()) { this.pending = null; return false; }
    if (cols === buf.cols && rows === buf.rows) { this.pending = null; return false; }
    this.pending = { cols, rows };
    this.pump();
    return true;
  }

  pump() {
    if (this.active || this.finishing) return true;
    if (!this.pending) {
      if (this._eligible()) this.anchor.remember();
      return false;
    }
    const core = this.core;
    const { easyReading: er, buf, view } = core;
    if (!this._eligible()) { this.pending = null; return false; }
    if (this.pending.cols === buf.cols && this.pending.rows === buf.rows) {
      this.pending = null;
      return false;
    }
    if (!core.commandQueue.idle || er._wireBusy() || er._reverse) return false;
    const status = parseStatusRow(buf.getRowText(buf.rows - 1, 0, buf.cols));
    const sig = status && statusSignature(status);
    if (!sig || buf.cur_x !== buf.cols - 1 || buf.cur_y !== buf.rows - 1 ||
        view._lastAccumulatedSig !== sig ||
        (er._inFlightSig != null && er._inFlightSig === sig)) return false;
    const command = this.command = {
      ...this.pending,
      line: Math.max(1, view._accEndRow || status.rowIndexEnd || 1),
      board: view._articleBoard,
      header: header(buf.pageLines),
      position: this.anchor.take(),
      deadline: performance.now() + DEADLINE_MS,
    };
    this.pending = null;
    er._clearWatchdog();
    er._inFlightSig = null;
    er._inFlightKeys = null;
    er._deferredPageDownKeys = null;
    er.sendCommandAfterUpdate = '';
    buf.easyReadingResizeInFlight = true;
    this._enqueue(command, 'leave');
    return true;
  }

  _enqueue(command, phase) {
    const core = this.core;
    const { buf, view } = core;
    const seenRows = new Set();
    const remaining = Math.max(1, command.deadline - performance.now());
    command.phase = phase;
    core.commandQueue.enqueue({
      kind: KIND,
      keys: phase === 'leave' ? '\x1b[D' : phase === 'open' ? '\r' : `:${command.line}\r`,
      probe: false,
      timeoutMs: remaining,
      hardTimeoutMs: remaining,
      onSend: () => {
        if (phase !== 'leave') return;
        core._setTermSizeNow(command.cols, command.rows);
        core._applyMobileGeometry();
        view.redraw(true);
      },
      expect: (snapshot, facts) => {
        for (const row of snapshot?.changedRows || []) {
          if (row >= 0 && row < command.rows) seenRows.add(row);
        }
        if (this.command !== command || buf.rows !== command.rows || buf.cols !== command.cols ||
            seenRows.size < command.rows) return false;
        if (phase === 'leave') {
          return facts?.kind === 'clean-list' && sameBoard(facts.boardName, command.board) &&
            facts.curY >= 3 && facts.curY < command.rows - 1;
        }
        if (buf.cur_y !== command.rows - 1 || buf.cur_x !== command.cols - 1) return false;
        const next = parseStatusRow(buf.getRowText(command.rows - 1, 0, command.cols));
        if (!next) return false;
        if (phase === 'open') {
          if (next.rowIndexStart !== 1) return false;
          const actual = [0, 1, 2].map(row => buf.getRowText(row, 0, buf.cols).trimEnd()).join('\n');
          return actual === command.header ? 'same' : 'different';
        }
        return next.rowsUnknown || (next.rowIndexStart <= command.line && next.rowIndexEnd >= command.line);
      },
      onDone: result => {
        if (this.command !== command) return;
        if (result === 'different') this._finish(command, 'fail');
        else if (phase === 'leave') this._enqueue(command, 'open');
        else if (phase === 'open') this._enqueue(command, 'seek');
        else this._finish(command, 'done');
      },
      onFail: () => this._finish(command, 'fail'),
      onFlushed: () => this._finish(command, 'cancel'),
    });
  }

  _finish(command, outcome) {
    if (this.command !== command) return;
    const core = this.core;
    this.finishing = true;
    this.command = null;
    core.buf.easyReadingResizeInFlight = false;
    if (outcome !== 'done') this.pending = null;
    if (outcome === 'done') {
      core.buf.prevPageState = 3;
      core.easyReading._forceRepaint();
    } else core.easyReading.exitEasyReading();
    this.anchor.finish(command.position, outcome);
    this.finishing = false;
    if (outcome === 'fail') core.view.flashListHint(i18n('articleResize_failed'));
    if (!this.pump()) core.easyReading.onWireIdle({ force: true });
  }

  cancel() {
    if (this.finishing) return;
    this.pending = null;
    this.finishing = true;
    this.command = null;
    this.core.buf.easyReadingResizeInFlight = false;
    this.core.commandQueue.flushKind(KIND);
    this.anchor.cancel();
    this.finishing = false;
  }
}
