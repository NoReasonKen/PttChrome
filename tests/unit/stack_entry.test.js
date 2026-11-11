// @unit-env browser
import { StackEntry } from '../../src/js/stack_entry';
import { HANDOFF_TIMEOUT_MS, HANDOFF_REACH_POLL_MS, PAGE } from '../../src/js/page_stack';

let mounted;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  if (mounted && !mounted.ended) mounted.entry.end();
  mounted?.root.remove();
  mounted = null;
  vi.useRealTimers();
});

function openBoard({ skipping = true } = {}) {
  const root = document.createElement('div');
  const main = document.createElement('div');
  root.appendChild(main);
  document.body.appendChild(root);
  const core = {
    view: { mainDisplay: main, setListLoading: vi.fn() },
    buf: { pageState: 5, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    boardNoteSkip: { active: skipping }
  };
  const layer = { show: vi.fn(), prepare: vi.fn(), hide: vi.fn() };
  mounted = { root, main, core, ended: false };
  mounted.entry = new StackEntry(core, { kind: PAGE.HOME, layer, title: 'Home' }, () => { mounted.ended = true; });
  return mounted;
}

test('the entry timeout keeps a board notice hidden while skipping owns navigation', () => {
  const { entry, main, core } = openBoard();
  vi.advanceTimersByTime(HANDOFF_TIMEOUT_MS + 1);
  expect(entry.loading).toBe(true);
  expect(main.classList.contains('stackEntryLoading')).toBe(true);
  core.boardNoteSkip.active = false;
  vi.advanceTimersByTime(HANDOFF_REACH_POLL_MS);
  expect(mounted.ended).toBe(true);
  expect(main.classList.contains('stackEntryLoading')).toBe(false);
});

test('ending entry cancels its deferred timeout', () => {
  const { entry, core } = openBoard();
  vi.advanceTimersByTime(HANDOFF_TIMEOUT_MS + 1);
  entry.end();
  core.view.setListLoading.mockClear();
  core.boardNoteSkip.active = false;
  vi.advanceTimersByTime(HANDOFF_TIMEOUT_MS);
  expect(core.view.setListLoading).not.toHaveBeenCalled();
});

test('an unowned unknown response retains the normal entry timeout', () => {
  const { entry } = openBoard({ skipping: false });
  vi.advanceTimersByTime(HANDOFF_TIMEOUT_MS + 1);
  expect(entry.loading).toBe(false);
  expect(mounted.ended).toBe(true);
});
