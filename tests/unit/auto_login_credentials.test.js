// @unit-env browser
// Unit guard for auto-login credential resolution and migration
// (AutoLogin._resolveCredential / _maybeMigrate / setSessionCredential,
// src/js/auto_login.js) — previously untested, and now the place where the 2FA
// secret is packed into / unpacked out of the browser credential store
// (src/js/credential_pack.js).
//
// The module keeps a page-lifetime credential cache, so every test starts from
// _resetSessionCredentialForTest()（瀏覽器原生 ESM 不能 vi.resetModules() 重載）。

import { App } from "../../src/js/pttchrome";
import { AutoLogin, _resetSessionCredentialForTest, invalidateSessionCredential } from "../../src/js/auto_login";
import { packCredential } from "../../src/js/credential_pack";
import { hideCredentialApi, setNavigatorCredentials } from "./helpers/credential_api";
import { DEFAULT_PREFS, readValuesWithDefault } from "../../src/js/pref_storage";

const PREF_KEY = "pttchrome.pref.v1";
const SECRET = "ABCDEFGHIJKLMNOP";

const writePrefs = prefs =>
  window.localStorage.setItem(
    PREF_KEY,
    JSON.stringify({ values: { ...DEFAULT_PREFS, autoLogin: true, ...prefs } })
  );

// Install a fake Credential Management API. `stored` is what get() resolves to
// (null = "the store has nothing"); pass supported:false to simulate
// Firefox/Safari.
function installCredentialApi({ stored = null, supported = true } = {}) {
  const calls = { stored: [] };
  if (!supported) {
    hideCredentialApi();
    return calls;
  }
  window.PasswordCredential = class PasswordCredential {
    constructor({ id, password, name }) {
      Object.assign(this, { id, password, name });
    }
  };
  setNavigatorCredentials({
    get: vi.fn(async () => stored),
    store: vi.fn(async cred => {
      calls.stored.push(cred);
      return cred;
    })
  });
  return calls;
}

async function freshAutoLogin() {
  _resetSessionCredentialForTest();
  return new AutoLogin({ connectState: 1 });
}

beforeEach(() => {
  window.localStorage.clear();
  hideCredentialApi();
});

describe("_resolveCredential: browser store", () => {
  test("unpacks a packed credential and clears every local copy", async () => {
    installCredentialApi({
      stored: { id: "testuser", password: packCredential("secretpass", SECRET) }
    });
    writePrefs({
      autoLoginUser: "olduser",
      autoLoginPassword: "oldpass",
      autoLoginOtpSecret: SECRET
    });

    const al = await freshAutoLogin();
    const cred = await al._resolveCredential(readValuesWithDefault());

    expect(cred).toMatchObject({
      user: "testuser",
      pass: "secretpass",
      otpSecret: SECRET,
      legacy: false,
      needsStore: false
    });
    const v = readValuesWithDefault();
    expect(v.autoLoginUser).toBe("");
    expect(v.autoLoginPassword).toBe("");
    expect(v.autoLoginOtpSecret).toBe("");
  });

  // The upgrade path: the password was saved before 2FA support existed, so the
  // secret lives on this machine only. Clearing it here would lose it for good.
  test("a bare password keeps the local secret and asks to re-store", async () => {
    installCredentialApi({ stored: { id: "testuser", password: "secretpass" } });
    writePrefs({ autoLoginOtpSecret: SECRET });

    const al = await freshAutoLogin();
    const cred = await al._resolveCredential(readValuesWithDefault());

    expect(cred).toMatchObject({
      user: "testuser",
      pass: "secretpass",
      otpSecret: SECRET,
      needsStore: true
    });
    expect(readValuesWithDefault().autoLoginOtpSecret).toBe(SECRET);
  });

  test("a bare password with no local secret leaves 2FA unconfigured", async () => {
    installCredentialApi({ stored: { id: "testuser", password: "secretpass" } });
    writePrefs({ autoLoginUser: "testuser", autoLoginPassword: "secretpass" });

    const al = await freshAutoLogin();
    const cred = await al._resolveCredential(readValuesWithDefault());

    expect(cred).toMatchObject({ otpSecret: "", needsStore: false });
    expect(readValuesWithDefault().autoLoginUser).toBe("");
  });
});

describe("_resolveCredential: fallbacks", () => {
  test("without the Credential API the local plaintext (incl. secret) is used and kept", async () => {
    installCredentialApi({ supported: false });
    writePrefs({
      autoLoginUser: "testuser",
      autoLoginPassword: "secretpass",
      autoLoginOtpSecret: SECRET
    });

    const al = await freshAutoLogin();
    const cred = await al._resolveCredential(readValuesWithDefault());

    expect(cred).toMatchObject({
      user: "testuser",
      pass: "secretpass",
      otpSecret: SECRET,
      legacy: true
    });
    expect(readValuesWithDefault().autoLoginPassword).toBe("secretpass");
    expect(readValuesWithDefault().autoLoginOtpSecret).toBe(SECRET);
  });

  test("an empty store falls back to the local plaintext", async () => {
    installCredentialApi({ stored: null });
    writePrefs({ autoLoginUser: "testuser", autoLoginPassword: "secretpass" });

    const al = await freshAutoLogin();
    const cred = await al._resolveCredential(readValuesWithDefault());

    expect(cred).toMatchObject({ user: "testuser", legacy: true });
    expect(readValuesWithDefault().autoLoginUser).toBe("testuser");
  });

  test("nothing anywhere → no credential", async () => {
    installCredentialApi({ stored: null });
    writePrefs({});

    const al = await freshAutoLogin();
    expect(await al._resolveCredential(readValuesWithDefault())).toBeNull();
  });
});

describe("setSessionCredential", () => {
  test("caches what PrefModal saved, secret included", async () => {
    installCredentialApi({ stored: { id: "other", password: "otherpass" } });
    const al = await freshAutoLogin();
    al.setSessionCredential("testuser", "secretpass", SECRET);

    // Session cache wins over the browser store (no chooser on reconnect).
    expect(await al._resolveCredential(readValuesWithDefault())).toMatchObject({
      user: "testuser",
      pass: "secretpass",
      otpSecret: SECRET
    });
  });

  // "I only filled in the OTP secret" — the password already lives in the
  // browser store, so it must not be wiped from the cache.
  test("a secret-only update keeps the cached password", async () => {
    const al = await freshAutoLogin();
    al.setSessionCredential("testuser", "secretpass", "");
    al.setSessionCredential("", "", SECRET);

    expect(await al._resolveCredential(readValuesWithDefault())).toMatchObject({
      user: "testuser",
      pass: "secretpass",
      otpSecret: SECRET
    });
  });

  test("an empty call changes nothing", async () => {
    installCredentialApi({ stored: null });
    writePrefs({ autoLoginUser: "testuser", autoLoginPassword: "secretpass" });
    const al = await freshAutoLogin();
    al.setSessionCredential("", "", "");

    expect(await al._resolveCredential(readValuesWithDefault())).toMatchObject({
      user: "testuser",
      legacy: true
    });
  });
});

// 迴歸守護：明文改成「留到 get() 證實才清」之後，啟動路徑（main.jsx 也呼叫
// onValuesPrefChange）若順手把 localStorage 的明文塞進 session cache，
// _resolveCredential 會直接回快取、永遠不呼叫 credentials.get() → 明文永遠清不掉。
// 症狀：設定完帳密、重整、自動登入成功，但設定頁欄位仍留著明文。
describe("App.onValuesPrefChange: 只有設定頁編輯能填 session cache", () => {
  const callWith = (opts) => {
    const setSessionCredential = vi.fn();
    App.prototype.onValuesPrefChange.call(
      { onPrefChange: vi.fn(), autoLogin: { setSessionCredential } },
      {
        autoLogin: true,
        autoLoginUser: "testuser",
        autoLoginPassword: "secretpass",
        autoLoginOtpSecret: SECRET
      },
      opts
    );
    return setSessionCredential;
  };

  test("啟動／雲端路徑（無 opts）不快取", () => {
    expect(callWith(undefined)).not.toHaveBeenCalled();
  });

  test("設定頁存檔路徑（fromPrefModal）才快取，且帶著密鑰", () => {
    expect(callWith({ fromPrefModal: true })).toHaveBeenCalledWith(
      "testuser",
      "secretpass",
      SECRET
    );
  });
});

describe("_maybeMigrate", () => {
  const migrateWith = async (props, api) => {
    const calls = installCredentialApi(api);
    const al = await freshAutoLogin();
    Object.assign(al, {
      _user: "testuser",
      _pass: "secretpass",
      _otpSecret: "",
      _usedLegacy: false,
      _needsStore: false,
      ...props
    });
    al._maybeMigrate();
    return calls;
  };

  test("legacy login with a secret stores the packed credential", async () => {
    const calls = await migrateWith({ _usedLegacy: true, _otpSecret: SECRET });
    expect(calls.stored).toHaveLength(1);
    expect(calls.stored[0].id).toBe("testuser");
    expect(calls.stored[0].password).toBe(packCredential("secretpass", SECRET));
  });

  test("legacy login without a secret stores the bare password", async () => {
    const calls = await migrateWith({ _usedLegacy: true });
    expect(calls.stored[0].password).toBe("secretpass");
  });

  // The store already had the password but not the secret → re-store so the
  // browser offers "update password".
  test("needsStore alone triggers the re-store", async () => {
    const calls = await migrateWith({ _needsStore: true, _otpSecret: SECRET });
    expect(calls.stored[0].password).toBe(packCredential("secretpass", SECRET));
  });

  test("nothing to do → no store() call", async () => {
    const calls = await migrateWith({});
    expect(calls.stored).toHaveLength(0);
  });

  test("no Credential API → no crash, no store", async () => {
    const calls = await migrateWith(
      { _usedLegacy: true, _otpSecret: SECRET },
      { supported: false }
    );
    expect(calls.stored).toHaveLength(0);
  });
});

// Android APK：WebView 沒有 PasswordCredential，密碼管理員走原生 bridge
// （android_bridge.js / credential_store.js）。以前在 APK 裡一律退回「無憑證」。
describe("Android APK (native Credential Manager bridge)", () => {
  function installAndroid(reply) {
    const listeners = [];
    const sent = [];
    window.__PTT_ANDROID__ = { encryptedCredentials: true, site: "wstelnet://127.0.0.1:1/bbs/t" };
    window.PttAndroid = {
      postMessage: str => {
        const msg = JSON.parse(str);
        sent.push(msg);
        const presence = { user: true, password: true, otpSecret: false };
        const out = msg.op === 'getCredentialStatus'
          ? { id: msg.id, ok: true, source: 'manager', local: { presence }, manager: { presence } }
          : { id: msg.id, source: 'manager', ...reply(msg) };
        queueMicrotask(() =>
          listeners.forEach(fn => fn({ data: JSON.stringify(out) }))
        );
      },
      addEventListener: (t, fn) => listeners.push(fn)
    };
    return sent;
  }

  afterEach(() => {
    delete window.__PTT_ANDROID__;
    delete window.PttAndroid;
  });

  test("resolves the credential from the native password manager", async () => {
    installAndroid(() => ({
      ok: true,
      user: "testuser",
      password: packCredential("secretpass", SECRET)
    }));
    writePrefs({ autoLoginUser: "olduser", autoLoginPassword: "oldpass" });

    const al = await freshAutoLogin();
    const cred = await al._resolveCredential(readValuesWithDefault());

    expect(cred).toMatchObject({
      user: "testuser",
      pass: "secretpass",
      otpSecret: SECRET,
      legacy: false
    });
    expect(readValuesWithDefault().autoLoginPassword).toBe("oldpass");
  });

  test("cancelled chooser never falls back to local plaintext", async () => {
    installAndroid(() => ({ ok: false }));
    writePrefs({ autoLoginUser: "u", autoLoginPassword: "p" });
    const al = await freshAutoLogin();
    const cred = await al._resolveCredential(readValuesWithDefault());
    expect(cred).toBeNull();
  });

  test("Android login success never initiates provider storage or migration", async () => {
    const sent = installAndroid(() => ({ ok: true }));
    const al = await freshAutoLogin();
    Object.assign(al, {
      _user: "testuser",
      _pass: "secretpass",
      _otpSecret: SECRET,
      _usedLegacy: true,
      _needsStore: false
    });
    al._maybeMigrate();
    expect(sent).toHaveLength(0);
  });

  test("a password-only manager entry never inherits another account's legacy secret", async () => {
    installAndroid(() => ({ ok: true, user: 'new-reader', password: 'new-password' }));
    writePrefs({ autoLoginOtpSecret: SECRET });
    const al = await freshAutoLogin();
    expect(await al._resolveCredential(readValuesWithDefault())).toMatchObject({ otpSecret: '', needsStore: false });
    expect(readValuesWithDefault().autoLoginOtpSecret).toBe(SECRET);
  });

  test("an older chooser result cannot repopulate the cache after a saved replacement", async () => {
    let reply;
    window.__PTT_ANDROID__ = { encryptedCredentials: true };
    window.PttAndroid = { postMessage: text => {
      const msg = JSON.parse(text);
      if (msg.op === 'getCredentialStatus') {
        const presence = { user: true, password: true, otpSecret: false };
        queueMicrotask(() => window.PttAndroid.onmessage({ data: JSON.stringify({ id: msg.id, ok: true, source: 'manager', local: { presence }, manager: { presence } }) }));
      } else reply = msg;
    } };
    const al = await freshAutoLogin();
    const pending = al._resolveCredential(DEFAULT_PREFS);
    await vi.waitFor(() => expect(reply).toBeDefined());
    invalidateSessionCredential();
    window.PttAndroid.onmessage({ data: JSON.stringify({ id: reply.id, source: 'manager', ok: true, user: 'old-reader', password: 'old-password' }) });
    expect(await pending).toBeNull();
    installAndroid(() => ({ ok: true, user: 'new-reader', password: 'new-password' }));
    expect(await al._resolveCredential(DEFAULT_PREFS)).toMatchObject({ user: 'new-reader' });
  });
});
