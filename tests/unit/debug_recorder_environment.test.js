// @unit-env browser
// real-input: tests/e2e/offline/mobile_recording_environment.offline.spec.js
import { DebugRecorder, recordingEnvironment } from '../../src/js/debug_recorder';

function makeApp() {
  return {
    mobile: true,
    mobileFontPx: 18,
    buf: { cols: 80, rows: 45 },
    view: {
      chw: 9, chh: 18, scaleX: 1, scaleY: 1,
      useEasyReadingMode: true, reflow: true,
    },
    onData() {},
    conn: { _sendRaw() {} },
  };
}

const environments = recorder => recorder.events.filter(event => event.tag === 'record.environment');

describe('recording environment', () => {
  const active = [];
  let frames;
  let observers;
  let mutations;
  let visualViewport;

  beforeEach(() => {
    frames = new Map();
    observers = [];
    mutations = [];
    visualViewport = Object.assign(new EventTarget(), {
      width: 412, height: 840, scale: 1, offsetLeft: 0, offsetTop: 0,
    });
    vi.stubGlobal('innerWidth', 412);
    vi.stubGlobal('innerHeight', 840);
    vi.stubGlobal('devicePixelRatio', 2.625);
    vi.stubGlobal('visualViewport', visualViewport);
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', callback => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        observers.push(this);
      }
    });
    vi.stubGlobal('MutationObserver', class {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        mutations.push(this);
      }
    });
  });

  afterEach(() => {
    for (const recorder of active.splice(0)) recorder.stop();
    vi.unstubAllGlobals();
  });

  function start(app = makeApp()) {
    const recorder = new DebugRecorder(app);
    active.push(recorder);
    recorder.start();
    return recorder;
  }

  function flushFrame() {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback();
  }

  it('records only numeric geometry and rendering flags, without reading preferences or DOM layout', () => {
    const app = makeApp();
    Object.defineProperty(app, 'prefs', { get() { throw new Error('private preferences'); } });
    app.view.mainDisplay = {
      getBoundingClientRect() { throw new Error('layout read'); },
      innerText: 'private article text',
    };
    const env = recordingEnvironment(app);
    expect(env).toEqual({
      viewport: { width: 412, height: 840, dpr: 2.625 },
      visualViewport: { width: 412, height: 840, scale: 1, offsetLeft: 0, offsetTop: 0 },
      terminal: { cols: 80, rows: 45, cellWidth: 9, cellHeight: 18, scaleX: 1, scaleY: 1, mobileFontPx: 18 },
      reading: { mobile: true, easyReading: true, reflow: true, listCards: false, gridRender: false },
    });
    expect(JSON.stringify(env)).not.toContain('private');
  });

  it('keeps missing and nonnumeric values explicit without copying arbitrary data', () => {
    const app = makeApp();
    app.view.chh = Infinity;
    app.mobileFontPx = 'private';
    expect(recordingEnvironment(app, null)).toMatchObject({
      viewport: { width: null, height: null, dpr: null },
      visualViewport: null,
      terminal: { cellHeight: null, mobileFontPx: null },
    });
  });

  it('captures the initial environment and keeps initial terminal dimensions after rotation', () => {
    const app = makeApp();
    const recorder = start(app);
    const initial = environments(recorder)[0].info;
    app.buf.rows = 24;
    vi.stubGlobal('innerWidth', 840);
    vi.stubGlobal('innerHeight', 412);
    window.dispatchEvent(new Event('resize'));
    flushFrame();
    const output = JSON.parse(recorder.stop());
    expect(output.cassette.meta.environment).toEqual(initial);
    expect(output.cassette.rows).toBe(45);
    expect(output.cassette.cols).toBe(80);
    expect(output.events.filter(event => event.tag === 'record.environment')).toHaveLength(2);
  });

  it('coalesces resize signals, skips unchanged environments and captures later effective layout', () => {
    const app = makeApp();
    app.view.mainDisplay = document.createElement('div');
    const recorder = start(app);
    expect(observers[0].observe).toHaveBeenCalledWith(app.view.mainDisplay);
    app.onData('first receive');
    app.conn._sendRaw('first send');
    expect(environments(recorder)).toHaveLength(1);

    window.dispatchEvent(new Event('resize'));
    visualViewport.dispatchEvent(new Event('resize'));
    observers[0].callback();
    expect(frames.size).toBe(1);
    flushFrame();
    expect(environments(recorder)).toHaveLength(1);

    visualViewport.height = 400;
    visualViewport.scale = 1.5;
    visualViewport.dispatchEvent(new Event('resize'));
    flushFrame();
    expect(environments(recorder)[1].info.visualViewport).toMatchObject({ height: 400, scale: 1.5 });

    app.buf.rows = 24;
    app.view.chh = 16;
    observers[0].callback();
    flushFrame();
    expect(environments(recorder)[2].info.terminal).toMatchObject({ rows: 24, cellHeight: 16 });
  });

  it('preserves the final environment when stopping before a queued sample runs', () => {
    const app = makeApp();
    const recorder = start(app);
    vi.stubGlobal('innerWidth', 840);
    app.view.chh = 20;
    window.dispatchEvent(new Event('resize'));
    expect(frames.size).toBe(1);
    const capture = JSON.parse(recorder.stop());
    expect(capture.events.filter(event => event.tag === 'record.environment').at(-1).info).toMatchObject({
      viewport: { width: 840 }, terminal: { cellHeight: 20 },
    });
    expect(capture.cassette.meta.environment.viewport.width).toBe(412);
    expect(frames.size).toBe(0);
  });

  it('disconnects all resize sources and cancels a pending sample on stop', () => {
    const app = makeApp();
    app.view.mainDisplay = document.createElement('div');
    const recorder = start(app);
    window.dispatchEvent(new Event('resize'));
    expect(frames.size).toBe(1);
    recorder.stop();
    const count = recorder.events.length;
    expect(frames.size).toBe(0);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(mutations[0].disconnect).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('resize'));
    visualViewport.dispatchEvent(new Event('resize'));
    mutations[0].callback();
    expect(frames.size).toBe(0);
    expect(recorder.events).toHaveLength(count);

    recorder.start();
    expect(environments(recorder)).toHaveLength(1);
    visualViewport.height = 350;
    visualViewport.dispatchEvent(new Event('resize'));
    expect(frames.size).toBe(1);
    flushFrame();
    expect(environments(recorder)).toHaveLength(2);
  });

  it('captures effective font changes even when the outer reading box stays fixed', () => {
    const app = makeApp();
    const main = app.view.mainDisplay = document.createElement('div');
    main.style.cssText = 'width: 300px; height: 500px';
    const recorder = start(app);
    expect(mutations[0].observe).toHaveBeenCalledWith(main, {
      attributes: true, attributeFilter: ['style', 'class'],
    });
    app.mobileFontPx = 20;
    app.view.chh = 20;
    app.view.chw = 10;
    app.buf.rows = 38;
    main.style.fontSize = '20px';
    mutations[0].callback();
    mutations[0].callback();
    expect(frames.size).toBe(1);
    flushFrame();
    expect(main.style.width).toBe('300px');
    expect(main.style.height).toBe('500px');
    expect(environments(recorder)[1].info.terminal).toMatchObject({
      cellHeight: 20, cellWidth: 10, rows: 38, mobileFontPx: 20,
    });
  });

  it('starts an independent event timeline and environment when reusing a stopped recorder', () => {
    const app = makeApp();
    const recorder = start(app);
    app.onData('previous recording');
    const first = recorder.stop();
    app.buf.rows = 24;
    app.mobileFontPx = 20;
    recorder.start();
    recorder.start();
    app.onData('current recording');
    const second = JSON.parse(recorder.stop());
    expect(second.events.filter(event => event.tag === 'record.start')).toHaveLength(1);
    expect(second.events.filter(event => event.tag === 'record.environment')).toHaveLength(1);
    expect(second.cassette.rows).toBe(24);
    expect(second.cassette.meta.environment.terminal.mobileFontPx).toBe(20);
    expect(second.events.filter(event => event.dir === 'recv').map(event => atob(event.data)))
      .toEqual(['current recording']);
    expect(JSON.parse(first).cassette.rows).toBe(45);
    expect(JSON.parse(first).events.filter(event => event.dir === 'recv').map(event => atob(event.data)))
      .toEqual(['previous recording']);
  });
});
