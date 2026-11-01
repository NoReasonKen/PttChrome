// @unit-env browser
// 密碼管理員單一入口（src/js/credential_store.js）：瀏覽器 PasswordCredential
// 或 Android APK 原生 Credential Manager（bridge）。Android WebView 沒有
// PasswordCredential ⇒ 以前 APK 內自動登入永遠拿不到密碼（本檔要守的 bug）。
import {
  credentialStoreAvailable,
  getStoredCredential,
  storeCredential,
  getPasswordManagerPresence,
} from "../../src/js/credential_store";
import { hideCredentialApi, setNavigatorCredentials } from "./helpers/credential_api";

function installBrowserApi(stored) {
  window.PasswordCredential = class {
    constructor(o) {
      Object.assign(this, o);
    }
  };
  setNavigatorCredentials({
    get: vi.fn(async () => stored),
    store: vi.fn(async c => c)
  });
}

// 模擬 WebView：沒有 PasswordCredential，只有 bridge。
function installAndroid(reply) {
  const listeners = [];
  const sent = [];
  window.__PTT_ANDROID__ = { site: "wstelnet://127.0.0.1:1/bbs/t" };
  window.PttAndroid = {
    postMessage: str => {
      const msg = JSON.parse(str);
      sent.push(msg);
      const out = { id: msg.id, ...reply(msg) };
      queueMicrotask(() =>
        listeners.forEach(fn => fn({ data: JSON.stringify(out) }))
      );
    },
    addEventListener: (t, fn) => listeners.push(fn)
  };
  return sent;
}

// 真 Chromium 本來就有這組 API ⇒ 每個 test 從「都沒有」開始。
beforeEach(hideCredentialApi);

afterEach(() => {
  hideCredentialApi();
  delete window.__PTT_ANDROID__;
  delete window.PttAndroid;
});

test("nothing available → unavailable, get() is null", async () => {
  expect(credentialStoreAvailable()).toBe(false);
  await expect(getStoredCredential()).resolves.toBeNull();
});

test("browser backend", async () => {
  installBrowserApi({ id: "u", password: "p" });
  expect(credentialStoreAvailable()).toBe(true);
  await expect(getStoredCredential()).resolves.toEqual({ id: "u", password: "p" });
  await storeCredential({ id: "u", password: "p2" });
  expect(navigator.credentials.store.mock.calls[0][0]).toMatchObject({
    id: "u",
    password: "p2",
    name: "PTT"
  });
});

test("Android WebView (no PasswordCredential) uses the native bridge", async () => {
  const sent = installAndroid(() => ({ ok: true, user: "u", password: "packed" }));
  expect(credentialStoreAvailable()).toBe(true);
  await expect(getStoredCredential()).resolves.toEqual({ id: "u", password: "packed" });
  await storeCredential({ id: "u", password: "packed2" });
  expect(sent.map(m => m.op)).toEqual(["getPassword", "storePassword"]);
  expect(sent[1]).toMatchObject({ user: "u", password: "packed2" });
});

test("Android: user cancels the chooser → null", async () => {
  installAndroid(() => ({ ok: false }));
  await expect(getStoredCredential()).resolves.toBeNull();
});

test("Android bridge is preferred even if the WebView grows PasswordCredential", async () => {
  installBrowserApi({ id: "browser", password: "x" });
  installAndroid(() => ({ ok: true, user: "native", password: "y" }));
  await expect(getStoredCredential()).resolves.toMatchObject({ id: "native" });
});

test.each([
  [{ ok: true }, 'saved'],
  [{ ok: false, error: 'cancelled' }, 'cancelled'],
  [{ ok: false, error: 'failed' }, 'failed'],
  [{ ok: false }, 'failed'],
])('Android save reports its confirmed result: %j', async (reply, status) => {
  installAndroid(() => reply);
  expect(await storeCredential({ id: 'reader', password: 'synthetic' })).toEqual({ status });
});

test('Android status returns only native presence without retrieving provider credentials', async () => {
  const sent = installAndroid(() => ({ ok: true, presence: { user: true, password: true, otpSecret: false }, user: 'must-not-return' }));
  window.__PTT_ANDROID__.credentialSave = true;
  expect(await getPasswordManagerPresence()).toEqual({ user: true, password: true, otpSecret: false });
  expect(sent.map(m => m.op)).toEqual(['getPasswordStatus']);
});
