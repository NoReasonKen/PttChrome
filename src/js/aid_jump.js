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
import { PAGE } from './page_stack';
import { isPlainBack } from './term_keyboard';
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

// The jump by code from an article, as ArticleHold's operation.
const ARTICLE_JUMP_SOURCE = 'articleAidJump';

// The jump from the easy-reading article on screen, of `board` (#281), for a
// code confirmed in the input or pasted over the article (a link too). It
// stays on the board, as PTT's `#` does, and opens the article found in easy
// reading (AidNavigation.jumpFromArticle). On the phone the article left
// stays alive under the one found, so Back reveals it at once
// (backToJumpOrigin). A code of another board takes the list's route there.
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
  // Captured before the run leaves the article: the page shown now.
  const left = core.articleGestures?.captureArticleLayer?.() || null;
  if (left) left.jump = true;
  // Leaving the article for its list (Q, `s<board>`) repaints it on the way,
  // and a miss opens it again from its top: a copy of it as it is now covers
  // the reading area from here on (ArticleHold's run cover), so the reader
  // sees it stay still. The article found slides in over the stack's copy,
  // which the cover is lifted onto; the article returned to after a miss is
  // uncovered once its reading position is back; a failure keeps the cover
  // as the hold's.
  const hold = core.articleHold;
  const covered = !!hold?.run(ARTICLE_JUMP_SOURCE, { cover: true });
  const started = core.aidNavigation.jumpFromArticle(board, target.aid, (result) => {
    if (core.articleGestures) core.articleGestures.landJump(left, result.ok);
    else core.navigationStack?.jumpLanded?.(left, result.ok);
    if (covered) hold.done(ARTICLE_JUMP_SOURCE, result.ok ? { uncover: true } : undefined);
    // A run that failed otherwise has held the article with its own message.
    if (!result.ok && result.returned) flash(core, i18n('aidJump_notFoundArticle').replace('{0}', code));
  });
  if (!started) {
    core.navigationStack?.jumpLanded?.(left, false);
    if (covered) hold.done(ARTICLE_JUMP_SOURCE);
    flash(core, i18n('aidJump_failedArticle').replace('{0}', code));
  }
  return started;
}

// Back from an article opened by its code over the article it was opened
// from (#281). The first Back reveals that article's live layer at once
// (ArticleGestures.handleBack); the Back the stack then sends is taken here
// instead of reaching PTT as `←`, which would show the board's list: the
// jump's own way back (AidNavigation.back) opens the article again by its
// code, and the real article takes over from the layer at its reading
// position. Returns true when the key was taken.
export function backToJumpOrigin(core, event) {
  const stack = core.navigationStack;
  const gestures = core.articleGestures;
  if (!stack?.jumpOriginBelow?.() || !gestures || !isPlainBack(event)) return false;
  if (!gestures.sendingBack) return gestures.handleBack(event);
  const nav = core.aidNavigation;
  if (!nav?.canGoBack()) return false;
  // The revealed article carries its own reading position, the one the
  // reader may have scrolled it to meanwhile: the real one takes it over
  // (StackArticleLayer.alignReal), and no position from before the jump is
  // restored afterwards.
  return nav.back((result) => {
    if (result.ok) gestures.pagePresented(PAGE.ARTICLE);
    // The article left is gone from the board: it stays shown over the list.
    else if (result.missed) stack.sourceGone();
  }, { revealed: true });
}
