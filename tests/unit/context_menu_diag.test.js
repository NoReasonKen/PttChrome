// @unit-env browser
// real-input: tests/e2e/offline/mobile_revealed_context_menu.offline.spec.js
import { contextTargetKind, watchContextMenus } from '../../src/js/context_menu_diag';

const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

test('target categories never return DOM text or attributes', () => {
  const el = { nodeType: 1, closest: selector => selector === '[data-stack-layer="article"]' };
  expect(contextTargetKind(el)).toBe('revealed-article');
  expect(contextTargetKind({ nodeType: 3 })).toBe('other');
});

test('hold records late prevention and removal even after reinsertion without content', async () => {
  vi.useFakeTimers();
  const logs = [];
  const rec = { isRecording: true, log: (tag, info) => logs.push({ tag, info }) };
  const card = document.createElement('div');
  card.className = 'listCard';
  card.textContent = 'private content';
  const wrapper = document.createElement('div');
  wrapper.append(card);
  document.body.append(wrapper);
  const unwatch = watchContextMenus(rec, window);
  cleanups.push(unwatch, () => card.remove(), () => wrapper.remove());
  const prevent = e => e.preventDefault();
  card.addEventListener('pointerdown', prevent);
  card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true }));
  wrapper.remove();
  document.body.append(card);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(700);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ tag: 'contextMenu.contact', info: {
    phase: 'hold', target: 'list-card', targetConnected: true, ancestorsConnected: false,
    removedDuringContact: true, preventedEvents: ['pointerdown'], pointerCancelled: false, touchCancelled: false,
  } });
  expect(JSON.stringify(logs)).not.toContain('private content');
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
  await vi.advanceTimersByTimeAsync(30);
  expect(logs[1].info.phase).toBe('end');
  unwatch();
  card.remove();
  vi.useRealTimers();
});

test('stopping recording or unwatching clears an unfinished contact', async () => {
  vi.useFakeTimers();
  const logs = [];
  const rec = { isRecording: true, log: (tag, info) => logs.push({ tag, info }) };
  const card = document.createElement('div');
  document.body.append(card);
  const unwatch = watchContextMenus(rec, window);
  cleanups.push(unwatch, () => card.remove());
  const down = () => card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true }));
  down();
  rec.isRecording = false;
  await vi.advanceTimersByTimeAsync(700);
  rec.isRecording = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(logs).toEqual([]);
  down();
  unwatch();
  await vi.advanceTimersByTimeAsync(6000);
  expect(logs).toEqual([]);
  card.remove();
  vi.useRealTimers();
});

test('pointer cancellation stays active until touch ends and ignores another pointer', async () => {
  vi.useFakeTimers();
  const logs = [];
  const rec = { isRecording: true, log: (tag, info) => logs.push({ tag, info }) };
  const card = document.createElement('div');
  document.body.append(card);
  const unwatch = watchContextMenus(rec, window);
  cleanups.push(unwatch, () => card.remove());
  const pointer = (type, id) => new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: id, isPrimary: true });
  const touch = (type, id) => new TouchEvent(type, { bubbles: true, changedTouches: [new Touch({ identifier: id, target: card })] });
  card.dispatchEvent(pointer('pointerdown', 7));
  card.dispatchEvent(touch('touchstart', 11));
  window.dispatchEvent(pointer('pointerup', 8));
  window.dispatchEvent(touch('touchend', 12));
  window.dispatchEvent(pointer('pointercancel', 7));
  await vi.advanceTimersByTimeAsync(700);
  expect(logs).toHaveLength(1);
  expect(logs[0].info).toMatchObject({ phase: 'hold', pointerCancelled: true });
  window.dispatchEvent(new Event('touchend', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(30);
  expect(logs[1].info).toMatchObject({ phase: 'end', pointerCancelled: true });
});

test('short touch cancellation is recorded', async () => {
  vi.useFakeTimers();
  const logs = [];
  const rec = { isRecording: true, log: (tag, info) => logs.push({ tag, info }) };
  const card = document.createElement('div');
  document.body.append(card);
  const unwatch = watchContextMenus(rec, window);
  cleanups.push(unwatch, () => card.remove());
  card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true }));
  window.dispatchEvent(new Event('touchcancel', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(30);
  expect(logs[0].info).toMatchObject({ phase: 'end', touchCancelled: true });
});

test('unwatch immediately drops old contact and deferred context menu after restart', async () => {
  vi.useFakeTimers();
  const logs = [];
  const rec = { isRecording: true, log: (tag, info) => logs.push({ tag, info }) };
  const card = document.createElement('div');
  document.body.append(card);
  const unwatch = watchContextMenus(rec, window);
  cleanups.push(unwatch, () => card.remove());
  card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true }));
  card.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));
  unwatch();
  const unwatchNew = watchContextMenus(rec, window);
  cleanups.push(unwatchNew);
  await vi.advanceTimersByTimeAsync(5000);
  expect(logs).toEqual([]);
});

test('recording captures final prevention and stops observing when disabled', async () => {
  const logs = [];
  const rec = { isRecording: true, log: (tag, info) => { if (rec.isRecording) logs.push({ tag, info }); } };
  const win = new EventTarget();
  const unwatch = watchContextMenus(rec, win);
  win.addEventListener('contextmenu', e => e.preventDefault());
  win.dispatchEvent(new Event('contextmenu', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(logs).toHaveLength(1);
  expect(logs[0].info).toMatchObject({ target: 'other', preventedAtCapture: false, preventedFinal: true });
  rec.isRecording = false;
  win.dispatchEvent(new Event('contextmenu'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(logs).toHaveLength(1);
  unwatch();
});
