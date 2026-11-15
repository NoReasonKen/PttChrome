// The installed debug app, native message bridge and Android Keystore remain real.
// Only PTT transport is substituted. The shared fixture disables device networks
// before starting the app, including the initial page before Playwright attaches.
const { createHmac } = require('crypto');
const { spawnSync } = require('child_process');
const { test, expect, envError } = require('./fixtures');
const { sdkTool } = require('./android_env');
const { installReplay, installOfflineNetwork, waitConnected } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { expectPrivateRecording } = require('../helpers/credential_privacy');
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


module.exports = { ACCOUNT, PASSWORD, SECRET, RECORD, LEGACY, text, field, status, preparePage, openSettings, saveLocal, saveEnteredLocal, storedValues, seedLegacy, requestDeletion, finishDeletion, selectRetainedSource, reopen, drawPrompt, sent, expectLocalLogin, installApk, test, expect, expectPrivateRecording, ptt };
