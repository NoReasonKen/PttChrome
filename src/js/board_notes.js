// The board entry screen (#292): `b` on the easy-reading article list, 進板畫面
// in the desktop context menu and in the mobile toolbar's More.
//
// PTT's `b` (bbs.c#b_notes) shows the board's entry screen with
// more(notes, NA) (pmore with PMORE_AUTO_EXIT) and waits for a key
// (docs/pttbbs-screen-protocol.md, "The board entry screen"):
//   a plain screen     its first page, then pressanykey 「請按任意鍵繼續」
//   a long one         pmore with no footer prompt; it leaves at its end, then
//                      pressanykey
//   a movie            plays at once (「動畫播放中… 可按 q, Ctrl-C 或其它任意鍵
//                      停止」, 「互動式動畫播放中…」, paused 「暫停播放動畫…」);
//                      a key stops a plain movie, an interactive one takes keys
//                      as its choices but q and Ctrl-C always stop it; when it
//                      ends PTT waits in pressanykey
//   none               「本看板尚無進板畫面。」 at (4,20), then pressanykey
// After that key PTT draws the article list again.
//
// Easy reading presents it on the page of PTT's own screen (screen_page.js,
// shared with the article's animation, #300) over the list, as the user query
// page (user_query.js) does: the list stays on screen under it, held, and
// shows at once when the page leaves (LIST_UNDER). Leaving sends what PTT
// waits for, each key only after PTT answered the one before: q while a movie
// plays (board_note_skip.boardNoteDecision, shared with the skip on board
// entry), ← out of a long screen, then one space for pressanykey, until PTT
// draws the list; the list takes its frame back with its rows and selection
// (ListSession.resumeAfterHelp). When a movie ends the page stays on its last
// frame until the reader leaves.
//
// pmore answers a key that stops a plain movie with READ_NEXT, and Read()
// then draws the list without pressanykey (pmore.c, see the protocol doc). When
// PTT draws the list while the page shows, the page keeps its last frame, the
// list takes its frame back under it at once, and leaving only closes the page
// (phase `ended`).
//
// A failure is said with a hint and holds the page: PTT's screen is never left
// to a guess. `b` asked for while another operation runs is refused with a
// hint and sends nothing.
import { boardNoteDecision } from './board_note_skip';
import { LIST_UNDER, ScreenPage } from './screen_page';

// The board entry screen's kind of page (screen_page.js).
export const BOARD_NOTES = Object.freeze({
  source: 'boardNotes',
  marker: 'board-notes',
  record: 'board-notes',
  step: 'board-notes',
  keys: 'b',
  words: Object.freeze({
    title: 'boardNotes_title', unavailable: 'boardNotes_unavailable', failed: 'boardNotes_failed',
    busy: 'boardNotes_busy', wait: 'boardNotes_wait', screen: '進板畫面'
  }),
  under: LIST_UNDER,
  // List easy reading presents an article list (its search results and digest
  // included, where PTT binds `b` too; never the mailbox or the user list) and
  // is idle.
  available(core) {
    const ls = core.listSession;
    if (!ls || !ls.boardNotesBoard || ls.boardNotesBoard() == null) return false;
    if (!core.buf || core.buf.listRenderMode !== 'buffer') return false;
    return !(typeof core.activeListSession === 'function' && core.activeListSession() !== ls);
  },
  subtitle: (core) => core.listSession.boardNotesBoard(),
  decide: boardNoteDecision
});

export class BoardNotes extends ScreenPage {
  constructor(core) {
    super(core, BOARD_NOTES);
  }
}

// Show the board entry screen (`b`, the context menu, More). Returns whether
// `b` was sent; when not, a hint says why.
export function showBoardNotes(core) {
  const notes = core && core.boardNotes;
  return !!notes && notes.start();
}
