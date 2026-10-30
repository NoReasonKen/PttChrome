// An article without a header (#77) has no time on screen, and no identity
// when no list row came with it: a key PTT answers directly (same-thread keys
// in range, same-author keys) or an open from the native list. Both are read
// out of sight: Q shows the post's AID, which carries its post time
// (aid_codec.aidPostTime), and leaves for the list with the cursor on the
// article; its row is read there and the article opened again with both
// (term_view.adoptListRowContext), back at the reader's row. An AID line on
// the page itself (aid_navigation.findLocalPostAid) gives the time with no
// round trip. Only after a screen on a board or with the row's board, so a
// notice after login never takes a list row; each article is tried once.
import { HiddenArticleRoute } from './hidden_article_route';
import { articleContextFromListRow } from './comment_parse';
import { aidPostTime } from './aid_codec';
import { parseBoardName } from './screen_titles';
import { isBoardArticleList } from './search_results_screen';
import { serializedOpHint } from './serialized_op_gate';
import { recordFor } from './reading_record';

// The only key that closes the post info box (aid_navigation.queryPostAid).
const DISMISS = ' ';

// One settled screen. `state`: { board, tried }, the board the screens before
// were on and the article last tried. `screen`:
//   pageState, top:    the top rows of the article's first page when it has no
//                      header (term_view._headerlessTop), or null;
//   complete:          the article on screen has an identity and a time;
//   articleBoard:      its board; listBoard: the article list's board;
//   ready:             nothing else runs and easy reading shows the article.
// Returns the next state and whether to start.
export function reopenStep(state, { pageState, top, complete, articleBoard, listBoard, ready }) {
  if (pageState === 3 && top != null && !complete) {
    const start = ready && !!(state.board || articleBoard) && top !== state.tried;
    return { board: state.board, tried: start ? top : state.tried, start };
  }
  const board = pageState === 3 ? articleBoard : pageState === 2 ? listBoard : null;
  return { board: board || null, tried: null, start: false };
}

export class HeaderlessReopen extends HiddenArticleRoute {
  constructor(core) {
    super(core, { name: 'headerlessReopen', kind: 'headerless-reopen', failed: 'headerlessReopen_failed' });
    this.state = { board: null, tried: null };
    this.bookmark = null;
    core.buf.addEventListener('screenSettled', () => this._settled());
  }

  _settled() {
    const core = this.core;
    const buf = core.buf;
    const view = core.view;
    if (this.active || buf.easyReadingResizeInFlight || core.listResize?.active) return;
    const top = buf.pageState === 3 ? view._headerlessTop : null;
    if (top != null && view._articleTitle != null && view._articleTime == null) {
      const local = core.aidNavigation?.findLocalPostAid?.();
      if (local) view.adoptArticleTime(aidPostTime(local.aid));
    }
    const step = reopenStep(this.state, {
      pageState: buf.pageState,
      top,
      complete: view._articleTitle != null && view._articleTime != null,
      articleBoard: view._articleBoard,
      listBoard: parseBoardName(buf.getRowText(0)),
      ready: !!buf.startedEasyReading && !buf.easyReadingFunctionMode && !!core.conn?.isConnected &&
        !!core.commandQueue?.idle && !serializedOpHint(core)
    });
    const board = this.state.board || view._articleBoard;
    this.state = { board: step.board, tried: step.tried };
    if (step.start) this._start(board);
  }

  _start(board) {
    const core = this.core;
    // Before the hold: easy reading's function mode freezes the reader's row.
    this.bookmark = recordFor(core).begin('headerless-reopen', { view: core.view, buf: core.buf });
    this._begin(core._screenContext?.appBar || null);
    this._hold();
    core.aidNavigation.queryPostAid({
      kind: 'headerless-reopen-info',
      onFlushed: () => this._fail(),
      onFail: () => this._fail(),
      onDone: info => this._enqueue({
        keys: DISMISS,
        kind: 'headerless-reopen-list',
        // The board's list gives the row; any other list (a gem list) still
        // opens the article again, without an identity.
        expect: (snapshot, facts) => {
          if (isBoardArticleList(facts, board) && facts.curY >= 3 && facts.curY < facts.rows - 1)
            return { row: articleContextFromListRow(facts.rowTexts[facts.curY], parseBoardName(facts.rowTexts[0]) || board) };
          return facts.kind === 'clean-list' && { row: null };
        },
        onDone: ({ row }) => this._open('\r', row && { ...row, time: aidPostTime(info?.aid) })
      })
    });
  }

  _landed() {
    recordFor(this.core).end(this.bookmark, 'done', { only: 'article' });
    this.bookmark = null;
  }

  _fail() {
    const bookmark = this.active ? this.bookmark : null;
    super._fail();
    if (bookmark) recordFor(this.core).end(bookmark, 'fail', { only: 'article' });
    this.bookmark = null;
  }
}
