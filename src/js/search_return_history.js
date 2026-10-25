// Search return history: the bounded, board-scoped route that article shortcut
// searches unwind one step at a time (docs/article-swipe-drawer-spec.md).
//
// A route is plain JSON so it can later be persisted:
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
// Rebuilding a query resets the server cursor to the newest result, so a route
// never reopens an article inside reconstructed results; it only restores
// articles by verified AID. Every transition returns a new route or null.

import { sameBoard } from './screen_titles';
import { BOARD_RE, isAidc } from './aid_codec';

export const MAX_SEARCH_ORIGINS = 8;

function lightweight(position) {
  if (!position) return null;
  // Reading-record bookmarks carry live owner objects for in-session restores.
  const { listOwner, boardListOwner, ...rest } = position;
  return JSON.parse(JSON.stringify(rest));
}

function withPhase(route, phase, at) {
  const next = { board: route.board, origins: route.origins, phase };
  if (at) next.at = { author: at.author, title: at.title };
  return next;
}

function pop(route) {
  const origins = route.origins.slice(0, -1);
  return origins.length ? { board: route.board, origins, phase: route.phase } : null;
}

// A search from `origin` reached its whole-board results.
export function searchedFrom(route, origin) {
  const entry = {
    board: origin.board,
    aid: origin.aid,
    author: origin.author,
    title: origin.title,
    query: { kind: origin.query.kind, value: origin.query.value },
    position: lightweight(origin.position)
  };
  const kept = route && sameBoard(route.board, origin.board) ? route.origins : [];
  return { board: origin.board, origins: [...kept, entry].slice(-MAX_SEARCH_ORIGINS), phase: 'results' };
}

// What Back owns at this point of the route, or null for native Back.
export function backStep(route) {
  if (!route || !route.origins.length) return null;
  const origin = route.origins[route.origins.length - 1];
  if (route.phase === 'results') return { kind: 'restore', origin };
  if (route.phase === 'reopened' || route.phase === 'fallback') return { kind: 'rebuild', origin };
  return null;
}

// The newest origin's article was reopened at its reading position.
export function returned(route) {
  const restored = route.origins[route.origins.length - 1];
  const next = pop(route);
  return next && withPhase(next, 'reopened', restored);
}

// The newest origin's article is gone; the reader stops on its board list.
export function returnMissing(route) {
  const next = pop(route);
  return next && withPhase(next, 'fallback');
}

// The newest origin's query was submitted again and its results settled.
export function rebuilt(route) {
  return withPhase(route, 'results');
}

// A step stopped on the verified full board list without changing origins.
export function stoppedAtBoardList(route) {
  return route && route.origins.length ? withPhase(route, 'fallback') : null;
}

// An empty search reopened its source by AID: it remains a member of the
// newest origin's results, but those results are no longer behind it.
export function reopenedAfterEmptySearch(route, origin) {
  return route && route.origins.length ? withPhase(route, 'reopened', origin) : null;
}

// A screen settled outside the route owner's own operations.
//   screen: { kind: 'article', board, author, title } | { kind: 'results', board }
//         | { kind: 'boardList', board } | { kind: 'menu' } | { kind: 'other' }
export function observe(route, screen) {
  if (!route || !screen) return route || null;
  const phase = route.phase;
  const here = sameBoard(screen.board, route.board);
  switch (screen.kind) {
    case 'article':
      // Articles elsewhere (for example an AID link) leave the route alone;
      // Back from them lands on that other board and ends it there.
      if (!here) return route;
      if (phase === 'results' || phase === 'article') return withPhase(route, 'article');
      if (phase === 'reopened' && route.at &&
          route.at.author === screen.author && route.at.title === screen.title) return route;
      return null;
    case 'results':
      return here && (phase === 'results' || phase === 'article') ? withPhase(route, 'results') : null;
    case 'boardList':
      return here && phase === 'fallback' ? route : null;
    case 'menu':
      return null;
    default:
      return route;
  }
}

// Recovery after disconnection, reload or app reopen (docs/article-swipe-drawer-spec.md).
// The route is kept beside the reconnect-resume plan captured at the same
// moment. After that plan's own resume transaction ends, the route is
// reactivated only when the landed screen is exactly what the plan aimed at.

// Aligned with reconnect_resume.SNAPSHOT_MAX_AGE_MS (a unit test pins it).
export const SEARCH_RETURN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// What the reconnect-resume plan will land on, with the article identity the
// reader saw: { kind: 'article', board, aid, author, title } | { kind: 'list', board }.
export function recoveryTarget(plan, article) {
  if (!plan || typeof plan.board !== 'string' || !plan.board) return null;
  if (plan.kind === 'list') return { kind: 'list', board: plan.board };
  if (plan.kind !== 'article' || !plan.aid || !article || !sameBoard(article.board, plan.board) ||
      typeof article.author !== 'string' || typeof article.title !== 'string') return null;
  return { kind: 'article', board: plan.board, aid: plan.aid, author: article.author, title: article.title };
}

// Plain JSON for local storage, or null when nothing is worth keeping.
export function recoveryRecord(route, target, now) {
  if (!route || !route.origins.length || !target || !sameBoard(route.board, target.board)) return null;
  return { v: 1, at: now, route, target };
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

function validRoute(route) {
  if (!isObject(route) || !BOARD_RE.test(route.board) || !PHASES.includes(route.phase)) return false;
  const origins = route.origins;
  if (!Array.isArray(origins) || !origins.length || origins.length > MAX_SEARCH_ORIGINS) return false;
  if (!origins.every(origin => validOrigin(origin, route.board))) return false;
  return route.phase === 'reopened' ? isArticle(route.at) : route.at === undefined;
}

function validTarget(target, board) {
  if (!isObject(target) || !sameBoard(target.board, board)) return false;
  if (target.kind === 'list') return true;
  return target.kind === 'article' && isAidc(target.aid) && isArticle(target);
}

// A stored record, or null when expired, damaged or out of bounds.
export function readRecoveryRecord(record, now) {
  if (!isObject(record) || record.v !== 1 || typeof record.at !== 'number') return null;
  if (!(now - record.at >= 0 && now - record.at <= SEARCH_RETURN_MAX_AGE_MS)) return null;
  if (!validRoute(record.route) || !validTarget(record.target, record.route.board)) return null;
  return { route: record.route, target: record.target };
}

// Whether `plan` is the reconnect-resume plan a target was stored with.
export function followsPlan(target, plan) {
  if (!target || !plan || plan.kind !== target.kind || !sameBoard(plan.board, target.board)) return false;
  return target.kind === 'list' || plan.aid === target.aid;
}

// The route after its resume `plan` ended successfully on `landed` (a screen
// shape as in observe), or null to leave it inactive. Only the plan stored
// with the route counts, and the landed screen must be exactly its target:
//   article target: the same verified article identity on the route's board
//                   (only a route standing in that article can own it);
//                   its results are no longer behind it, so Back rebuilds
//                   them as for any article reopened by AID.
//   list target:    the full board list of the route's board; Back rebuilds
//                   the newest origin's results as on any verified fallback.
export function recovered(route, target, plan, landed) {
  if (!route || !followsPlan(target, plan) || !landed || !sameBoard(route.board, target.board) ||
      !sameBoard(landed.board, target.board)) return null;
  if (target.kind === 'list') return landed.kind === 'boardList' ? withPhase(route, 'fallback') : null;
  if (landed.kind !== 'article' || landed.author !== target.author || landed.title !== target.title) return null;
  if (route.phase === 'article') return withPhase(route, 'reopened', target);
  if (route.phase === 'reopened' && route.at.author === target.author && route.at.title === target.title) return route;
  return null;
}
