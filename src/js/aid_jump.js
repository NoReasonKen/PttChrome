// Jump to an article by its code (AID) from the easy-reading article list
// (#253) and from an easy-reading article (#281). PTT's own `#` prompt never
// shows: `#` (and the More sheet's entry on the phone) opens PttChrome's
// input, a pasted code runs the same jump, and the keys go through the
// serialized AID navigation, which verifies every screen. Pure parsing here;
// the page lives in components/ContextMenu/AidJumpModal.jsx, the keys in
// aid_navigation.js.
import { AID_INPUT_MAX_LENGTH, isAidc, parseAidWithBoard, parseArticleUrl } from './aid_codec';
import { sameBoard } from './screen_titles';
import { serializedOpHint } from './serialized_op_gate';
import { HINT_ERROR } from './status_hint';
import { i18n } from './i18n';

// What a reader typed or pasted: `#AID`, `AID`, `#AID (Board)`, `Board #AID`.
// A bare code must start with a digit (every current AID does: the first
// character is the high digit of a time-based number), so an ordinary
// eight-letter word pasted over the list is not taken for a code. A URL is
// no code: a pasted article link is parseArticlePaste's.
// Returns { aid, board } (board null when none was written) or null.
export function parseAidJumpInput(text) {
  const s = String(text || '').trim();
  if (!s || s.length > AID_INPUT_MAX_LENGTH || /^https?:\/\//i.test(s)) return null;
  const bare = /^#?([0-9][0-9A-Za-z_-]{7})$/.exec(s);
  if (bare && isAidc(bare[1])) return { aid: bare[1], board: null };
  const target = parseAidWithBoard(s);
  return target ? { aid: target.aid, board: target.board } : null;
}

// What a paste over an easy-reading article or article list jumps to (#253,
// #281): any form the input takes, or a ptt.cc article link, which names its
// board. null for any other text, which both keep refusing.
export function parseArticlePaste(text) {
  return parseAidJumpInput(text) || parseArticleUrl(String(text || '').trim());
}

function flash(core, text) {
  core.view?.flashListHint?.(text, 4000, HINT_ERROR);
}

// The board a jump by code searches now: the list's (#253), or, over an
// easy-reading article, the article's (#281; the list waits suspended behind
// it then). null when neither can take one.
function jumpBoard(core) {
  return core.listSession?.aidJumpBoard?.() || core.easyReading?.aidJumpBoard?.() || null;
}

// `#` and the More sheet's entry: open the input, if the list or the article
// can take a jump now. Returns whether the input opened; otherwise the reader
// was told why.
export function requestAidJump(core) {
  const busy = serializedOpHint(core);
  if (busy) {
    flash(core, busy);
    return false;
  }
  if (!jumpBoard(core)) {
    flash(core, i18n('aidJump_unavailable'));
    return false;
  }
  return !!core.openAidJumpModal();
}

// Run the jump for a code the reader confirmed, or a code or article link
// pasted. Returns false when nothing was started (the reader was told why).
export function startAidJump(core, text) {
  if (!core.listSession?.aidJumpBoard?.()) {
    const article = core.easyReading?.aidJumpBoard?.();
    if (article) return startArticleAidJump(core, article, text);
  }
  const target = parseArticlePaste(text);
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

// The jump from the easy-reading article on screen, of `board` (#281), for a
// code confirmed in the input or pasted over the article (a link too).
// Same-board misses can reopen the source; cross-board requests share the
// deep-link entry point. AidNavigation keeps the source for both routes.
// Returns false when nothing was started (the reader was told why).
export function startArticleAidJump(core, board, text) {
  const target = parseArticlePaste(text);
  if (!target) return false;
  const busy = serializedOpHint(core);
  if (busy) {
    flash(core, busy);
    return false;
  }
  if (target.board && !sameBoard(target.board, board))
    return !!core.deepLinkController?.request({ board: target.board, aid: target.aid });
  const code = '#' + target.aid;
  const started = core.aidNavigation.jumpFromArticle(board, target.aid, (result) => {
    // A run that failed otherwise has held the article with its own message.
    if (!result.ok && result.returned) flash(core, i18n('aidJump_notFoundArticle').replace('{0}', code));
  });
  if (!started) flash(core, i18n('aidJump_failedArticle').replace('{0}', code));
  return started;
}
