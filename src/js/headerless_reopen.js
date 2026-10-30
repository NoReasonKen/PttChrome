// An article without a header reached with no known source (#77): a key PTT
// answers directly (same-thread keys in range, same-author keys) or an open
// from the native list. PTT keeps the list cursor on the article being read,
// so its list row is read out of sight: back to the list, then the article
// opened again with that row as its identity (term_view.adoptListRowContext).
// Only after a screen on a board, so a notice after login never takes a list
// row; each first page is tried once.
import { HiddenArticleRoute } from './hidden_article_route';
import { articleContextFromListRow } from './comment_parse';
import { parseBoardName } from './screen_titles';
import { isBoardArticleList } from './search_results_screen';
import { serializedOpHint } from './serialized_op_gate';

const LIST_BACK = '\x1b[D';

// One settled screen. `state`: { board, tried }, the board the screens before
// were on and the top rows of the first page last tried. `screen`:
//   pageState, top:    the top rows of a first page without a header, or null;
//   identified:        the article on screen has an identity;
//   articleBoard:      its board; listBoard: the article list's board;
//   ready:             nothing else runs and easy reading shows the article.
// Returns the next state and whether to start.
export function reopenStep(state, { pageState, top, identified, articleBoard, listBoard, ready }) {
  if (pageState === 3 && top != null && !identified) {
    const start = ready && !!state.board && top !== state.tried;
    return { board: state.board, tried: start ? top : state.tried, start };
  }
  const board = pageState === 3 ? articleBoard : pageState === 2 ? listBoard : null;
  return { board: board || null, tried: null, start: false };
}

export class HeaderlessReopen extends HiddenArticleRoute {
  constructor(core) {
    super(core, { name: 'headerlessReopen', kind: 'headerless-reopen', failed: 'headerlessReopen_failed' });
    this.state = { board: null, tried: null };
    core.buf.addEventListener('screenSettled', () => this._settled());
  }

  _settled() {
    const core = this.core;
    const buf = core.buf;
    const view = core.view;
    if (this.active || buf.easyReadingResizeInFlight || core.listResize?.active) return;
    const screen = buf.pageState === 3 ? view._screenArticleContext() : null;
    const step = reopenStep(this.state, {
      pageState: buf.pageState,
      top: screen && !screen.author ? view._screenTopKey() : null,
      identified: view._articleTitle != null,
      articleBoard: view._articleBoard,
      listBoard: parseBoardName(buf.getRowText(0)),
      ready: !!buf.startedEasyReading && !buf.easyReadingFunctionMode && !!core.conn?.isConnected &&
        !!core.commandQueue?.idle && !serializedOpHint(core)
    });
    const board = this.state.board;
    this.state = { board: step.board, tried: step.tried };
    if (step.start) this._start(board);
  }

  _start(board) {
    this._begin(null);
    this._hold();
    this._enqueue({
      keys: LIST_BACK,
      kind: 'headerless-reopen-list',
      // The board's list gives the row; any other list (a gem list) still
      // opens the article again, without an identity.
      expect: (snapshot, facts) => {
        if (isBoardArticleList(facts, board) && facts.curY >= 3 && facts.curY < facts.rows - 1)
          return { row: articleContextFromListRow(facts.rowTexts[facts.curY], parseBoardName(facts.rowTexts[0]) || board) };
        return facts.kind === 'clean-list' && { row: null };
      },
      onDone: ({ row }) => this._open('\r', row)
    });
  }
}
