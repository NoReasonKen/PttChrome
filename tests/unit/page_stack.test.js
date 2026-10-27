import {
  createPageStack, pushPage, popPage, revealTarget, withLayer, handoffStep, HANDOFF_IDLE_MS, HANDOFF_TIMEOUT_MS,
  queueBack, takeQueuedBack, dropQueuedBacks, boundLayers, LIVE_LAYER_BOUND
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
