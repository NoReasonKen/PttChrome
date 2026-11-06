import { applyCassetteTermSize, applyRecordedViewport } from '../e2e/helpers/replay.js';

let page;
let app;
beforeEach(() => {
  app = { buf: { cols: 80, rows: 24 }, onValuesPrefChange: vi.fn() };
  vi.stubGlobal('window', { __app: app, __readPrefs: () => ({}), innerWidth: 412, innerHeight: 390 });
  page = {
    evaluate: vi.fn(async (fn, argument) => fn(argument)),
    waitForFunction: vi.fn(async (fn, argument) => {
      expect(fn(argument)).toBe(true);
    }),
  };
});
afterEach(() => vi.unstubAllGlobals());

test('default recording dimensions are checked without changing the terminal preferences', async () => {
  await applyCassetteTermSize(page, { cols: 80, rows: 24 });
  expect(app.onValuesPrefChange).not.toHaveBeenCalled();
  expect(page.evaluate).toHaveBeenCalled();
});

test('an incompatible viewport fails with recorded and actual geometry instead of silently replaying', async () => {
  app.buf.rows = 52;
  window.innerHeight = 850;
  await expect(applyCassetteTermSize(page, { cols: 80, rows: 24 })).rejects.toThrow(
    /cassette 80x24.*terminal 80x52.*viewport 412x850/,
  );
  expect(app.onValuesPrefChange).not.toHaveBeenCalled();
});

test('legacy recordings without dimensions still require the default terminal size', async () => {
  app.buf.rows = 25;
  await expect(applyCassetteTermSize(page, {})).rejects.toThrow(/cassette 80x24.*terminal 80x25/);
});

test('native static replay may explicitly use a larger terminal', async () => {
  app.buf.rows = 49;
  await applyCassetteTermSize(page, { cols: 80, rows: 24 }, { allowLargerTerminal: true });
  expect(app.onValuesPrefChange).not.toHaveBeenCalled();
});

test.each([{ cols: 79, rows: 49 }, { cols: 80, rows: 23 }])(
  'the larger-terminal exception never permits clamping: %j', async dimensions => {
    Object.assign(app.buf, dimensions);
    await expect(applyCassetteTermSize(page, { cols: 80, rows: 24 }, { allowLargerTerminal: true }))
      .rejects.toThrow(/Replay terminal size mismatch/);
  },
);

test.each([28, 48])('non-default recordings retain preference-based sizing for %i rows', async rows => {
  app.onValuesPrefChange.mockImplementation(prefs => Object.assign(app.buf, prefs.termSize));
  await applyCassetteTermSize(page, { cols: 80, rows });
  expect(app.onValuesPrefChange).toHaveBeenCalledWith({ termSizeMode: 'fixed-term-size', termSize: { cols: 80, rows } });
  expect(page.waitForFunction).toHaveBeenCalled();
});

describe('captured CSS viewport', () => {
  const portrait = { viewport: { width: 412, height: 840, dpr: 3 }, terminal: { rows: 45, cols: 80 } };
  const landscape = { viewport: { width: 840, height: 412, dpr: 3 }, terminal: { rows: 22, cols: 80 } };
  const event = (t, info) => ({ t, dir: 'log', tag: 'record.environment', info });

  test('uses initial metadata before boot and the latest environment at the requested time', async () => {
    const target = { setViewportSize: vi.fn() };
    const capture = { cassette: { meta: { environment: portrait } }, events: [event(10, portrait), event(100, landscape)] };
    expect(await applyRecordedViewport(target, capture)).toEqual(portrait);
    expect(target.setViewportSize).toHaveBeenLastCalledWith({ width: 412, height: 840 });
    expect(await applyRecordedViewport(target, capture, { at: 100 })).toEqual(landscape);
    expect(target.setViewportSize).toHaveBeenLastCalledWith({ width: 840, height: 412 });
    expect(await applyRecordedViewport(target, capture, { at: 99 })).toEqual(portrait);
    expect(app.onValuesPrefChange).not.toHaveBeenCalled();
  });

  test('leaves older captures untouched rather than guessing their viewport', async () => {
    const target = { setViewportSize: vi.fn() };
    expect(await applyRecordedViewport(target, {})).toBeNull();
    expect(target.setViewportSize).not.toHaveBeenCalled();
  });

  test.each([null, { width: 0, height: 840 }, { width: 412.5, height: 840 }, { width: '412', height: 840 }])(
    'rejects malformed recorded geometry: %j', async viewport => {
      const target = { setViewportSize: vi.fn() };
      await expect(applyRecordedViewport(target, { meta: { environment: { viewport } } })).rejects.toThrow('invalid CSS viewport');
      expect(target.setViewportSize).not.toHaveBeenCalled();
    },
  );
});
