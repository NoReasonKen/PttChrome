import { createRequire } from 'node:module';

const { installPixivBridge } = createRequire(import.meta.url)('../e2e/helpers/pixiv_lookup.js');

test('the Pixiv transport fixture seeds only non-sensitive preferences without reading saved credentials', async () => {
  const storage = {
    getItem: vi.fn(() => { throw new Error('Existing preferences must not be read'); }),
    setItem: vi.fn(),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', {});
  try {
    await installPixivBridge({ addInitScript: (initialize, options) => initialize(options) });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const [key, record] = storage.setItem.mock.calls[0];
    expect(key).toBe('pttchrome.pref.v1');
    expect(JSON.parse(record)).toEqual({ values: { autoLogin: false } });
    expect(window.__pixivRequests).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});
