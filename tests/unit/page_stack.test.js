import {
  createPageStack, pushPage, popPage, revealTarget, withLayer, handoffStep, HANDOFF_IDLE_MS, HANDOFF_TIMEOUT_MS,
  queueBack, takeQueuedBack, dropQueuedBacks, boundLayers, LIVE_LAYER_BOUND, pageShown
} from '../../src/js/page_stack';

const list = (board, extra) => ({ kind: 'articleList', board, layer: true, ...extra });
const article = board => ({ kind: 'article', board });

test('Back from an article reveals the article list it was opened from', () => {
  let stack = pushPage(createPageStack(), list('C_Chat'));
  stack = pushPage(stack, article('C_Chat'), { fromBelow: true });
  expect(revealTarget(stack)).toMatchObject({ kind: 'articleList', board: 'C_Chat' });
  const popped = popPage(stack);
  expect(popped.revealed).toMatchObject({ kind: 'articleList', board: 'C_Chat' });
  expect(revealTarget(popped.stack)).toBeNull();
});

test('an article reached another way starts a new base and reveals nothing', () => {
  let stack = pushPage(createPageStack(), list('C_Chat'));
  stack = pushPage(stack, article('C_Chat'));
  expect(revealTarget(stack)).toBeNull();
  expect(popPage(stack).revealed).toBeNull();
});

test('only the page the current one was opened from is revealed', () => {
  let stack = pushPage(createPageStack(), list('C_Chat'));
  stack = pushPage(stack, article('Gossiping'), { fromBelow: true });
  expect(revealTarget(stack)).toBeNull();
  let same = pushPage(createPageStack(), list('c_chat'));
  same = pushPage(same, article('C_Chat'), { fromBelow: true });
  expect(revealTarget(same)).toMatchObject({ board: 'c_chat' });
});

test('a lower page without a live layer is not revealed', () => {
  let stack = pushPage(createPageStack(), list('C_Chat', { layer: false }));
  stack = pushPage(stack, article('C_Chat'), { fromBelow: true });
  expect(revealTarget(stack)).toBeNull();
});

test('each Back reveals the next lower page, and a revealed page\'s layer is spent', () => {
  let stack = withLayer(pushPage(createPageStack(), { kind: 'home', board: 'C_Chat' }));
  stack = withLayer(pushPage(stack, { kind: 'articleList', board: 'C_Chat' }, { fromBelow: true }));
  stack = pushPage(stack, article('C_Chat'), { fromBelow: true });
  const fromArticle = popPage(stack);
  expect(fromArticle.revealed).toMatchObject({ kind: 'articleList' });
  expect(revealTarget(fromArticle.stack)).toMatchObject({ kind: 'home', board: 'C_Chat' });
  // The list is now the real page: another article needs a fresh layer of it.
  const reopened = pushPage(fromArticle.stack, article('C_Chat'), { fromBelow: true });
  expect(revealTarget(reopened)).toBeNull();
  expect(revealTarget(pushPage(withLayer(fromArticle.stack), article('C_Chat'), { fromBelow: true })))
    .toMatchObject({ kind: 'articleList' });
});

// The dashboard → board → article route, each page kept alive under the next.
const homeListArticle = () => {
  let stack = withLayer(pushPage(createPageStack(), { kind: 'home', board: 'C_Chat' }));
  stack = withLayer(pushPage(stack, { kind: 'articleList', board: 'C_Chat' }, { fromBelow: true }));
  return pushPage(stack, article('C_Chat'), { fromBelow: true });
};

describe('Back during a handoff', () => {
  test('is queued once for each page below the revealed one, and runs once after the swap', () => {
    let stack = homeListArticle();
    // Leaving the article reveals the list; only the dashboard is below it.
    stack = queueBack(queueBack(queueBack(stack)));
    const swapped = popPage(stack).stack;
    const next = takeQueuedBack(swapped);
    expect(next.back).toBe(true);
    expect(takeQueuedBack(next.stack).back).toBe(false);
  });

  test('is not queued when nothing is below the revealed page', () => {
    let stack = withLayer(pushPage(createPageStack(), list('C_Chat')));
    stack = pushPage(stack, article('C_Chat'), { fromBelow: true });
    const swapped = popPage(queueBack(stack)).stack;
    expect(takeQueuedBack(swapped).back).toBe(false);
  });

  test('is dropped when the handoff breaks or another page is entered', () => {
    const queued = queueBack(homeListArticle());
    expect(takeQueuedBack(popPage(dropQueuedBacks(queued)).stack).back).toBe(false);
    expect(takeQueuedBack(pushPage(queued, list('Gossiping'))).back).toBe(false);
  });
});

describe('live layer bound', () => {
  test('beyond the bound the oldest live layer is released, and Back to its page reveals nothing', () => {
    const { stack, released } = boundLayers(homeListArticle(), 1);
    expect(released).toEqual([0]);
    expect(revealTarget(stack)).toMatchObject({ kind: 'articleList' });
    expect(revealTarget(popPage(stack).stack)).toBeNull();
  });

  test('within the bound every layer stays', () => {
    const { stack, released } = boundLayers(homeListArticle(), LIVE_LAYER_BOUND);
    expect(released).toEqual([]);
    expect(revealTarget(popPage(stack).stack)).toMatchObject({ kind: 'home' });
  });
});

// A page shown outside a handoff that was not opened from the current page
// (#35): the stack keeps only what is still the way back.
describe('a page shown without an open', () => {
  const opened = (board, id) => ({ kind: 'article', board, id });
  const results = board => ({ kind: 'articleList', board, results: true });
  // Dashboard → board → article A, each page kept alive under the next.
  const route = () => {
    let stack = withLayer(pushPage(createPageStack(), { kind: 'home', board: 'C_Chat' }));
    stack = withLayer(pushPage(stack, { kind: 'articleList', board: 'C_Chat' }, { fromBelow: true }));
    return pushPage(stack, opened('C_Chat', 'A'), { fromBelow: true });
  };

  test('the page the stack is already on changes nothing', () => {
    const stack = route();
    expect(pageShown(stack, opened('C_Chat', 'A'))).toEqual({ stack, kept: 3 });
  });

  test('the list of the current article, reached without a handoff, keeps the pages below it', () => {
    const { stack, kept } = pageShown(route(), { kind: 'articleList', board: 'C_Chat' });
    expect(kept).toBe(1);
    expect(stack.pages.map(page => page.kind)).toEqual(['home', 'articleList']);
    expect(revealTarget(stack)).toMatchObject({ kind: 'home' });
  });

  test('an article reopened over a list it was not opened from starts a new base', () => {
    // Search return history reopens the source article by its code while the
    // stack is on the search results.
    const onResults = pageShown(route(), results('C_Chat')).stack;
    const { stack, kept } = pageShown(onResults, opened('C_Chat', 'A'));
    expect(kept).toBe(0);
    expect(stack.pages).toEqual([opened('C_Chat', 'A')]);
    expect(revealTarget(stack)).toBeNull();
  });

  test('another article in place of the current one keeps the pages below its list', () => {
    const { stack, kept } = pageShown(route(), opened('C_Chat', 'B'));
    expect(kept).toBe(1);
    expect(stack.pages.map(page => page.kind)).toEqual(['home', 'articleList', 'article']);
    expect(revealTarget(stack)).toBeNull();
    expect(revealTarget(popPage(stack).stack)).toMatchObject({ kind: 'home' });
  });

  test('a list search, or leaving its results for the list, starts a new base', () => {
    const onList = popPage(route()).stack;
    const searched = pageShown(onList, results('C_Chat'));
    expect(searched).toMatchObject({ kept: 0, stack: { pages: [results('C_Chat')] } });
    expect(pageShown(searched.stack, { kind: 'articleList', board: 'C_Chat' }).kept).toBe(0);
  });

  test('a page of another board starts a new base', () => {
    expect(pageShown(route(), { kind: 'articleList', board: 'Gossiping' }).kept).toBe(0);
    expect(pageShown(route(), opened('Gossiping', 'A')).kept).toBe(0);
  });
});

describe('handoff readiness', () => {
  const at = (facts) => handoffStep({ sentAt: 0, presentedAt: null, touches: 0, lastScrollAt: -Infinity, ...facts });

  test('waits while the real page is not presented, and gives up after the timeout', () => {
    expect(at({ now: 100 })).toEqual({ action: 'wait', ms: HANDOFF_TIMEOUT_MS - 100 });
    expect(at({ now: HANDOFF_TIMEOUT_MS })).toEqual({ action: 'timeout' });
  });

  test('swaps once presented and the reader is idle', () => {
    expect(at({ presentedAt: 200, now: 200 })).toEqual({ action: 'swap' });
  });

  test('a finger down or a recent scroll defers the swap, with no timeout after presentation', () => {
    const late = HANDOFF_TIMEOUT_MS * 3;
    expect(at({ presentedAt: 200, touches: 1, now: late })).toEqual({ action: 'wait', ms: HANDOFF_IDLE_MS });
    expect(at({ presentedAt: 200, lastScrollAt: late - 40, now: late })).toEqual({ action: 'wait', ms: HANDOFF_IDLE_MS - 40 });
    expect(at({ presentedAt: 200, lastScrollAt: late - HANDOFF_IDLE_MS, now: late })).toEqual({ action: 'swap' });
  });
});
