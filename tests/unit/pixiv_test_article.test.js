// @unit-env browser
import { installPixivTestStorage, pixivTestArticleBytes, startPixivTestArticle } from '../../src/dev/pixiv_test_article';
import { readValuesWithDefault } from '../../src/js/pref_storage';
import { b2u } from '../../src/js/string_util';
import { loadBig5Tables } from './helpers/load_big5_tables';

loadBig5Tables();

test('the local article uses isolated storage without reading or overwriting saved credentials and recovery data', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const original = window.localStorage;
  original.setItem('pttchrome.pref.v1', JSON.stringify({ values: { autoLoginUser: 'private-account' } }));
  original.setItem('recovery-sentinel', 'preserve');
  const bridge = window.PttAndroid;
  try {
    const storage = installPixivTestStorage();
    expect(window.localStorage).toBe(storage);
    expect(readValuesWithDefault()).toMatchObject({ autoLogin: false, autoLoginUser: '',
      autoLoginPassword: '', autoLoginOtpSecret: '', enablePixivLookup: true,
      resumeLastPlace: false, reconnectResume: false });
    expect(storage.getItem('recovery-sentinel')).toBeNull();
    storage.setItem('recovery-sentinel', 'temporary');
    storage.removeItem('pttchrome.pref.v1');
    expect(original.getItem('pttchrome.pref.v1')).toContain('private-account');
    expect(original.getItem('recovery-sentinel')).toBe('preserve');
    expect(window.PttAndroid).toBe(bridge);
  } finally {
    if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    else delete window.localStorage;
    original.clear();
  }
});

test('the article includes isolated user and artwork IDs and a recognized bottom status row at the actual terminal height', () => {
  for (const rows of [24, 38]) {
    const text = b2u(pixivTestArticleBytes(rows));
    for (const id of ['117918634', '105176734', '65964428', '65847159', '151615046', '151656533', '146814133'])
      expect(text).toContain(id);
    expect(text).toContain('Local test article. No PTT connection.');
    expect(text).toContain(`\x1b[${rows};1H  瀏覽 第 1/1 頁 (100%)`);
    expect(text.endsWith(`\x1b[${rows};80H`)).toBe(true);
    expect(text).toContain('(65964428) ID65964428 65964428.');
  }
});

test('booting the article keeps terminal sends inert and completes only after the actual reading screen settles', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const windowEl = document.createElement('div');
  windowEl.id = 'BBSWindow';
  document.body.append(windowEl);
  const listeners = new Set();
  const app = {
    connect: vi.fn(),
    view: { setConn: vi.fn(), useEasyReadingMode: false },
    buf: { rows: 24, pageState: 0, addEventListener: (_, fn) => listeners.add(fn),
      removeEventListener: (_, fn) => listeners.delete(fn) },
    onValuesPrefChange: vi.fn(), onWindowResize: vi.fn(), onData: vi.fn(),
    easyReading: { enterEasyReading: vi.fn() },
  };
  try {
    installPixivTestStorage();
    const ready = startPixivTestArticle(app);
    expect(app.conn.isConnected).toBe(false);
    expect(app.connect()).toBeUndefined();
    expect(app.conn.send('private-terminal-command')).toBeUndefined();
    expect(app.onData).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.pixivTestArticle).toBe('loading');
    for (const fn of [...listeners]) fn();
    expect(app.easyReading.enterEasyReading).not.toHaveBeenCalled();
    app.buf.pageState = 3;
    app.easyReading.enterEasyReading.mockImplementation(() => { app.view.useEasyReadingMode = true; });
    for (const fn of [...listeners]) fn();
    expect(app.easyReading.enterEasyReading).toHaveBeenCalledOnce();
    await ready;
    expect(listeners.size).toBe(0);
    expect(document.documentElement.dataset.pixivTestArticle).toBe('ready');
  } finally {
    windowEl.remove();
    delete document.documentElement.dataset.pixivTestArticle;
    if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    else delete window.localStorage;
  }
});
