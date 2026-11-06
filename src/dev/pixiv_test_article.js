import { DEFAULT_PREFS, readEffectivePrefs } from '../js/pref_storage';
import { u2b } from '../js/string_util';

// Local acceptance only: do not read, clear or rewrite the owner's real data.
// Keeping this before new App also isolates recovery/reading-record writes.
export function installPixivTestStorage(target = window) {
  const entries = new Map();
  const storage = {
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(String(key)) ?? null; },
    setItem(key, value) { entries.set(String(key), String(value)); },
    removeItem(key) { entries.delete(String(key)); },
    clear() { entries.clear(); },
  };
  storage.setItem('pttchrome.pref.v1', JSON.stringify({ values: {
    ...DEFAULT_PREFS,
    nativeSafeMode: false,
    autoLogin: false,
    autoLoginUser: '',
    autoLoginPassword: '',
    autoLoginOtpSecret: '',
    resumeLastPlace: false,
    reconnectResume: false,
    enablePixivLookup: true,
    enableEasyReading: true,
    enableEasyReadingList: false,
    enableBoardListSmoothScroll: false,
    enableHomeDashboard: false,
    enableSplitReading: false,
    enableArticleTools: false,
    enableCommentBar: false,
    enableNextArticleCard: false,
    enableNotifications: false,
    articleHorizontalGestures: false,
  } }));
  Object.defineProperty(target, 'localStorage', { configurable: true, value: storage });
  return storage;
}

export function pixivTestArticleBytes(rows = 24) {
  if (!Number.isInteger(rows) || rows < 18) throw new Error('The test article needs at least 18 terminal rows.');
  const lines = {
    0: '作者  fixtureReader (Pixiv Test) 看板 Test',
    1: '標題  [Test] Pixiv previews - local test article',
    2: '時間  Fri Nov 6 12:00:00 2026',
    4: 'Local test article. No PTT connection.',
    5: 'Users (tap the numbers):',
    6: '117918634 105176734 65964428',
    8: 'Artworks (tap the numbers):',
    9: '65847159 151615046 151656533',
    10: '146814133',
    12: 'Not links: (65964428) ID65964428 65964428.',
    14: '推 fixtureReader: 105176734                                    11/06 12:34',
    [rows - 1]: '  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~17 行  (y)回應(X%)推文(h)說明(←)離開 ',
  };
  let bytes = '\x1b[2J';
  for (const [row, text] of Object.entries(lines)) bytes += `\x1b[${Number(row) + 1};1H${u2b(text)}`;
  return `${bytes}\x1b[${rows};80H`;
}

export function startPixivTestArticle(app) {
  const noop = () => {};
  // Keep every terminal send inert, including a manual reconnect. The Android
  // bridge stays untouched, so Pixiv metadata and images are still real.
  app.connect = noop;
  app.conn = { isConnected: false, send: noop, convSend: noop,
    sendUserKey: noop, convSendUserKey: noop, sendNaws: noop, close: noop };
  app.connectState = 0;
  app.connectedUrl = { site: 'pixiv-test.invalid', easyReadingSupported: true, opened: false };
  app.view.setConn(app.conn);
  app.onValuesPrefChange(readEffectivePrefs());
  document.getElementById('BBSWindow').style.display = '';
  app.onWindowResize({ immediate: true });
  document.documentElement.dataset.pixivTestArticle = 'loading';
  return new Promise(resolve => {
    const settled = () => {
      if (app.buf.pageState !== 3) return;
      if (!app.view.useEasyReadingMode) {
        app.easyReading.enterEasyReading();
      }
      if (!app.view.useEasyReadingMode) return;
      app.buf.removeEventListener('screenSettled', settled);
      document.documentElement.dataset.pixivTestArticle = 'ready';
      resolve();
    };
    app.buf.addEventListener('screenSettled', settled);
    app.onData(pixivTestArticleBytes(app.buf.rows));
  });
}
