// The stacked pages of mobile easy reading (#25): the ordered pages from the
// stack base to the current page. Pure state; the owner holds the live layers
// and PTT stays the authority for what is really on screen.
//
// A page is { kind, board, layer }: the kind of page, the board it shows, and
// whether a live layer of it exists underneath. `queued` counts the Backs made
// while a handoff was under way, still to run.
import { sameBoard } from './screen_titles';

export function createPageStack() {
  return { pages: [] };
}

// A verified entry. `fromBelow`: opened from the current page; anything else
// (search, article code, link, resume, board jump) starts a new base.
export function pushPage(stack, page, { fromBelow = false } = {}) {
  return { pages: fromBelow ? [...stack.pages, page] : [page] };
}

// The current page is about to open something: a live layer of it is kept.
export function withLayer(stack) {
  const n = stack.pages.length;
  if (!n) return stack;
  return { ...stack, pages: [...stack.pages.slice(0, -1), { ...stack.pages[n - 1], layer: true }] };
}

// Back: the lower page becomes the current, real page, so its layer is spent.
export function popPage(stack) {
  const pages = stack.pages.slice(0, -1);
  const n = pages.length;
  if (n) pages[n - 1] = { ...pages[n - 1], layer: false };
  return { stack: { ...stack, pages }, revealed: revealTarget(stack) };
}

// A Back made while the current page is sliding away to reveal the one below.
// It runs after the swap, so the reader can unwind quickly; it is kept only
// while a page is left below the revealed one to go back to.
export function queueBack(stack) {
  const queued = stack.queued || 0;
  return queued < stack.pages.length - 2 ? { ...stack, queued: queued + 1 } : stack;
}

// After the swap: whether a queued Back runs now.
export function takeQueuedBack(stack) {
  const queued = stack.queued || 0;
  return { stack: { ...stack, queued: Math.max(0, queued - 1) }, back: queued > 0 };
}

// The handoff did not end on the expected page: what the queued Backs were
// meant to unwind no longer holds.
export function dropQueuedBacks(stack) {
  return { ...stack, queued: 0 };
}

// Live layers kept at once. Pages deeper than this keep only their identity,
// and Back to them waits for PTT as without a stack. Measured on a phone (#48):
// eight layers of full search results and very long articles hold about 261k
// nodes, about 65MB, and each costs at most about 150ms once, when its page is
// left.
export const LIVE_LAYER_BOUND = 8;

// Release the oldest live layers beyond `bound`. Returns the depths released.
export function boundLayers(stack, bound = LIVE_LAYER_BOUND) {
  const live = stack.pages.map((page, depth) => (page.layer ? depth : -1)).filter(depth => depth >= 0);
  const released = live.slice(0, Math.max(0, live.length - bound));
  if (!released.length) return { stack, released };
  const pages = stack.pages.map((page, depth) => (released.includes(depth) ? { ...page, layer: false } : page));
  return { stack: { ...stack, pages }, released };
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
