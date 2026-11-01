// @unit-env browser
import * as preferences from '../../src/js/pref_storage';

const KEY = 'pttchrome.pref.v1';
const legacy = {
  autoLoginUser: 'legacy-reader',
  autoLoginPassword: 'synthetic-old-password',
  autoLoginOtpSecret: 'JBSWY3DPEHPK3PXP',
};

beforeEach(() => {
  localStorage.clear();
  window.__PTT_ANDROID__ = { encryptedCredentials: true };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__PTT_ANDROID__;
  localStorage.clear();
});

test('ordinary Android preference saving preserves retained legacy credentials without replacing them', () => {
  localStorage.setItem(KEY, JSON.stringify({ values: { ...legacy, fontSize: 18 } }));
  const saved = preferences.writeValues({
    ...preferences.DEFAULT_PREFS,
    autoLoginUser: 'new-reader',
    autoLoginPassword: 'synthetic-new-password',
    autoLoginOtpSecret: '',
    fontSize: 24,
  });
  expect(preferences.readValuesWithDefault()).toMatchObject({ ...legacy, fontSize: 24 });
  expect(saved).toMatchObject({ ...legacy, fontSize: 24 });
});

test('Android ordinary saves cannot create plaintext credentials or restore a stale copy after explicit cleanup', () => {
  preferences.writeValues({ ...preferences.DEFAULT_PREFS, ...legacy, fontSize: 22 });
  expect(preferences.readValuesWithDefault()).toMatchObject({
    autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '', fontSize: 22,
  });
  localStorage.setItem(KEY, JSON.stringify({ values: { ...legacy, fontSize: 18 } }));
  const stale = preferences.readValuesWithDefault();
  expect(preferences.clearAndroidLegacyAutoLoginCredential()).toBe(true);
  preferences.writeValues({ ...stale, fontSize: 26 });
  expect(preferences.readValuesWithDefault()).toMatchObject({
    autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '', fontSize: 26,
  });
});

test('explicit Android cleanup removes every legacy field while preserving other stored data', () => {
  localStorage.setItem(KEY, JSON.stringify({
    schema: 'retained-metadata',
    values: { ...legacy, fontSize: 18, autoLogin: false, blacklist: 'blocked-reader' },
  }));
  expect(preferences.hasLegacyAutoLoginCredential()).toBe(true);
  expect(preferences.clearAndroidLegacyAutoLoginCredential()).toBe(true);
  expect(JSON.parse(localStorage.getItem(KEY))).toEqual({
    schema: 'retained-metadata',
    values: {
      autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '',
      fontSize: 18, autoLogin: false, blacklist: 'blocked-reader',
    },
  });
  expect(preferences.hasLegacyAutoLoginCredential()).toBe(false);
  expect(preferences.clearAndroidLegacyAutoLoginCredential()).toBe(true);
});

test.each(['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret'])(
  'legacy presence detects an isolated %s without exposing its value', key => {
    localStorage.setItem(KEY, JSON.stringify({ values: { [key]: legacy[key] } }));
    expect(preferences.hasLegacyAutoLoginCredential()).toBe(true);
    expect(preferences.clearAndroidLegacyAutoLoginCredential()).toBe(true);
    expect(preferences.hasLegacyAutoLoginCredential()).toBe(false);
  },
);

test('failed cleanup preserves legacy credentials and reports failure', () => {
  const before = JSON.stringify({ values: { ...legacy, fontSize: 18 } });
  localStorage.setItem(KEY, before);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'QuotaExceededError');
  });
  expect(preferences.clearAndroidLegacyAutoLoginCredential()).toBe(false);
  expect(localStorage.getItem(KEY)).toBe(before);
  expect(preferences.hasLegacyAutoLoginCredential()).toBe(true);
});

test('a failed storage read cannot make an ordinary Android save overwrite retained credentials', () => {
  const before = JSON.stringify({ values: { ...legacy, fontSize: 18 } });
  localStorage.setItem(KEY, before);
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'SecurityError');
  });
  preferences.writeValues({ ...preferences.DEFAULT_PREFS, fontSize: 30 });
  expect(preferences.clearAndroidLegacyAutoLoginCredential()).toBe(false);
  read.mockRestore();
  expect(localStorage.getItem(KEY)).toBe(before);
});

test('malformed storage is retained rather than overwritten by an Android save or reported as cleared', () => {
  localStorage.setItem(KEY, '{broken-record');
  preferences.writeValues({ ...preferences.DEFAULT_PREFS });
  expect(preferences.clearAndroidLegacyAutoLoginCredential()).toBe(false);
  expect(localStorage.getItem(KEY)).toBe('{broken-record');
});

test('browser migration cannot clear retained Android plaintext', () => {
  localStorage.setItem(KEY, JSON.stringify({ values: legacy }));
  preferences.clearLegacyAutoLoginCredential({ clearSecret: true });
  expect(preferences.readValuesWithDefault()).toMatchObject(legacy);
});

test('the browser keeps its existing preference writes and partial credential migration', () => {
  delete window.__PTT_ANDROID__;
  preferences.writeValues({ ...preferences.DEFAULT_PREFS, ...legacy });
  expect(preferences.readValuesWithDefault()).toMatchObject(legacy);
  expect(preferences.clearAndroidLegacyAutoLoginCredential()).toBe(false);
  preferences.clearLegacyAutoLoginCredential();
  expect(preferences.readValuesWithDefault()).toMatchObject({
    autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: legacy.autoLoginOtpSecret,
  });
  preferences.clearLegacyAutoLoginCredential({ clearSecret: true });
  expect(preferences.readValuesWithDefault().autoLoginOtpSecret).toBe('');
});
