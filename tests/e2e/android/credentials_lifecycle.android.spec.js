const { ACCOUNT, PASSWORD, SECRET, RECORD, text, field, status, preparePage, openSettings, saveLocal, requestDeletion, finishDeletion, selectRetainedSource, reopen, drawPrompt, sent, expectLocalLogin, installApk, test, expect } = require('./credentials_helpers');
const { waitConnected } = require('../helpers/replay');

test.describe('Android encrypted automatic-login credentials', () => {
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
