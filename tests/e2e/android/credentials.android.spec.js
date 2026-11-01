// The installed debug app, native message bridge and Android Keystore remain real.
// Only PTT transport is substituted. The shared fixture disables device networks
// before starting the app, including the initial page before Playwright attaches.
const { createHmac } = require('crypto');
const { spawnSync } = require('child_process');
const { test, expect, envError } = require('./fixtures');
const { sdkTool } = require('./android_env');
const { installReplay, installOfflineNetwork, waitConnected } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const ptt = require('../helpers/ptt');

const ACCOUNT = 'localreader';
const PASSWORD = 'synthetic-local-password';
// RFC 6238's SHA-1 test key, represented as Base32 for the shared settings form.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RECORD = 'no_backup/device-credentials';
const LEGACY = {
  autoLoginUser: 'legacyreader',
  autoLoginPassword: 'synthetic-legacy-password',
  autoLoginOtpSecret: 'JBSWY3DPEHPK3PXP',
};
const text = (page, key) => page.evaluate(value => window.__i18n(value), key);
const field = (page, name) => page.locator(`.PrefModal input[name="${name}"]`);
const saveButton = async page => page.locator('.PrefModal').getByRole('button', {
  name: await text(page, 'options_credentialsSave'), exact: true,
});
const status = page => page.evaluate(async () => {
  const { requestAndroid } = await import('/src/js/android_bridge.js');
  const { id, ...result } = await requestAndroid('getCredentialStatus');
  return result;
});

async function preparePage(page, autoLogin = false) {
  await installReplay(page);
  await installOfflineNetwork(page);
  await page.addInitScript(({ key, autoLogin }) => {
    const current = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...current, values: {
      ...current.values, mobileLayout: 'on', autoLogin, autoLoginSkipWelcome: false,
      autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '',
    } }));
    window.__credentialSends = [];
    window.__stubWSSent = bytes => window.__credentialSends.push(bytes);
  }, { key: ptt.PREF_KEY, autoLogin });
  await page.reload();
  await waitConnected(page);
  await expect.poll(() => page.evaluate(() => window.__PTT_ANDROID__?.encryptedCredentials)).toBe(true);
}

async function openSettings(page) {
  await drawMainMenu(page);
  await page.locator('[data-key="__more"]').click();
  await page.locator('[data-key="__settings"]').click();
  await page.locator('.PrefModal [data-pref-category="autologin"]').click();
  await expect(field(page, 'autoLoginUser')).toBeVisible();
}

async function saveLocal(page, withSecret = true) {
  await openSettings(page);
  await saveEnteredLocal(page, withSecret);
}

async function saveEnteredLocal(page, withSecret = true) {
  await expect(page.getByRole('radio', {
    name: await text(page, 'options_credentialsSource_local'), exact: true,
  })).toBeChecked();
  await field(page, 'autoLoginUser').fill(ACCOUNT);
  await field(page, 'autoLoginPassword').fill(PASSWORD);
  await field(page, 'autoLoginOtpSecret').fill(withSecret ? SECRET : '');
  await (await saveButton(page)).click();
  await expect(field(page, 'autoLoginUser')).toHaveValue('');
  await expect(field(page, 'autoLoginPassword')).toHaveValue('');
  await expect(field(page, 'autoLoginOtpSecret')).toHaveValue('');
  await expect(field(page, 'autoLoginUser')).toHaveAttribute('placeholder',
    await text(page, 'placeholder_local_user_saved'));
  await expect(field(page, 'autoLoginOtpSecret')).toHaveAttribute('placeholder',
    await text(page, `placeholder_local_otpSecret_${withSecret ? 'saved' : 'empty'}`));
  await page.locator('.PrefModal').getByRole('button', { name: 'Close', exact: true }).click();
}

const storedValues = page => page.evaluate(key =>
  JSON.parse(localStorage.getItem(key) || '{}').values || {}, ptt.PREF_KEY);

async function seedLegacy(page) {
  // Simulate persisted preferences from the old APK after the clean fixture has
  // booted. preparePage intentionally clears these fields during normal reloads.
  await page.evaluate(({ key, legacy }) => {
    const current = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...current, values: {
      ...current.values, ...legacy, highlightAuthorComments: false,
    } }));
  }, { key: ptt.PREF_KEY, legacy: LEGACY });
}

async function requestDeletion(page, kind) {
  const key = kind === 'local' ? 'options_credentialsDeleteLocal' : 'options_credentialsDeleteLegacy';
  await page.locator('.PrefModal').getByRole('button', {
    name: await text(page, key), exact: true,
  }).click();
  const dialog = page.getByRole('dialog', { name: await text(page, key), exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function finishDeletion(page, dialog, confirm) {
  await dialog.getByRole('button', {
    name: await text(page, confirm ? 'options_credentialsConfirmDelete' : 'options_credentialsCancelDelete'),
    exact: true,
  }).click();
  await expect(dialog).toHaveCount(0);
}

async function selectRetainedSource(page, source) {
  await openSettings(page);
  await page.getByRole('radio', {
    name: await text(page, 'options_credentialsSource_' + source), exact: true,
  }).click();
  for (const name of ['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret']) {
    await expect(field(page, name)).toHaveValue('');
  }
  await expect.poll(async () => (await status(page)).source).toBe(source);
  await expect(await saveButton(page)).toBeDisabled();
  await page.locator('.PrefModal').getByRole('button', { name: 'Close', exact: true }).click();
}

// A fresh OS process destroys the page-lifetime login cache. Reattaching alone
// must not count as a persistence test; install the offline transport and reload
// the new WebView before presenting any synthetic PTT prompts.
async function reopen(apk, { host = 'localhost', autoLogin = true, clear = false } = {}) {
  await apk.device.shell(`am force-stop ${apk.pkg}`);
  if (clear) {
    await apk.device.shell(`pm clear ${apk.pkg}`);
    await apk.device.shell(`pm grant ${apk.pkg} android.permission.POST_NOTIFICATIONS`);
  }
  const xml = "<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map>" +
    "<boolean name='dev_server_enabled' value='true' />" +
    `<string name='dev_server_url'>http://${host}:8080/</string></map>`;
  await apk.device.shell(`run-as ${apk.pkg} sh -c "mkdir -p shared_prefs && echo \\"${xml}\\" > shared_prefs/app_settings.xml"`);
  await apk.device.shell(`am start -W -n ${apk.activity}`);
  let timer;
  const webView = await Promise.race([
    apk.device.webView({ pkg: apk.pkg }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(envError('Credential test could not attach to the new WebView')), 60000);
    }),
  ]).finally(() => clearTimeout(timer));
  const page = await webView.page();
  await expect.poll(() => page.url(), { timeout: 15000 }).toMatch(new RegExp(`^http://${host.replaceAll('.', '\\.')}:8080/`));
  await preparePage(page, autoLogin);
  return page;
}

async function drawPrompt(page, prompt) {
  await page.evaluate(value => {
    const encoded = [...value].map(character => {
      const code = character.charCodeAt(0);
      return code < 0x80 ? character : String.fromCharCode(
        window.lib.u2bArray[2 * code], window.lib.u2bArray[2 * code + 1]);
    }).join('');
    window.__app.onData('\x1b[H\x1b[2J' + encoded);
  }, prompt);
}

const sent = page => page.evaluate(() => window.__credentialSends.join(''));

// Independent RFC 6238 computation, rather than reusing the product's generator.
function referenceTotp(atMs) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000)));
  const digest = createHmac('sha1', '12345678901234567890').update(counter).digest();
  return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function expectLocalLogin(page, withSecret = true) {
  await drawPrompt(page, '請輸入代號');
  await expect.poll(() => sent(page), { timeout: 15000 }).toContain(ACCOUNT + '\r');
  await drawPrompt(page, '請輸入密碼');
  await expect.poll(() => sent(page)).toContain(PASSWORD + '\r');
  if (withSecret) {
    const before = Date.now();
    await drawPrompt(page, '請輸入兩階段(2FA)驗證碼(6位限時數字 或8位救援碼):');
    await expect.poll(async () => /\d{6}\r$/.test(await sent(page)), { timeout: 10000 }).toBe(true);
    const actual = (await sent(page)).match(/(\d{6})\r$/)[1];
    const after = Date.now();
    expect([referenceTotp(before), referenceTotp(after)]).toContain(actual);
  }
  await drawMainMenu(page);
}

function installApk(android, file, extra = []) {
  const result = spawnSync(sdkTool('adb'), ['-s', android.serial, 'install', '-r', '-t', '-g', ...extra, file], {
    encoding: 'utf8', timeout: 90000,
  });
  expect(result.status, result.stderr || result.stdout || String(result.error)).toBe(0);
}

test.describe('Android encrypted automatic-login credentials', () => {
  test('legacy plaintext is not prefilled and is cleared only after manual native encrypted enrollment', async ({ apk }) => {
    await preparePage(apk.page);
    await seedLegacy(apk.page);
    await openSettings(apk.page);
    await expect(apk.page.getByText(await text(apk.page, 'options_credentialsLegacySetup'), { exact: true })).toBeVisible();
    for (const name of Object.keys(LEGACY)) await expect(field(apk.page, name)).toHaveValue('');
    expect(await storedValues(apk.page)).toMatchObject(LEGACY);
    expect(await status(apk.page)).toMatchObject({ local: {
      presence: { user: false, password: false, otpSecret: false },
    } });

    await saveEnteredLocal(apk.page);

    expect(await storedValues(apk.page)).toMatchObject({
      autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '', highlightAuthorComments: false,
    });
    expect(await status(apk.page)).toMatchObject({ local: {
      presence: { user: true, password: true, otpSecret: true },
    } });
    const reopened = await reopen(apk);
    await expectLocalLogin(reopened);
    for (const value of Object.values(LEGACY)) expect(await sent(reopened)).not.toContain(value);
  });

  test('confirmed legacy cleanup preserves ordinary settings and does not enroll native credentials', async ({ apk }) => {
    await preparePage(apk.page);
    await seedLegacy(apk.page);
    await openSettings(apk.page);
    const before = await status(apk.page);

    await finishDeletion(apk.page, await requestDeletion(apk.page, 'legacy'), false);
    expect(await storedValues(apk.page)).toMatchObject(LEGACY);
    expect(await status(apk.page)).toEqual(before);

    await finishDeletion(apk.page, await requestDeletion(apk.page, 'legacy'), true);
    expect(await storedValues(apk.page)).toMatchObject({
      autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '', highlightAuthorComments: false,
    });
    expect(await status(apk.page)).toEqual(before);
    expect(await apk.page.evaluate(() => window.__app.isConnected())).toBe(true);
    await apk.page.locator('.PrefModal').getByRole('button', { name: 'Close', exact: true }).click();
    await openSettings(apk.page);
    await expect(apk.page.getByText(await text(apk.page, 'options_credentialsLegacySetup'), { exact: true })).toHaveCount(0);
    await expect(field(apk.page, 'autoLoginUser')).toHaveValue('');
    await expect(field(apk.page, 'autoLoginUser')).toHaveAttribute('placeholder',
      await text(apk.page, 'placeholder_local_user_empty'));
  });

  test('confirmed encrypted deletion after retrieval blocks cached login on reconnect and survives a fresh process', async ({ apk }) => {
    test.setTimeout(180000);
    await preparePage(apk.page);
    await expect.poll(() => apk.page.evaluate(() => window.__PTT_ANDROID__?.credentialDeletion)).toBe(true);
    await saveLocal(apk.page, false);
    const page = await reopen(apk);
    // Actual successful retrieval populates the product's page-lifetime cache.
    await expectLocalLogin(page, false);
    await openSettings(page);
    const before = await status(page);
    await finishDeletion(page, await requestDeletion(page, 'local'), false);
    expect(await status(page)).toEqual(before);
    await expect(field(page, 'autoLoginUser')).toHaveAttribute('placeholder',
      await text(page, 'placeholder_local_user_saved'));

    await finishDeletion(page, await requestDeletion(page, 'local'), true);
    expect(await status(page)).toMatchObject({ source: 'local', local: {
      presence: { user: false, password: false, otpSecret: false },
    }, manager: before.manager });
    await expect(field(page, 'autoLoginUser')).toHaveAttribute('placeholder',
      await text(page, 'placeholder_local_user_empty'));
    expect(await page.evaluate(() => window.__app.isConnected())).toBe(true);
    await page.locator('.PrefModal').getByRole('button', { name: 'Close', exact: true }).click();

    await page.evaluate(() => {
      window.__stubWS.close();
      window.__credentialSends = [];
    });
    await page.locator('#reactAlert').getByRole('button', {
      name: await text(page, 'alert_connectionReconnect'), exact: true,
    }).click();
    await waitConnected(page);
    await expect(page.locator('.ListHint')).toHaveText(await text(page, 'options_credentialsLogin_missing'));
    await drawPrompt(page, '請輸入代號');
    await drawPrompt(page, '請輸入密碼');
    for (const value of [ACCOUNT, PASSWORD]) expect(await sent(page)).not.toContain(value);

    const fresh = await reopen(apk);
    await expect(fresh.locator('.ListHint')).toHaveText(await text(fresh, 'options_credentialsLogin_missing'));
    expect(await status(fresh)).toMatchObject({ source: 'local', local: {
      presence: { user: false, password: false, otpSecret: false },
    } });
    await drawPrompt(fresh, '請輸入代號');
    for (const value of [ACCOUNT, PASSWORD]) expect(await sent(fresh)).not.toContain(value);
  });

  test('real native save survives process restart and approved page-source changes without exposing plaintext storage', async ({ apk }) => {
    test.setTimeout(180000);
    await preparePage(apk.page);
    await saveLocal(apk.page);
    const encoded = String(await apk.device.shell(`run-as ${apk.pkg} base64 ${RECORD}`));
    const record = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
    expect(record.length).toBeGreaterThan(32);
    for (const value of [ACCOUNT, PASSWORD, SECRET]) expect(record.includes(Buffer.from(value))).toBe(false);
    const webStorage = await apk.page.evaluate(() => Object.values(localStorage).join('\n'));
    for (const value of [ACCOUNT, PASSWORD, SECRET]) expect(webStorage).not.toContain(value);

    const first = await reopen(apk);
    await expectLocalLogin(first);
    // Persist the manager choice without credentials or provider UI. This must
    // survive the actual file format and a fresh process, not just MemoryState.
    await selectRetainedSource(first, 'manager');
    const manager = await reopen(apk, { autoLogin: false });
    expect(await status(manager)).toMatchObject({ ok: true, source: 'manager' });
    await openSettings(manager);
    await expect(manager.getByRole('radio', {
      name: await text(manager, 'options_credentialsSource_manager'), exact: true,
    })).toBeChecked();
    await manager.locator('.PrefModal').getByRole('button', { name: 'Close', exact: true }).click();
    await selectRetainedSource(manager, 'local');
    // A second approved native page source has its own web preferences but uses
    // the same installed app's source and ciphertext, not per-origin enrollment.
    const alternate = await reopen(apk, { host: '127.0.0.1' });
    expect(await status(alternate)).toMatchObject({ ok: true, source: 'local', local: {
      presence: { user: true, password: true, otpSecret: true },
    } });
    await expectLocalLogin(alternate);
  });

  test('compatible APK replacement retains the key and optional-secret state; clearing app data removes enrollment', async ({ apk, android, apkInstalled }) => {
    test.setTimeout(180000);
    await preparePage(apk.page);
    await saveLocal(apk.page, false);
    await apk.device.shell(`am force-stop ${apk.pkg}`);
    // Reinstalling the same signed artifact tests Android's package replacement
    // path. The separate opt-in test below requires a genuinely newer version.
    installApk(android, apkInstalled);
    const replaced = await reopen(apk);
    expect(await status(replaced)).toMatchObject({ ok: true, source: 'local', local: {
      presence: { user: true, password: true, otpSecret: false },
    } });
    await expectLocalLogin(replaced, false);
    const cleared = await reopen(apk, { clear: true, autoLogin: false });
    await openSettings(cleared);
    await expect(field(cleared, 'autoLoginUser')).toHaveAttribute('placeholder',
      await text(cleared, 'placeholder_local_user_empty'));
    await expect(field(cleared, 'autoLoginPassword')).toHaveValue('');
    expect(await status(cleared)).toMatchObject({ ok: true, source: 'local', local: {
      presence: { user: false, password: false, otpSecret: false },
    } });
  });

  test('a higher-version compatible APK retains encrypted credentials across the version update', async ({ apk, android, apkInstalled }) => {
    test.skip(!process.env.ANDROID_CREDENTIAL_UPDATE_APK,
      'Requires a newer debug-signed APK in ANDROID_CREDENTIAL_UPDATE_APK; same-version reinstall is not version-update evidence');
    test.setTimeout(180000);
    await preparePage(apk.page);
    await saveLocal(apk.page);
    const original = String(await apk.device.shell(`dumpsys package ${apk.pkg}`));
    const versionCode = dump => Number(dump.match(/versionCode=(\d+)/)?.[1]);
    try {
      await apk.device.shell(`am force-stop ${apk.pkg}`);
      installApk(android, process.env.ANDROID_CREDENTIAL_UPDATE_APK);
      const updated = String(await apk.device.shell(`dumpsys package ${apk.pkg}`));
      expect(versionCode(updated)).toBeGreaterThan(versionCode(original));
      const page = await reopen(apk);
      await expectLocalLogin(page);
    } finally {
      await apk.device.shell(`am force-stop ${apk.pkg}`);
      // Restore the baseline for other tests sharing the disposable debug app.
      installApk(android, apkInstalled, ['-d']);
    }
  });
});
