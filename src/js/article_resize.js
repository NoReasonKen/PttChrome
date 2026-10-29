import { parseStatusRow } from './string_util';
import { rowToText } from './comment_parse';
import { sameBoard } from './screen_titles';
import { ArticleResizeAnchor } from './article_resize_anchor';
import { coalesceResize, resizeDeadline, resizePhase } from './resize_transaction';
import { i18n } from './i18n';

const KIND = 'article-resize';
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

  _eligible(context = this.core.easyReading?.resizeContext()) {
    const { conn } = this.core;
    return !!(this.core.mobile && !this.core.articleGestures?.stack?.handingOff &&
      conn?.isConnected && context && this.core.commandQueue);
  }

  attach() { this.anchor.attach(() => this.capturePosition()); }
  capturePosition() { if (!this.active && this._eligible()) this.anchor.capture(); }
  afterLayout() { if (!this.active && !this.pending) this.anchor.finishLocal(); }

  request(cols, rows) {
    const { buf } = this.core;
    if (this.finishing) return true;
    if (this.active) {
      this.pending = coalesceResize(cols, rows, this.command);
      return true;
    }
    if (!this._eligible()) { this.pending = null; return false; }
    this.pending = coalesceResize(cols, rows, buf);
    if (!this.pending) return false;
    this.pump();
    return true;
  }

  // Retried after article accumulation, quiet/cursor-only settles, PageDown
  // recovery, and onWireIdle (queue or long-comment release). Each can satisfy
  // a different readiness guard without another resize event.
  pump() {
    if (this.active || this.finishing) return true;
    if (!this.pending) {
      if (this._eligible()) this.anchor.remember();
      return false;
    }
    const core = this.core;
    const { easyReading: er, buf } = core;
    const context = er?.resizeContext();
    if (!this._eligible(context)) { this.pending = null; return false; }
    if (this.pending.cols === buf.cols && this.pending.rows === buf.rows) {
      this.pending = null;
      return false;
    }
    if (!core.commandQueue.idle || !context.ready) return false;
    const command = this.command = {
      ...this.pending,
      line: context.line,
      board: context.board,
      header: header(buf.pageLines),
      position: this.anchor.take(),
      deadline: resizeDeadline(),
    };
    this.pending = null;
    er.yieldForResize();
    buf.easyReadingResizeInFlight = true;
    this._enqueue(command, 'leave');
    return true;
  }

  _enqueue(command, phase) {
    const core = this.core;
    const { buf, view } = core;
    command.phase = phase;
    core.commandQueue.enqueue({
      kind: KIND,
      keys: phase === 'leave' ? '\x1b[D' : phase === 'open' ? '\r' : `:${command.line}\r`,
      onSend: () => {
        if (phase !== 'leave') return;
        core._setTermSizeNow(command.cols, command.rows);
        core._applyMobileGeometry();
        view.redraw(true);
      },
      ...resizePhase(core, command, () => this.command === command, (snapshot, facts) => {
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
      }),
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
    core.easyReading.finishResize(outcome);
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
