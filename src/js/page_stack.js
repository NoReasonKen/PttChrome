// The stacked pages of mobile easy reading (#25): the ordered pages from the
// stack base to the current page. Pure state; the owner holds the live layers
// and PTT stays the authority for what is really on screen.
//
// A page is { kind, board, layer }: the kind of page, the board it shows, and
// whether a live layer of it exists underneath.
import { sameBoard } from './screen_titles';

export function createPageStack() {
  return { pages: [] };
}

// A verified entry. `fromBelow`: opened from the current page; anything else
// (search, article code, link, resume, board jump) starts a new base.
export function pushPage(stack, page, { fromBelow = false } = {}) {
  return { pages: fromBelow ? [...stack.pages, page] : [page] };
}

export function popPage(stack) {
  const pages = stack.pages.slice(0, -1);
  return { stack: { pages }, revealed: revealTarget(stack) };
}

// The lower page that Back may reveal: it has a live layer and is the page the
// current one was opened from.
export function revealTarget(stack) {
  const n = stack.pages.length;
  if (n < 2) return null;
  const current = stack.pages[n - 1];
  const below = stack.pages[n - 2];
  return below.layer && sameBoard(below.board, current.board) ? below : null;
}

// The reader is idle when no finger is down and nothing has scrolled
// (momentum included) for this long. Swapping the element under a finger would
// end its touch sequence and stop momentum.
export const HANDOFF_IDLE_MS = 150;
// A reply that never arrives ends the handoff after this long. The timeout
// stops counting once the real page is presented.
export const HANDOFF_TIMEOUT_MS = 5000;

// What a handoff does next: 'wait' (and recheck after `ms`), 'swap' the real
// page in, or 'timeout'. Times are performance.now() values.
export function handoffStep({ sentAt, presentedAt, touches, lastScrollAt, now }) {
  if (presentedAt == null) {
    const left = sentAt + HANDOFF_TIMEOUT_MS - now;
    return left > 0 ? { action: 'wait', ms: left } : { action: 'timeout' };
  }
  if (touches > 0) return { action: 'wait', ms: HANDOFF_IDLE_MS };
  const quiet = now - lastScrollAt;
  return quiet >= HANDOFF_IDLE_MS ? { action: 'swap' } : { action: 'wait', ms: HANDOFF_IDLE_MS - quiet };
}
