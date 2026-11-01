// Search trail: the bounded, board-scoped chain of article shortcut searches,
// which search backtracking unwinds one step at a time
// (docs/article-swipe-drawer-spec.md).
//
// A trail is plain JSON so it can later be persisted:
//   { board, origins: [origin...], phase, at? }
//   origin  { board, aid, author, title, query: { kind, value }, position }
//           The article a search started from and the query it submitted.
//           `position` is its sanitized reading-record bookmark.
//   phase   'results'  on the newest origin's result list
//           'article'  in an article natively opened from those results
//           'reopened' in an article reopened by AID (`at` identifies it); it
//                      belongs to the newest origin's results, which are no
//                      longer behind it and must be rebuilt on Back
//           'fallback' on the verified full board list standing in for an
//                      unavailable article of the newest origin's results
//
// Rebuilding a query resets the server cursor to the newest result, so a trail
// never reopens an article inside reconstructed results; it only restores
// articles by verified AID. Every transition returns a new trail or null.

import { sameBoard } from './screen_titles';
import { BOARD_RE, isAidc } from './aid_codec';
import { validateSearchResultsContext } from './search_results_context';

export const MAX_SEARCH_ORIGINS = 8;

function lightweight(position) {
  if (!position) return null;
  // Reading-record bookmarks carry live owner objects for in-session restores.
  const { listOwner, boardListOwner, ...rest } = position;
  return JSON.parse(JSON.stringify(rest));
}

function withPhase(trail, phase, at) {
  const next = { board: trail.board, origins: trail.origins, phase };
  if (at) next.at = { author: at.author, title: at.title };
  return next;
}

function pop(trail) {
  const origins = trail.origins.slice(0, -1);
  return origins.length ? { board: trail.board, origins, phase: trail.phase } : null;
}

// A search from `origin` reached its whole-board results.
export function searchedFrom(trail, origin) {
  const entry = {
    board: origin.board,
    aid: origin.aid,
    author: origin.author,
    title: origin.title,
    query: { kind: origin.query.kind, value: origin.query.value },
    position: lightweight(origin.position)
  };
  const kept = trail && sameBoard(trail.board, origin.board) ? trail.origins : [];
  return { board: origin.board, origins: [...kept, entry].slice(-MAX_SEARCH_ORIGINS), phase: 'results' };
}

// What Back owns at this point of the trail, or null for native Back.
export function backStep(trail) {
  if (!trail || !trail.origins.length) return null;
  const origin = trail.origins[trail.origins.length - 1];
  if (trail.phase === 'results') return { kind: 'restore', origin };
  if (trail.phase === 'reopened' || trail.phase === 'fallback') return { kind: 'rebuild', origin };
  return null;
}

// The newest origin's article was reopened at its reading position.
export function returned(trail) {
  const restored = trail.origins[trail.origins.length - 1];
  const next = pop(trail);
  return next && withPhase(next, 'reopened', restored);
}

// The newest origin's article is gone; the reader stops on its board list.
export function returnMissing(trail) {
  const next = pop(trail);
  return next && withPhase(next, 'fallback');
}

// The newest origin's query was submitted again and its results settled.
export function rebuilt(trail) {
  return withPhase(trail, 'results');
}

// A step stopped on the verified full board list without changing origins.
export function stoppedAtBoardList(trail) {
  return trail && trail.origins.length ? withPhase(trail, 'fallback') : null;
}

// An empty search reopened its source by AID: it remains a member of the
// newest origin's results, but those results are no longer behind it.
export function reopenedAfterEmptySearch(trail, origin) {
  return trail && trail.origins.length ? withPhase(trail, 'reopened', origin) : null;
}

// A screen settled outside the trail owner's own operations.
//   screen: { kind: 'article', board, author, title } | { kind: 'results', board }
//         | { kind: 'boardList', board } | { kind: 'menu' } | { kind: 'other' }
export function observe(trail, screen) {
  if (!trail || !screen) return trail || null;
  const phase = trail.phase;
  const here = sameBoard(screen.board, trail.board);
  switch (screen.kind) {
    case 'article':
      // Articles elsewhere (for example an AID link) leave the trail alone;
      // Back from them lands on that other board and ends it there.
      if (!here) return trail;
      if (phase === 'results' || phase === 'article') return withPhase(trail, 'article');
      if (phase === 'reopened' && trail.at &&
          trail.at.author === screen.author && trail.at.title === screen.title) return trail;
      return null;
    case 'results':
      return here && (phase === 'results' || phase === 'article') ? withPhase(trail, 'results') : null;
    case 'boardList':
      return here && phase === 'fallback' ? trail : null;
    case 'menu':
      return null;
    default:
      return trail;
  }
}

// Recovery after disconnection, reload or app reopen (docs/article-swipe-drawer-spec.md).
// The trail is kept beside the reconnect-resume plan captured at the same
// moment. After that plan's own resume transaction ends, the trail is
// reactivated only when the landed screen is exactly what the plan aimed at.

// Aligned with reconnect_resume.SNAPSHOT_MAX_AGE_MS (a unit test pins it).
export const SEARCH_TRAIL_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// What the reconnect-resume plan will land on, with the article identity the
// reader saw: { kind: 'article', board, aid, author, title } | { kind: 'list', board }.
export function recoveryTarget(plan, article) {
  if (!plan || typeof plan.board !== 'string' || !plan.board) return null;
  if (plan.kind === 'list') return { kind: 'list', board: plan.board,
    ...(plan.search ? { search: validateSearchResultsContext(plan.search, plan.board) } : {}) };
  if (plan.kind !== 'article' || !plan.aid || !article || !sameBoard(article.board, plan.board) ||
      typeof article.author !== 'string' || typeof article.title !== 'string') return null;
  return { kind: 'article', board: plan.board, aid: plan.aid, author: article.author, title: article.title };
}

// Plain JSON for local storage, or null when nothing is worth keeping.
export function recoveryRecord(trail, target, now) {
  if (!trail || !trail.origins.length || !target || !sameBoard(trail.board, target.board)) return null;
  return { v: 1, at: now, trail, target };
}

const PHASES = ['results', 'article', 'reopened', 'fallback'];
const MAX_TEXT = 200;
const MAX_POSITION_JSON = 4096;

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.length <= MAX_TEXT;
const isArticle = value => isObject(value) && isText(value.author) && isText(value.title);

function validOrigin(origin, board) {
  if (!isArticle(origin) || !sameBoard(origin.board, board) || !isAidc(origin.aid)) return false;
  const query = origin.query;
  if (!isObject(query) || !['author', 'thread'].includes(query.kind) || !isText(query.value) || !query.value) return false;
  if (origin.position === null) return true;
  return isObject(origin.position) && JSON.stringify(origin.position).length <= MAX_POSITION_JSON;
}

function validTrail(trail) {
  if (!isObject(trail) || !BOARD_RE.test(trail.board) || !PHASES.includes(trail.phase)) return false;
  const origins = trail.origins;
  if (!Array.isArray(origins) || !origins.length || origins.length > MAX_SEARCH_ORIGINS) return false;
  if (!origins.every(origin => validOrigin(origin, trail.board))) return false;
  return trail.phase === 'reopened' ? isArticle(trail.at) : trail.at === undefined;
}

function validTarget(target, board) {
  if (!isObject(target) || !sameBoard(target.board, board)) return false;
  if (target.kind === 'list') return !target.search || !!validateSearchResultsContext(target.search, board);
  return target.kind === 'article' && isAidc(target.aid) && isArticle(target);
}

// A stored record, or null when expired, damaged or out of bounds.
export function readRecoveryRecord(record, now) {
  if (!isObject(record) || record.v !== 1 || typeof record.at !== 'number') return null;
  if (!(now - record.at >= 0 && now - record.at <= SEARCH_TRAIL_MAX_AGE_MS)) return null;
  if (!validTrail(record.trail) || !validTarget(record.target, record.trail.board)) return null;
  return { trail: record.trail, target: record.target };
}

// Whether `plan` is the reconnect-resume plan a target was stored with.
export function followsPlan(target, plan) {
  if (!target || !plan || plan.kind !== target.kind || !sameBoard(plan.board, target.board)) return false;
  if (target.kind !== 'list') return plan.aid === target.aid;
  return JSON.stringify(validateSearchResultsContext(target.search, target.board)?.filters || null) ===
    JSON.stringify(validateSearchResultsContext(plan.search, plan.board)?.filters || null);
}

// The trail after its resume `plan` ended successfully on `landed` (a screen
// shape as in observe), or null to leave it inactive. Only the plan stored
// with the trail counts, and the landed screen must be exactly its target:
//   article target: the same verified article identity on the trail's board
//                   (only a trail standing in that article can own it);
//                   its results are no longer behind it, so Back rebuilds
//                   them as for any article reopened by AID.
//   list target:    the full board list of the trail's board; Back rebuilds
//                   the newest origin's results as on any verified fallback.
export function recovered(trail, target, plan, landed) {
  if (!trail || !followsPlan(target, plan) || !landed || !sameBoard(trail.board, target.board) ||
      !sameBoard(landed.board, target.board)) return null;
  if (target.kind === 'list') {
    if (target.search) return landed.kind === 'results' && trail.phase === 'results' ? withPhase(trail, 'results') : null;
    return landed.kind === 'boardList' ? withPhase(trail, 'fallback') : null;
  }
  if (landed.kind !== 'article' || landed.author !== target.author || landed.title !== target.title) return null;
  if (trail.phase === 'article') return withPhase(trail, 'reopened', target);
  if (trail.phase === 'reopened' && trail.at.author === target.author && trail.at.title === target.title) return trail;
  return null;
}
