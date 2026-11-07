// The handoff of a Back with no live page below (#32, #53): it waits for
// whatever page PTT shows next, and the page being left is not that answer.
// Also the post-time order a list layer's selection follows (#74).
import { NavigationStack, postedBefore } from '../../src/js/navigation_stack';
import { PAGE } from '../../src/js/page_stack';
import { setupI18n, i18n } from '../../src/js/i18n';

beforeAll(() => setupI18n());

function fakeCore() {
  const ends = [];
  const buf = new EventTarget();
  Object.assign(buf, { pageState: 2, listRenderOwner: 'board-list' });
  const core = {
    buf, conn: Object.assign(new EventTarget(), { isConnected: true }), view: {},
    debugRecorder: { isRecording: true, log: (tag, info) => info.mark === 'end' && ends.push(info.how) }
  };
  return { core, ends };
}

const settle = (core, pageState, owner) => {
  Object.assign(core.buf, { pageState, listRenderOwner: owner });
  core.buf.dispatchEvent(new Event('screenSettled'));
};

test('a board list left with nothing below waits through its own redraws and ends on PTT\'s next page', () => {
  const { core, ends } = fakeCore();
  const stack = new NavigationStack(core);
  let finished = 0;
  const sent = stack.begin({ level: PAGE.BOARD_LIST, send: () => true, finish: () => finished++, cancel: () => {} });
  expect(sent).toBe(true);
  settle(core, 2, 'board-list');
  expect(finished).toBe(0);
  settle(core, 1, null);
  expect(finished).toBe(1);
  expect(ends).toEqual(['presented']);
});

test('post times in order, and no order when either is unknown or they are equal', () => {
  const nov8 = 'Sun Nov  8 20:13:20 2026';
  expect(postedBefore('Fri Oct 16 22:13:20 2026', nov8)).toBe(true);
  expect(postedBefore(nov8, 'Fri Oct 16 22:13:20 2026')).toBe(false);
  expect(postedBefore('Sun Nov  8 20:13:19 2026', nov8)).toBe(true);
  expect(postedBefore(nov8, nov8)).toBe(null);
  expect(postedBefore(null, nov8)).toBe(null);
  expect(postedBefore('not a time', nov8)).toBe(null);
});

// An action made before PTT has caught up (#121): remembered with the progress
// bar showing, the last one wins, and it runs once the real page takes over;
// a handoff that times out drops it instead.
function rememberDuring(core, stack) {
  const loading = [];
  core.view.setListLoading = (on, owner) => loading.push([on, owner]);
  const done = [];
  stack.begin({ level: PAGE.BOARD_LIST, send: () => true, finish: () => {}, cancel: () => {} });
  stack.remember({ run: () => done.push('first'), drop: how => done.push('dropped first ' + how) });
  stack.remember({ run: () => done.push('second'), drop: how => done.push('dropped second ' + how) });
  return { loading, done };
}

test('an action remembered during a handoff runs, last one only, once PTT presents its page', () => {
  vi.useFakeTimers();
  try {
    const { core } = fakeCore();
    const stack = new NavigationStack(core);
    const { loading, done } = rememberDuring(core, stack);
    expect(loading).toContainEqual([true, 'stackPending']);
    settle(core, 1, null);
    expect(loading.at(-1)).toEqual([false, 'stackPending']);
    expect(done).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(done).toEqual(['second']);
  } finally {
    vi.useRealTimers();
  }
});

test('an action remembered during a handoff that times out is dropped', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  try {
    const { core, ends } = fakeCore();
    const stack = new NavigationStack(core);
    const { loading, done } = rememberDuring(core, stack);
    vi.advanceTimersByTime(6000);
    expect(ends).toEqual(['timeout']);
    expect(done).toEqual(['dropped second timeout']);
    expect(loading.at(-1)).toEqual([false, 'stackPending']);
  } finally {
    vi.useRealTimers();
  }
});

// An action on a revealed page (#124) runs at once when nothing is handed
// off; during a handoff it is remembered, and dropping it says it did not run.
test('an action made when ready runs at once, and one dropped by a timeout gives a notice', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  try {
    const { core, ends } = fakeCore();
    const hints = [];
    core.view.flashListHint = text => hints.push(text);
    const stack = new NavigationStack(core);
    const done = [];
    stack.whenReady(() => done.push('now'));
    expect(done).toEqual(['now']);
    stack.begin({ level: PAGE.BOARD_LIST, send: () => true, finish: () => {}, cancel: () => {} });
    stack.whenReady(() => done.push('later'));
    expect(done).toEqual(['now']);
    vi.advanceTimersByTime(6000);
    expect(ends).toEqual(['timeout']);
    expect(done).toEqual(['now']);
    expect(hints).toEqual([i18n('stack_actionNotRun')]);
    expect(hints[0]).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

// A debug recording keeps what became of each action made during a handoff
// (#119): remembered, replaced, run or dropped, with the reason.
test('a debug recording logs each remembered action and how it ended', () => {
  const { core } = fakeCore();
  const actions = [];
  core.debugRecorder.log = (tag, info) => tag === 'stack.action' && actions.push(info);
  core.view.setListLoading = () => {};
  const stack = new NavigationStack(core);
  stack.begin({ level: PAGE.BOARD_LIST, send: () => true, finish: () => {}, cancel: () => {} });
  stack.remember({ run: () => {}, drop: () => {} });
  stack.remember({ run: () => {}, drop: () => {} });
  settle(core, 1, null);
  expect(actions.map(a => [a.outcome, a.replaced ?? a.reason ?? null])).toEqual([
    ['remembered', false], ['remembered', true], ['run', 'presented']
  ]);
  stack.whenReady(() => {});
  expect(actions[actions.length - 1].outcome).toBe('runNow');
});
