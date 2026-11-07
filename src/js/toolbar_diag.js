// What a debug recording keeps of the bottom toolbar (#119): each contact
// and click on it, each context it is given and renders, and what each action
// did. A tap that does nothing on a device can then be told apart: no click,
// a click on a disabled or replaced button, a context swapped under the
// finger, or an action remembered and dropped. Entries carry button keys,
// states and ids only, never screen text.

const contextIds = new WeakMap();
const layerIds = new WeakMap();
let nextContextId = 1;
let nextLayerId = 1;

function recorder(core) {
  const rec = core?.debugRecorder;
  return rec?.isRecording ? rec : null;
}

// Logs `info` under `toolbar.<event>` while a recording runs.
export function toolbarDiag(core, event, info) {
  recorder(core)?.log('toolbar.' + event, info);
}

// The id of a toolbar context object, given when the App first computes it.
export function toolbarContextId(context) {
  if (!context || typeof context !== 'object') return null;
  let id = contextIds.get(context);
  if (!id) {
    id = nextContextId++;
    contextIds.set(context, id);
  }
  return id;
}

function layerId(layer) {
  if (!layer) return null;
  let id = layerIds.get(layer);
  if (!id) {
    id = nextLayerId++;
    layerIds.set(layer, id);
  }
  return id;
}

// Where the toolbar context now comes from: a revealed page's saved context
// ('layer'), the locked fallback of a revealed page without one
// ('layerLocked'), a cover shown over the screen ('cover'), or the real page.
export function toolbarContextSource(core) {
  const stack = core?.articleGestures?.stack;
  if (stack && (stack.gone || stack.handoff)) return stack.handoff?.layer && stack.handoff.toolbar ? 'layer' : 'layerLocked';
  const covered = core && ((core.threadJump && core.threadJump.toolbarContext()) ||
    (core.headerlessReopen && core.headerlessReopen.toolbarContext()) ||
    (core.articleShortcutSearch && core.articleShortcutSearch.toolbarContext()));
  return covered ? 'cover' : 'page';
}

// The handoff as the toolbar sees it.
export function handoffState(core) {
  const stack = core?.articleGestures?.stack;
  const h = stack?.handoff;
  return {
    handingOff: !!h, presented: !!h && h.presentedAt != null, layer: layerId(stack?.shownLayer?.() || null),
    remembered: !!h?.action, gone: !!stack?.gone
  };
}

// A context the App now gives the toolbar.
export function logToolbarContext(core, prev, next) {
  if (!recorder(core)) return;
  toolbarDiag(core, 'context', {
    from: toolbarContextId(prev), to: toolbarContextId(next), source: toolbarContextSource(core),
    locked: !!next?.locked, end: !!next?.end, refresh: !!next?.refresh, push: !!next?.push, reply: !!next?.reply,
    ...handoffState(core)
  });
}

const INPUT_TYPES = ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'click'];

// How long after a contact on the toolbar a click elsewhere is still logged:
// the browser may send a tap's click to whatever is under it by then.
const STRAY_CLICK_MS = 1000;

// An element named by its tag, id and first class, never its text.
function describe(el) {
  if (!el) return null;
  const cls = typeof el.className === 'string' ? el.className.split(/\s+/).find(Boolean) : null;
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
}

// Records every contact and click on #mobileToolbar, in the capture phase,
// before any handler can stop it.
export function installToolbarDiagnostics(core, win = typeof window === 'undefined' ? null : window) {
  if (!win) return () => {};
  let lastUpAt = -Infinity;
  const onInput = event => {
    if (!recorder(core)) return;
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const root = target?.closest?.('#mobileToolbar');
    if (!root) {
      if (event.type === 'click' && performance.now() - lastUpAt < STRAY_CLICK_MS) {
        toolbarDiag(core, 'strayClick', {
          trusted: event.isTrusted, target: describe(target), ms: Math.round(performance.now() - lastUpAt), prevented: event.defaultPrevented
        });
      }
      return;
    }
    if (event.type === 'pointerup') lastUpAt = performance.now();
    const button = target.closest('[data-key], [data-slot-empty]');
    toolbarDiag(core, 'input', {
      type: event.type, trusted: event.isTrusted, cancelable: event.cancelable, pointer: event.pointerType || null, primary: event.isPrimary ?? null,
      key: button?.getAttribute('data-key') || (button ? 'slot' + button.getAttribute('data-slot-empty') : null),
      element: target.tagName.toLowerCase(), disabled: !!button?.disabled, connected: !!button?.isConnected,
      x: Number.isFinite(event.clientX) ? Math.round(event.clientX) : null,
      y: Number.isFinite(event.clientY) ? Math.round(event.clientY) : null, prevented: event.defaultPrevented,
      rendered: Number(root.getAttribute('data-context-id')) || null, current: toolbarContextId(core._screenContext),
      source: toolbarContextSource(core), ...handoffState(core)
    });
  };
  const options = { capture: true, passive: true };
  for (const type of INPUT_TYPES) win.addEventListener(type, onInput, options);
  return () => INPUT_TYPES.forEach(type => win.removeEventListener(type, onInput, options));
}
