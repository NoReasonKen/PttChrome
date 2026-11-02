// @unit-env browser
// The Android endpoint is controlled here; these tests do not verify Keystore.
import {
  getAndroidCredentialStatus,
  getAndroidLoginCredential,
  saveAndroidCredentials,
} from '../../src/js/credential_store';
import { packCredential } from '../../src/js/credential_pack';
import { buildExportPayload, mergeImportedPrefs, parseImportPayload } from '../../src/js/pref_backup';
import { DEFAULT_PREFS, readValuesWithDefault, writeValues } from '../../src/js/pref_storage';
import { mergeCloudPrefs, sanitizeForCloud } from '../../src/js/pref_sync_logic';

const secret = {
  user: 'privacy-reader',
  password: 'synthetic-private-password',
  otpSecret: 'JBSWY3DPEHPK3PXP',
};
const packed = packCredential(secret.password, secret.otpSecret);
const empty = { user: false, password: false, otpSecret: false };
const present = { user: true, password: true, otpSecret: true };
let source;
let sent;

beforeEach(() => {
  localStorage.clear();
  source = 'local';
  sent = [];
  window.__PTT_ANDROID__ = { encryptedCredentials: true };
  window.PttAndroid = {
    postMessage(text) {
      const request = JSON.parse(text);
      sent.push(request);
      if (request.op === 'saveCredentials') source = request.source;
      const reply = request.op === 'getCredentialStatus'
        ? { source, local: { presence: present }, manager: { presence: present } }
        : request.op === 'getLoginCredential'
          ? { source, user: secret.user, password: packed }
          : { source, presence: present };
      queueMicrotask(() => window.PttAndroid.onmessage({
        data: JSON.stringify({ id: request.id, ok: true, ...reply }),
      }));
    },
  };
});

afterEach(() => {
  delete window.PttAndroid;
  delete window.__PTT_ANDROID__;
  localStorage.clear();
});

test.each(['local', 'manager'])('preferences do not enroll or export the %s credentials after native save and retrieval', async destination => {
  writeValues({
    ...DEFAULT_PREFS, autoLogin: false, autoLoginDupConn: 'N', autoLoginSkipWelcome: false, fontSize: 22,
  });
  expect(await saveAndroidCredentials({ source: destination, id: secret.user, password: packed }))
    .toMatchObject({ status: 'saved', source: destination });
  expect(await getAndroidLoginCredential(destination)).toEqual({
    status: 'ready', credential: { id: secret.user, password: packed },
  });
  const status = await getAndroidCredentialStatus();
  expect(status).toEqual({ source: destination, local: { presence: present }, manager: { presence: present } });

  const stored = readValuesWithDefault();
  expect(stored).toMatchObject({ autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '' });
  const backup = buildExportPayload(stored);
  const upload = sanitizeForCloud(stored);
  for (const payload of [backup.prefs, upload]) {
    expect(payload).toMatchObject({ autoLogin: false, autoLoginDupConn: 'N', autoLoginSkipWelcome: false, fontSize: 22 });
    for (const key of ['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret', 'source', 'local', 'manager', 'presence']) {
      expect(payload).not.toHaveProperty(key);
    }
    for (const value of [...Object.values(secret), packed]) expect(JSON.stringify(payload)).not.toContain(value);
  }
});

test('import and cloud application preserve native selection without triggering credential operations or restoring old plaintext', async () => {
  await saveAndroidCredentials({ source: 'manager', id: secret.user, password: packed });
  writeValues({ ...DEFAULT_PREFS, fontSize: 22 });
  sent = [];
  const incoming = {
    autoLogin: false,
    autoLoginDupConn: 'N',
    autoLoginSkipWelcome: false,
    fontSize: 24,
    autoLoginUser: secret.user,
    autoLoginPassword: packed,
    autoLoginOtpSecret: secret.otpSecret,
    source: 'local',
    local: { presence: empty },
    manager: { presence: empty },
  };
  const imported = parseImportPayload(JSON.stringify({ prefs: incoming }));
  expect(imported).toEqual({ ok: true, prefs: {
    autoLogin: false, autoLoginDupConn: 'N', autoLoginSkipWelcome: false, fontSize: 24,
  } });
  writeValues(mergeImportedPrefs(DEFAULT_PREFS, readValuesWithDefault(), imported.prefs));
  expect(sent).toEqual([]);
  expect(readValuesWithDefault()).toMatchObject({
    autoLogin: false, autoLoginDupConn: 'N', autoLoginSkipWelcome: false, fontSize: 24,
    autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '',
  });
  writeValues(mergeCloudPrefs(DEFAULT_PREFS, readValuesWithDefault(), {
    ...incoming, fontSize: 26,
  }));
  expect(sent).toEqual([]);
  expect(readValuesWithDefault()).toMatchObject({
    autoLogin: false, autoLoginDupConn: 'N', autoLoginSkipWelcome: false, fontSize: 26,
    autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '',
  });
  expect(await getAndroidCredentialStatus()).toEqual({
    source: 'manager', local: { presence: present }, manager: { presence: present },
  });
  expect(sent.map(request => request.op)).toEqual(['getCredentialStatus']);
});
