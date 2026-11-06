// Controlled native replies exercise the shared page without contacting Pixiv.
// On-device acceptance separately verifies the actual Android network bridge.
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function installPixivBridge(page, { supported = true, automatic = false } = {}) {
  await page.addInitScript(({ supported, automatic, image }) => {
    // This transport mock has no enrolled credentials; keep login outside the
    // preview/layout experiment instead of creating unrelated login hints.
    const saved = JSON.parse(localStorage.getItem('pttchrome.pref.v1') || '{}');
    saved.values = { ...saved.values, autoLogin: false };
    localStorage.setItem('pttchrome.pref.v1', JSON.stringify(saved));
    window.__PTT_ANDROID__ = { pixivLookup: supported, encryptedCredentials: true,
      credentialSave: true, credentialDeletion: true };
    const listeners = [];
    window.__pixivRequests = [];
    window.__pixivReply = (request, result, complete = true) => {
      const reply = { id: request.id, ok: true, complete,
        result: { kind: request.kind, query: request.query, state: 'found', name: 'Pixiv title', ...result } };
      for (const fn of listeners) fn({ data: JSON.stringify(reply) });
    };
    window.PttAndroid = {
      addEventListener: (_, fn) => listeners.push(fn),
      postMessage: raw => {
        const request = JSON.parse(raw);
        window.__pixivRequests.push(request);
        if (request.op === 'pixivLookup' && automatic) {
          queueMicrotask(() => window.__pixivReply(request, { imageData: image, width: 300, height: 500 }));
        } else if (request.op !== 'pixivLookup') {
          const presence = { user: false, password: false, otpSecret: false };
          queueMicrotask(() => listeners.forEach(fn => fn({ data: JSON.stringify({ id: request.id,
            ok: true, source: 'local', local: { presence }, manager: { presence } }) })));
        }
      },
    };
  }, { supported, automatic, image: IMAGE });
}

async function feedPixivArticle(page) {
  const { waitScreenSettled } = require('./replay');
  await page.evaluate(() => {
    const encode = text => [...text].map(ch => {
      const code = ch.charCodeAt(0);
      return code < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * code], window.lib.u2bArray[2 * code + 1]);
    }).join('');
    const rows = {
      0: '作者  reader123 (Reader) 看板 Test',
      1: '標題  [Test] Pixiv candidates',
      2: '時間  Fri Nov 6 12:00:00 2026',
      4: 'Artwork 65964428 and user 117918634',
      5: 'https://www.pixiv.net/artworks/146814133',
      6: '@artist123 #12345678 2026-11-06 12:34 127.0.0.1',
      7: '字65964428字 (65964428) 65964428， 65964428.',
      8: '推 reader123: 65847159                                         11/06 12:34',
      9: '推 reader123: 105176734                                        11/06 12:35',
      23: '  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~23 行  (y)回應(X%)推文(h)說明(←)離開 ',
    };
    let bytes = '\x1b[2J';
    for (const [row, text] of Object.entries(rows)) bytes += `\x1b[${Number(row) + 1};1H${encode(text)}`;
    window.__app.onData(`${bytes}\x1b[24;80H`);
  });
  await waitScreenSettled(page, { 0: '作者', 23: '瀏覽' });
  await page.evaluate(() => window.__app.easyReading.enterEasyReading());
}

async function expectPixivOverlayClosed(page) {
  const { expect } = require('@playwright/test');
  const ptt = require('./ptt');
  await ptt.applyPrefs(page, { enablePixivLookup: true });
  // The matrix varies the surrounding article, not candidate detection.
  await page.evaluate(() => window.__app.openPixivLookup('65964428'));
  await expect(page.locator('.PixivLookup')).toBeVisible();
  await expect(page.locator('[data-pixiv-kind="user"] img')).toBeVisible();
  await page.screenshot({ path: require('@playwright/test').test.info().outputPath('pixiv-overlay.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.PixivLookup')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__app.modalShown)).toBe(false);
}

module.exports = { installPixivBridge, feedPixivArticle, expectPixivOverlayClosed, IMAGE };
