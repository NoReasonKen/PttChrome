import { applyCassetteTermSize } from '../e2e/helpers/replay.js';

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
