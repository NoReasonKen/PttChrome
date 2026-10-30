import { vi, beforeEach, afterEach, test, expect } from 'vitest';

const bridge = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/js/android_bridge', () => ({
  androidBridgeAvailable: () => true,
  requestAndroid: bridge.request,
}));
let runtime;
let nativeState;
let stop;
let checkpoint;
beforeEach(async () => {
  vi.resetModules();
  const host = new EventTarget();
  host.__PTT_ANDROID__ = {};
  vi.stubGlobal('window', host);
  const page = new EventTarget();
  page.hidden = false;
  vi.stubGlobal('document', page);
  nativeState = { supported: true, phase: 'downloading', release: { id: 'test-release' } };
  bridge.request.mockReset().mockImplementation(async () => ({ ok: true, state: { ...nativeState } }));
  runtime = await import('../../src/js/app_updates.js');
  await runtime.updateAction('state');
  checkpoint = vi.fn();
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); });

test('foreground verification opens the installer once and saves the reading checkpoint', async () => {
  stop = runtime.startUpdateRuntime({ reconnectResume: { saveSnapshot: checkpoint } });
  await vi.waitFor(() => expect(bridge.request).toHaveBeenCalledWith('update', expect.objectContaining({ action: 'check' })));
  nativeState.phase = 'ready';
  await runtime.updateAction('state');
  await vi.waitFor(() => expect(bridge.request.mock.calls.filter(([, p]) => p.action === 'install')).toHaveLength(1));
  await runtime.updateAction('state');
  expect(bridge.request.mock.calls.filter(([, p]) => p.action === 'install')).toHaveLength(1);
  expect(checkpoint).toHaveBeenCalledWith({ lifecycle: true });
});

test('background completion does not open the installer or steal focus on return', async () => {
  stop = runtime.startUpdateRuntime({});
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  nativeState.phase = 'ready';
  await runtime.updateAction('state');
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(bridge.request.mock.calls.some(([, p]) => p.action === 'install')).toBe(false);
});

test('tapping a completion notification opens the retained installer', async () => {
  nativeState.phase = 'ready';
  await runtime.updateAction('state');
  stop = runtime.startUpdateRuntime({});
  window.dispatchEvent(new Event('pttandroid:update-open'));
  await vi.waitFor(() => expect(bridge.request.mock.calls.some(([, p]) => p.action === 'install')).toBe(true));
});

test('an already retained update does not repeatedly open installation on startup', async () => {
  nativeState.phase = 'ready';
  await runtime.updateAction('state');
  stop = runtime.startUpdateRuntime({});
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(bridge.request.mock.calls.some(([, p]) => p.action === 'install')).toBe(false);
});


test('verification failure never reaches installation', async () => {
  stop = runtime.startUpdateRuntime({});
  nativeState.phase = 'error';
  await runtime.updateAction('state');
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(bridge.request.mock.calls.some(([, p]) => p.action === 'install')).toBe(false);
});
