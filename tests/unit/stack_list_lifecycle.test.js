// @unit-env browser
// real-input: tests/e2e/offline/mobile_gesture_latency.offline.spec.js
import { StackListLayer } from '../../src/js/stack_list_layer';
import { mountScreen, unmountAll } from './helpers/mount_screen';
import { row, seg, listRow } from './helpers/screen_fixtures';

const layers = [];

afterEach(() => {
  layers.splice(0).forEach(layer => layer.destroy());
  unmountAll();
});

function captureList({ cards = false } = {}) {
  const mounted = mountScreen({
    lines: [row(seg('Board Test')), row(seg('columns')), row(seg('')),
      ...Array.from({ length: 30 }, (_, i) => listRow('reader', `□ [Talk] Article ${i}`)), row(seg('footer'))],
    enhance: {
      pageState: 2, listEasyReading: true, easyReading: true, listCards: cards ? 'article' : undefined,
      listScroll: { kind: 'article', bodyStart: 3, viewportPx: 300, scrollable: true }
    }
  });
  Object.assign(mounted.root.style, { width: '360px', height: '400px', fontSize: '20px', lineHeight: '20px' });
  if (cards) mounted.root.classList.add('mobileListCards');
  const view = {
    mainDisplay: mounted.root, componentScreen: mounted.controller, chh: 20,
    innerBounds: { height: 400 }, topInset: 0, keyboardInset: 0,
    listCardViewportPx: () => 300
  };
  const layer = StackListLayer.capture(view);
  expect(layer).not.toBeNull();
  layers.push(layer);
  return { layer, view };
}

test('finishing entry after its list was destroyed never reconnects the layer', () => {
  const { layer } = captureList();
  layer.show(false);
  layer.destroy();
  expect(() => layer.hide()).not.toThrow();
  expect(layer.el.isConnected).toBe(false);
  expect(layer.el.hasAttribute('data-stack-parked')).toBe(false);
  expect(() => {
    layer.show(false);
    layer.prepare();
    layer.park();
    layer.destroy();
  }).not.toThrow();
  expect(layer.fitViewport()).toBe(false);
  expect(layer.follow({}, false)).toBe(false);
  expect(layer.alignReal({})).toBe(false);
  expect(layer.tapOf({})).toBeNull();
  expect(() => layer.openTapped({}, {})).not.toThrow();
  expect(layer.el.isConnected).toBe(false);
});

test('hiding a revealed list detaches it without replacing the prepared next list', () => {
  const { layer, view } = captureList();
  const next = StackListLayer.capture(view);
  layers.push(next);
  next.prepare();
  layer.show(false);
  layer.hide();
  expect(layer.el.isConnected).toBe(false);
  expect(next.el.isConnected).toBe(true);
  expect(next.el.hasAttribute('data-stack-parked')).toBe(true);
});

test('preparing beneath a shorter article keeps the captured list geometry', async () => {
  const { layer, view } = captureList();
  view.mainDisplay.style.height = '200px';
  layer.prepare();
  // Let the real observer deliver its initial notification and its work paint.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(layer.el.style.height).toBe('400px');
  view.mainDisplay.style.height = '160px';
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(layer.el.style.height).toBe('400px');
});

test('a width and font change prepares the list box instead of the article box', async () => {
  const { layer, view } = captureList({ cards: true });
  const captured = layer.frame.enhance.listScroll;
  Object.assign(view, {
    innerBounds: { height: 600 }, topInset: 64, keyboardInset: 236,
    listCardViewportPx: () => 480, chh: 24
  });
  Object.assign(view.mainDisplay.style, { width: '320px', height: '300px', marginTop: '64px' });
  layer.prepare();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(layer.el.style.width).toBe('320px');
  expect(layer.el.style.height).toBe('480px');
  expect(layer.el.style.fontSize).toBe('24px');
  expect(layer.el.querySelector('.listBodyView').style.height).toBe('480px');
  const origin = view.mainDisplay.getBoundingClientRect().top - 64;
  expect(layer.el.getBoundingClientRect().top).toBeCloseTo(origin - 116, 1);
  expect(captured.viewportPx).toBe(300);
});

test('a keyboard-only fit during a drag never shifts the layer sideways', () => {
  const { layer, view } = captureList({ cards: true });
  layer.show(false);
  const before = layer.el.getBoundingClientRect().left;
  // A canceled exit can fit its lower page before releasing the foreground.
  view.mainDisplay.style.translate = '100px 0';
  view.keyboardInset = 200;
  expect(layer.fitViewport()).toBe(true);
  expect(layer.el.getBoundingClientRect().left).toBe(before);
});

test('a width change during a drag keeps the lower list horizontally stationary', () => {
  const { layer, view } = captureList({ cards: true });
  layer.show(false);
  const before = layer.el.getBoundingClientRect().left;
  view.mainDisplay.style.translate = '100px 0';
  view.mainDisplay.style.width = '320px';
  expect(layer.fitViewport()).toBe(true);
  expect(layer.el.getBoundingClientRect().left).toBe(before);
});
