const { ACCOUNT, PASSWORD, SECRET, RECORD, LEGACY, text, field, status, preparePage, openSettings, saveLocal, saveEnteredLocal, storedValues, seedLegacy, requestDeletion, finishDeletion, reopen, drawPrompt, sent, expectLocalLogin, test, expect, expectPrivateRecording, ptt } = require('./credentials_helpers');
const { waitConnected } = require('../helpers/replay');

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

  test('native credential operations reject subframes while the configured main frame retains access', async ({ apk }) => {
    await preparePage(apk.page);
    await saveLocal(apk.page);
    const before = await status(apk.page);
    const savedRecord = () => apk.device.shell(`run-as ${apk.pkg} base64 ${RECORD}`).then(String);
    const originalRecord = await savedRecord();
    const probeUrl = new URL('/__credential-frame.html', apk.page.url()).href;
    await apk.page.route(probeUrl, route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Credential frame probe</title>',
    }));
    await apk.page.evaluate(url => {
      const iframe = document.createElement('iframe');
      iframe.name = 'credential-frame-probe';
      iframe.src = url;
      document.body.append(iframe);
    }, probeUrl);
    await expect.poll(() => apk.page.frames().some(frame => frame.url() === probeUrl)).toBe(true);
    const frame = apk.page.frame({ name: 'credential-frame-probe' });
    await frame.waitForFunction(() => typeof window.PttAndroid?.postMessage === 'function');
    await frame.evaluate(() => {
      window.__credentialReplies = [];
      window.PttAndroid.onmessage = event => window.__credentialReplies.push(JSON.parse(event.data));
      const requests = [
        { op: 'getCredentialStatus' },
        { op: 'getPasswordStatus' },
        { op: 'getLoginCredential' },
        { op: 'saveCredentials', source: 'manager' },
        { op: 'saveCredentials', source: 'local', user: 'frame-reader', password: 'synthetic-frame-password' },
        { op: 'deleteLocalCredentials' },
      ];
      requests.forEach((request, index) => window.PttAndroid.postMessage(JSON.stringify({ ...request, id: 9000 + index })));
    });
    // These real native replies are processing sentinels, not a fixed delay.
    // If a subframe request passed the guard, its transaction would precede
    // these status reads through the same native credential mutex.
    expect(await status(apk.page)).toEqual(before);
    expect(await status(apk.page)).toEqual(before);
    expect(await savedRecord()).toBe(originalRecord);
    expect(await frame.evaluate(() => window.__credentialReplies)).toEqual([]);

    // An opaque-origin frame cannot even receive a bridge object. It remains
    // inside this offline WebView rather than navigating into another app.
    await apk.page.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.name = 'unapproved-credential-frame';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.srcdoc = '<!doctype html><title>Unapproved credential frame</title>';
      document.body.append(iframe);
    });
    await expect.poll(() => apk.page.frame({ name: 'unapproved-credential-frame' })?.url()).toBe('about:srcdoc');
    const unapproved = apk.page.frame({ name: 'unapproved-credential-frame' });
    expect(await unapproved.evaluate(() => ({ origin: self.origin, bridge: typeof window.PttAndroid }))).toEqual({
      origin: 'null', bridge: 'undefined',
    });
    expect(await status(apk.page)).toEqual(before);
    expect(await savedRecord()).toBe(originalRecord);
  });

  test('diagnostic artifacts redact credentials retrieved through the real native bridge after process restart', async ({ apk }) => {
    test.setTimeout(180000);
    await preparePage(apk.page);
    await saveLocal(apk.page);
    const page = await reopen(apk, { autoLogin: false });
    const logs = [];
    page.on('console', message => logs.push(message.text()));
    expect(await page.evaluate(() => window.__app.toggleDebugRecording())).toBe(true);
    await page.evaluate(key => {
      const prefs = JSON.parse(localStorage.getItem(key));
      prefs.values.autoLogin = true;
      localStorage.setItem(key, JSON.stringify(prefs));
      const app = window.__app;
      const site = app.connectedUrl.url;
      window.__stubWS.close();
      window.__credentialSends = [];
      app.connect(site);
    }, ptt.PREF_KEY);
    await waitConnected(page);
    await expectLocalLogin(page);
    await drawPrompt(page, 'Login outcome for ' + ACCOUNT + ': authentication completed');
    const result = await page.evaluate(async () => {
      const { stopDebugRecording } = await import('/src/js/debug_record_control.js');
      let artifact = null;
      // Retain the actual shared export artifact for inspection. Only delivery
      // to Android's SAF chooser is substituted; bridge/Keystore/login/recording
      // and the exporter remain real. This does not test SAF file persistence.
      const downloaded = stopDebugRecording(window.__app, {
        download: (filename, json) => { artifact = { filename, json }; },
      });
      return { downloaded, artifact };
    });
    expect(result.downloaded).toBe(true);
    expect(result.artifact.filename).toMatch(/^ptt-debug-.*\.json$/);
    const recording = JSON.parse(result.artifact.json);
    const secrets = [ACCOUNT, PASSWORD, SECRET, `pttchrome:v1:${SECRET}:${PASSWORD}`];
    expectPrivateRecording(recording, secrets);
    expect(recording.events.some(event => event.tag === 'record.start')).toBe(true);
    const decoded = recording.events.filter(event => event.data)
      .map(event => Buffer.from(event.data, 'base64').toString('latin1')).join('');
    expect(decoded).toContain('authentication completed');
    const nativeLogs = String(await apk.device.shell('logcat -d -s PttCredentialBridge:V PttChromeApp:V'));
    const all = [result.artifact.json, decoded, logs.join('\n'), nativeLogs].join('\n');
    for (const secret of secrets) expect(all).not.toContain(secret);
    expect(await storedValues(page)).toMatchObject({ autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '' });
  });

});
