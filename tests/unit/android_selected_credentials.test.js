// @unit-env browser
import { getAndroidCredentialStatus, saveAndroidCredentials } from '../../src/js/credential_store';
import { hideCredentialApi } from './helpers/credential_api';
import { AutoLogin, _resetSessionCredentialForTest } from '../../src/js/auto_login';
import { DEFAULT_PREFS } from '../../src/js/pref_storage';
import { packCredential } from '../../src/js/credential_pack';
import { setupI18n } from '../../src/js/i18n';

const empty = { user: false, password: false, otpSecret: false };
beforeAll(() => setupI18n());

afterEach(() => {
  _resetSessionCredentialForTest();
  hideCredentialApi();
  delete window.PttAndroid;
  delete window.__PTT_ANDROID__;
});

test('Android login uses the selected local entry and drops cached credentials after an explicit source change', async () => {
  let source = 'local';
  const sent = installHost(request => request.op === 'getCredentialStatus'
    ? { ok: true, source, local: { presence: { ...empty, user: true, password: true } }, manager: { presence: { ...empty, user: true, password: true } } }
    : { ok: true, source, user: source + '-reader', password: source === 'local' ? packCredential('local-pass', 'JBSWY3DPEHPK3PXP') : 'manager-pass' });
  const login = new AutoLogin({});
  const prefs = { ...DEFAULT_PREFS, autoLoginUser: 'legacy-reader', autoLoginPassword: 'legacy-pass', autoLoginOtpSecret: 'ABCDEFGHIJKLMNOP' };
  expect(await login._resolveCredential(prefs)).toMatchObject({ user: 'local-reader', pass: 'local-pass', otpSecret: 'JBSWY3DPEHPK3PXP' });
  source = 'manager';
  expect(await login._resolveCredential(prefs)).toMatchObject({ user: 'manager-reader', pass: 'manager-pass', otpSecret: '' });
  expect(sent.filter(request => request.op === 'getLoginCredential')).toHaveLength(2);
  expect(sent.some(request => request.op === 'getPassword' || request.op === 'storePassword')).toBe(false);
});

test.each(['missing', 'cancelled', 'unreadable', 'failed'])('Android %s never uses legacy plaintext or browser credentials and reports a visible failure', async error => {
  installHost(request => request.op === 'getCredentialStatus'
    ? { ok: true, source: 'local', local: { presence: empty }, manager: { presence: empty } }
    : { ok: false, source: 'local', error });
  const flashListHint = vi.fn();
  const login = new AutoLogin({ view: { flashListHint } });
  expect(await login._resolveCredential({ ...DEFAULT_PREFS, autoLoginUser: 'legacy', autoLoginPassword: 'must-not-send' })).toBeNull();
  expect(flashListHint).toHaveBeenCalledWith(expect.any(String), 6000, 'error');
});

function installHost(reply) {
  hideCredentialApi();
  const sent = [];
  window.__PTT_ANDROID__ = { encryptedCredentials: true };
  window.PttAndroid = {
    postMessage(text) {
      const request = JSON.parse(text);
      sent.push(request);
      queueMicrotask(() => window.PttAndroid.onmessage({ data: JSON.stringify({
        id: request.id, ...reply(request),
      }) }));
    },
  };
  return sent;
}

test('native source status exposes independent presence only, and source-only saving carries no credentials', async () => {
  const sent = installHost(request => request.op === 'getCredentialStatus'
    ? { ok: true, source: 'local', local: { presence: empty }, manager: { presence: { ...empty, user: true, password: true }, user: 'never-return' } }
    : { ok: true, source: 'manager', presence: { ...empty, user: true, password: true } });
  expect(await getAndroidCredentialStatus()).toEqual({
    source: 'local', local: { presence: empty }, manager: { presence: { ...empty, user: true, password: true } },
  });
  expect(await saveAndroidCredentials({ source: 'manager' })).toEqual({ status: 'saved', source: 'manager', presence: { ...empty, user: true, password: true } });
  expect(sent.map(({ id, ...request }) => request)).toEqual([
    { op: 'getCredentialStatus' }, { op: 'saveCredentials', source: 'manager' },
  ]);
});

test('an older APK is explicitly unavailable and cannot fall back to legacy plaintext or a browser store', async () => {
  const sent = installHost(() => { throw new Error('Unsupported APK must not request a credential'); });
  window.__PTT_ANDROID__ = { credentialSave: true };
  const flashListHint = vi.fn();
  const login = new AutoLogin({ view: { flashListHint } });
  expect(await login._resolveCredential({ ...DEFAULT_PREFS, autoLoginUser: 'legacy', autoLoginPassword: 'old-password' })).toBeNull();
  expect(flashListHint).toHaveBeenCalledWith(expect.any(String), 6000, 'error');
  expect(await saveAndroidCredentials({ source: 'local', id: 'new-reader', password: 'new-password' })).toEqual({ status: 'unavailable' });
  expect(sent).toEqual([]);
});

test('an unreadable selected source does not reuse a previously cached credential', async () => {
  let unreadable = false;
  const sent = installHost(request => request.op === 'getCredentialStatus'
    ? { ok: true, source: 'local', local: { presence: empty, ...(unreadable ? { error: 'unreadable' } : {}) }, manager: { presence: empty } }
    : { ok: true, source: 'local', user: 'local-reader', password: 'local-password' });
  const login = new AutoLogin({ view: { flashListHint: vi.fn() } });
  expect(await login._resolveCredential(DEFAULT_PREFS)).toMatchObject({ user: 'local-reader' });
  unreadable = true;
  expect(await login._resolveCredential(DEFAULT_PREFS)).toBeNull();
  expect(sent.filter(request => request.op === 'getLoginCredential')).toHaveLength(1);
});
