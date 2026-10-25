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

export const MAX_SEARCH_ORIGINS = 8;

const sameBoard = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

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
