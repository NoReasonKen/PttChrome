// Jump to an article by its code (AID) from the easy-reading article list
// (#253). PTT's own `#` prompt never shows: `#` (and the More sheet's entry on
// the phone) opens PttChrome's input, a pasted code runs the same jump, and
// the keys go through the serialized AID navigation, which verifies every
// screen. Pure parsing here; the page lives in components/ContextMenu/
// AidJumpModal.jsx, the keys in aid_navigation.js.
import { isAidc, parseAidWithBoard } from './aid_codec';
import { sameBoard } from './screen_titles';
import { serializedOpHint } from './serialized_op_gate';
import { HINT_ERROR } from './status_hint';
import { i18n } from './i18n';

// What a reader typed or pasted: `#AID`, `AID`, `#AID (Board)`, `Board #AID`.
// A bare code must start with a digit (every current AID does: the first
// character is the high digit of a time-based number), so an ordinary
// eight-letter word pasted over the list is not taken for a code. URLs belong
// to the command palette and deep links, not here.
// Returns { aid, board } (board null when none was written) or null.
export function parseAidJumpInput(text) {
  const s = String(text || '').trim();
  if (!s || /^https?:\/\//i.test(s)) return null;
  const bare = /^#?([0-9][0-9A-Za-z_-]{7})$/.exec(s);
  if (bare && isAidc(bare[1])) return { aid: bare[1], board: null };
  const target = parseAidWithBoard(s);
  return target ? { aid: target.aid, board: target.board } : null;
}

function flash(core, text) {
  core.view?.flashListHint?.(text, 4000, HINT_ERROR);
}

// `#` and the More sheet's entry: open the input, if the list can take a jump
// now. Returns whether the input opened; otherwise the reader was told why.
export function requestAidJump(core) {
  const busy = serializedOpHint(core);
  if (busy) {
    flash(core, busy);
    return false;
  }
  if (!core.listSession?.aidJumpBoard()) {
    flash(core, i18n('aidJump_unavailable'));
    return false;
  }
  return !!core.openAidJumpModal();
}

// Run the jump for a code the reader confirmed or pasted. Returns false when
// nothing was started (the reader was told why).
export function startAidJump(core, text) {
  const target = parseAidJumpInput(text);
  if (!target) return false;
  const busy = serializedOpHint(core);
  if (busy) {
    flash(core, busy);
    return false;
  }
  const here = core.listSession?.aidJumpBoard();
  if (!here) {
    flash(core, i18n('aidJump_unavailable'));
    return false;
  }
  // Another board: the navigation the command palette and deep links use
  // (it opens the article there, and keeps its own way back).
  if (target.board && !sameBoard(target.board, here))
    return !!core.deepLinkController?.request({ board: target.board, aid: target.aid });
  const board = here;
  const origin = core.listSession.selectionOrigin?.();
  const started = core.aidNavigation.selectArticle(board, target.aid, (result) => {
    if (result.ok) return;
    core.listSession.restoreSelection?.(origin);
    flash(core, i18n(result.missed ? 'aidJump_notFound' : 'aidJump_failed').replace('{0}', '#' + target.aid));
  }, { forList: true });
  if (!started) flash(core, i18n('aidJump_failed').replace('{0}', '#' + target.aid));
  return started;
}
