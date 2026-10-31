// The handoff of a Back with no live page below (#32, #53): it waits for
// whatever page PTT shows next, and the page being left is not that answer.
// Also the post-time order a list layer's selection follows (#74).
import { NavigationStack, postedBefore } from '../../src/js/navigation_stack';
import { PAGE } from '../../src/js/page_stack';

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
