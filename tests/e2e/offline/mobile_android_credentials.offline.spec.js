const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');

const SECRET = 'JBSWY3DPEHPK3PXP';
const text = (page, key) => page.evaluate(value => window.__i18n(value), key);
const input = (page, name) => page.locator(`.PrefModal input[name="${name}"]`);
const user = page => input(page, 'autoLoginUser');
const password = page => input(page, 'autoLoginPassword');
const secret = page => input(page, 'autoLoginOtpSecret');

// Substitute only the external Android message endpoint. These tests exercise
// the real narrow settings UI, not an installed APK or a real provider's UI.
async function installCredentialHost(page, source = 'manager', savedSecretSource = null) {
  await page.addInitScript(({ source, savedSecretSource }) => {
    const listeners = [];
    const host = window.__credentialHost = {
      requests: [],
      source,
      localPresence: { user: false, password: false, otpSecret: savedSecretSource === 'local' },
      saveError: null,
      presence: { user: false, password: false, otpSecret: savedSecretSource === 'manager' },
    };
    const prefs = JSON.parse(localStorage.getItem('pttchrome.pref.v1') || '{}');
    localStorage.setItem('pttchrome.pref.v1', JSON.stringify({
      ...prefs, values: { ...prefs.values, autoLogin: false },
    }));
    window.__PTT_ANDROID__ = { credentialSave: true, encryptedCredentials: true };
    window.PttAndroid = {
      addEventListener(kind, listener) {
        if (kind === 'message') listeners.push(listener);
      },
      postMessage(data) {
        const request = JSON.parse(data);
        host.requests.push(request);
        let reply = { id: request.id, ok: false, error: 'unknown op' };
        if (request.op === 'getCredentialStatus') {
          reply = { id: request.id, ok: true, source: host.source, local: { presence: host.localPresence }, manager: { presence: host.presence } };
        } else if (request.op === 'getLoginCredential') {
          reply = { id: request.id, ok: false, error: 'missing' };
        } else if (request.op === 'saveCredentials') {
          if (host.saveError) {
            reply = { id: request.id, ok: false, error: host.saveError };
          } else {
            host.source = request.source;
            const key = host.source === 'local' ? 'localPresence' : 'presence';
            if (request.user) host[key] = { user: true, password: true, otpSecret: request.password.startsWith('pttchrome:v1:') };
            reply = { id: request.id, ok: true, source: host.source, presence: host[key] };
          }
        }
        queueMicrotask(() => {
          for (const listener of listeners) listener({ data: JSON.stringify(reply) });
        });
      },
    };
  }, { source, savedSecretSource });
}

async function bootSettings(page, source, savedSecretSource) {
  await installCredentialHost(page, source, savedSecretSource);
  await bootOffline(page, ptt);
  await drawMainMenu(page);
  await expect(page.locator('body')).toHaveClass(/mobile-layout/);
  await openCredentials(page);
}

async function openCredentials(page) {
  await page.locator('[data-key="__more"]').tap();
  await page.locator('[data-key="__settings"]').tap();
  await expect(page.locator('.PrefModal')).toBeVisible();
  await page.locator('.PrefModal [data-pref-category="autologin"]').tap();
  await expect(user(page)).toBeVisible();
  await expect(page.locator('.PrefModal').getByRole('radio').first()).toBeEnabled();
  await expect(await saveButton(page)).toBeDisabled();
}

async function fillCredentials(page, otpSecret = '') {
  await user(page).fill('offline-reader');
  await password(page).fill('synthetic-password');
  await secret(page).fill(otpSecret);
}

const saveButton = async page => page.locator('.PrefModal').getByRole('button', {
  name: await text(page, 'options_credentialsSave'), exact: true,
});
const closeSettings = page => page.locator('.PrefModal').getByRole('button', { name: 'Close', exact: true }).tap();
const providerOperations = page => page.evaluate(() => window.__credentialHost.requests
  .filter(request => request.op === 'getLoginCredential' || request.op === 'saveCredentials')
  .map(request => request.op));

async function expectPresence(page, withSecret) {
  await expect(user(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_manager_user_saved'));
  await expect(password(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_manager_password_saved'));
  await expect(secret(page)).toHaveAttribute('placeholder', await text(page,
    `placeholder_manager_otpSecret_${withSecret ? 'saved' : 'empty'}`));
  await expect(user(page)).toHaveValue('');
  await expect(password(page)).toHaveValue('');
  await expect(secret(page)).toHaveValue('');
}

async function expectNoHorizontalOverflow(page) {
  expect(await page.locator('.PrefModal').evaluate(modal =>
    modal.scrollWidth <= modal.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('mobile explicit manager save clears fields and keeps per-field status on reopening without provider retrieval', async ({ page }) => {
  await bootSettings(page);
  await expect(user(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_manager_user_empty'));
  await fillCredentials(page, 'otpauth://totp/reader?issuer=PTT');
  // A real Save tap blurs the secret first. Invalid nonempty input must not
  // silently become an intentional empty-secret replacement.
  await (await saveButton(page)).tap();
  await expect(secret(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(secret(page)).toHaveAccessibleDescription(await text(page, 'options_credentials_invalidSecret'));
  await expect(secret(page)).toHaveValue('otpauth://totp/reader?issuer=PTT');
  expect(await providerOperations(page)).toEqual([]);
  await fillCredentials(page, SECRET);
  expect(await providerOperations(page)).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('credentials-before-save.png'), animations: 'disabled' });
  await (await saveButton(page)).tap();
  await expectPresence(page, true);
  const saved = page.locator('.PrefModal').getByRole('button', { name: await text(page, 'options_credentials_saved'), exact: true });
  await expect(saved).toBeDisabled();
  await expect(page.locator('.PrefModal').getByRole('status')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('credentials-after-save.png'), animations: 'disabled' });
  await expectNoHorizontalOverflow(page);
  await closeSettings(page);
  await expect(page.locator('.PrefModal')).toHaveCount(0);
  await openCredentials(page);
  await expectPresence(page, true);
  expect(await providerOperations(page)).toEqual(['saveCredentials']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pttchrome.pref.v1')).values);
  expect(stored.autoLogin).toBe(false);
  for (const key of ['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret']) {
    expect(stored[key] || '').toBe('');
  }

  // A complete replacement without a secret must not inherit the previous one.
  await fillCredentials(page);
  await (await saveButton(page)).tap();
  await expectPresence(page, false);
  await closeSettings(page);
  await openCredentials(page);
  await expectPresence(page, false);
  expect(await providerOperations(page)).toEqual(['saveCredentials', 'saveCredentials']);
});

for (const source of ['local', 'manager']) test(`mobile ${source} 2FA guidance is visible only during focus or a nonempty draft`, async ({ page }) => {
  await bootSettings(page, source, source);
  const guidance = page.getByText(await text(page, 'tooltip_androidCredentialSecret'), { exact: true });
  const warning = page.getByText(await text(page, 'tooltip_androidCredentialSecretRisk'), { exact: true });
  const expectHidden = async () => {
    await expect(guidance).toHaveCount(0);
    await expect(warning).toHaveCount(0);
  };

  await expectHidden();
  await secret(page).tap();
  await expect(guidance).toBeVisible();
  await expect(warning).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`${source}-2fa-help-focused.png`), animations: 'disabled' });
  await user(page).tap();
  await expectHidden();

  await secret(page).tap();
  await secret(page).fill(SECRET);
  await user(page).tap();
  await expect(guidance).toBeVisible();
  await expect(warning).toBeVisible();
  await secret(page).tap();
  await secret(page).fill('');
  await expect(guidance).toBeVisible();
  await expect(warning).toBeVisible();
  await user(page).tap();
  await expectHidden();

  await user(page).fill('offline-reader');
  await password(page).fill('synthetic-password');
  await secret(page).tap();
  await expect(guidance).toBeVisible();
  // Use a mouse click while the empty secret is focused; blur collapses the
  // guidance as Save is activated, so the button must still receive the click.
  await (await saveButton(page)).click();
  await expect(user(page)).toHaveValue('');
  await expectHidden();
  await closeSettings(page);
  await openCredentials(page);
  await expect(secret(page)).toHaveValue('');
  await expectHidden();
});

test('mobile cancelled and failed saves preserve drafts and leave unsaved choices under reader control', async ({ page }) => {
  await bootSettings(page);
  await fillCredentials(page, SECRET);
  for (const error of ['cancelled', 'failed']) {
    await page.evaluate(value => { window.__credentialHost.saveError = value; }, error);
    await (await saveButton(page)).tap();
    await expect(page.locator('.PrefModal').getByRole('status')).toHaveText(await text(page, `options_credentials_${error}`));
    await expect(user(page)).toHaveValue('offline-reader');
    await expect(password(page)).toHaveValue('synthetic-password');
    await expect(secret(page)).toHaveValue(SECRET);
    await expect(user(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_manager_user_empty'));
    for (const field of [user(page), password(page), secret(page)]) {
      await expect(field).not.toHaveAttribute('aria-invalid', 'true');
    }
  }
  await closeSettings(page);
  const unsaved = page.getByRole('dialog', { name: await text(page, 'options_credentialsUnsaved'), exact: true });
  await expect(unsaved).toBeVisible();
  await unsaved.getByRole('button', { name: await text(page, 'options_credentialsContinue'), exact: true }).tap();
  await expect(unsaved).toHaveCount(0);
  await expect(password(page)).toHaveValue('synthetic-password');
  await closeSettings(page);
  await unsaved.getByRole('button', { name: await text(page, 'options_credentialsDiscard'), exact: true }).tap();
  await expect(page.locator('.PrefModal')).toHaveCount(0);
  await openCredentials(page);
  await expect(user(page)).toHaveValue('');
  await expect(user(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_manager_user_empty'));
  expect(await providerOperations(page)).toEqual(['saveCredentials', 'saveCredentials']);

  await page.evaluate(() => { window.__credentialHost.saveError = null; });
  await fillCredentials(page);
  await closeSettings(page);
  await unsaved.getByRole('button', { name: await text(page, 'options_credentialsSave'), exact: true }).tap();
  await expect(page.locator('.PrefModal')).toHaveCount(0);
  await openCredentials(page);
  await expectPresence(page, false);
  expect(await providerOperations(page)).toEqual(['saveCredentials', 'saveCredentials', 'saveCredentials']);
});

test('mobile storage selection persists immediately without enabling save and independently retains both destinations', async ({ page }) => {
  await bootSettings(page, 'local');
  const radio = async source => page.locator('.PrefModal').getByRole('radio', {
    name: await text(page, 'options_credentialsSource_' + source), exact: true,
  });
  await expect(await radio('local')).toBeChecked();
  await expect(user(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_local_user_empty'));
  await fillCredentials(page, SECRET);
  await (await saveButton(page)).tap();
  await expect(user(page)).toHaveValue('');
  await expect(user(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_local_user_saved'));
  await expect(secret(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_local_otpSecret_saved'));
  await expectNoHorizontalOverflow(page);
  await page.locator('.PrefModal').getByRole('radiogroup', { name: await text(page, 'options_credentialsSource') }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('credentials-local-source.png'), animations: 'disabled' });

  await (await radio('manager')).tap();
  await expect(user(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_manager_user_empty'));
  await expect(await radio('manager')).toBeChecked();
  expect(await page.evaluate(() => window.__credentialHost.source)).toBe('manager');
  await expect(await saveButton(page)).toBeDisabled();
  await closeSettings(page);
  await expect(page.locator('.PrefModal')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: await text(page, 'options_credentialsUnsaved'), exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__credentialHost.source)).toBe('manager');
  await openCredentials(page);
  await fillCredentials(page);
  await (await saveButton(page)).tap();
  await expectPresence(page, false);
  await (await radio('local')).tap();
  await expect(user(page)).toHaveValue('');
  await expect(secret(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_local_otpSecret_saved'));
  await expect(await saveButton(page)).toBeDisabled();
  await closeSettings(page);
  await openCredentials(page);
  await expect(await radio('local')).toBeChecked();
  await expect(secret(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_local_otpSecret_saved'));
  const saves = await page.evaluate(() => window.__credentialHost.requests.filter(request => request.op === 'saveCredentials'));
  expect(saves.map(({ source, user }) => ({ source, replaced: !!user }))).toEqual([
    { source: 'local', replaced: true }, { source: 'manager', replaced: false },
    { source: 'manager', replaced: true }, { source: 'local', replaced: false },
  ]);
  const webStorage = await page.evaluate(() => Object.values(localStorage).join('\n'));
  for (const value of ['offline-reader', 'synthetic-password', SECRET]) expect(webStorage).not.toContain(value);
});

test('mobile source-switch failures retain the previous choice and switching never writes pending credential input', async ({ page }) => {
  await bootSettings(page, 'local');
  const radio = async source => page.locator('.PrefModal').getByRole('radio', {
    name: await text(page, 'options_credentialsSource_' + source), exact: true,
  });
  await page.evaluate(() => { window.__credentialHost.saveError = 'failed'; });
  await (await radio('manager')).tap();
  await expect(page.locator('.PrefModal').getByRole('status')).toHaveText(await text(page, 'options_credentials_failed'));
  await expect(await radio('local')).toBeChecked();
  await expect(await saveButton(page)).toBeDisabled();
  expect(await page.evaluate(() => window.__credentialHost.source)).toBe('local');

  await fillCredentials(page, SECRET);
  await page.evaluate(() => { window.__credentialHost.saveError = null; });
  await (await radio('manager')).tap();
  await expect(await radio('manager')).toBeChecked();
  await expect(user(page)).toHaveValue('offline-reader');
  await expect(password(page)).toHaveValue('synthetic-password');
  await expect(secret(page)).toHaveValue(SECRET);
  await expect(await saveButton(page)).toBeEnabled();
  const selections = await page.evaluate(() => window.__credentialHost.requests.filter(request => request.op === 'saveCredentials'));
  expect(selections).toHaveLength(2);
  for (const selection of selections) {
    expect(selection.source).toBe('manager');
    expect(selection.user).toBeUndefined();
    expect(selection.password).toBeUndefined();
  }
  await closeSettings(page);
  const unsaved = page.getByRole('dialog', { name: await text(page, 'options_credentialsUnsaved'), exact: true });
  await unsaved.getByRole('button', { name: await text(page, 'options_credentialsDiscard'), exact: true }).tap();
  await expect(page.locator('.PrefModal')).toHaveCount(0);
  await openCredentials(page);
  await expect(await radio('manager')).toBeChecked();
  await expect(user(page)).toHaveAttribute('placeholder', await text(page, 'placeholder_manager_user_empty'));
});

test('mobile validation shows red field borders and reasons below each invalid input', async ({ page }) => {
  await bootSettings(page);
  const normalColors = await secret(page).evaluate(element => ({
    text: getComputedStyle(element).color,
    placeholder: getComputedStyle(element, '::placeholder').color,
  }));
  await secret(page).fill('123456');
  await (await saveButton(page)).tap();
  for (const [field, key] of [
    [user(page), 'options_credentials_userRequired'],
    [password(page), 'options_credentials_passwordRequired'],
    [secret(page), 'options_credentials_invalidSecret'],
  ]) {
    const message = page.locator('.PrefModal').getByText(await text(page, key), { exact: true });
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAccessibleDescription(await text(page, key));
    await message.scrollIntoViewIfNeeded();
    const color = await message.evaluate(element => getComputedStyle(element).color);
    await expect(field).toHaveCSS('border-top-color', color);
    await expect(field).toHaveCSS('color', normalColors.text);
    expect(await field.evaluate(element => getComputedStyle(element, '::placeholder').color)).toBe(normalColors.placeholder);
    const [inputRect, messageRect] = await Promise.all([field.boundingBox(), message.boundingBox()]);
    expect(messageRect.y).toBeGreaterThanOrEqual(inputRect.y + inputRect.height);
  }
  await password(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('credentials-field-errors.png'), animations: 'disabled' });
  await expectNoHorizontalOverflow(page);
  expect(await providerOperations(page)).toEqual([]);

  await user(page).fill('offline-reader');
  await expect(user(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(password(page)).toHaveAttribute('aria-invalid', 'true');
  await user(page).fill('');
  await secret(page).fill('12345');
  await password(page).focus();
  await expect(user(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(secret(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(password(page)).toHaveAttribute('aria-invalid', 'true');
  await (await saveButton(page)).tap();
  await expect(user(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(secret(page)).toHaveAttribute('aria-invalid', 'true');
  await user(page).fill('offline-reader');
  await password(page).fill('synthetic-password');
  await secret(page).fill('');
  await (await saveButton(page)).tap();
  await expectPresence(page, false);
  expect(await providerOperations(page)).toEqual(['saveCredentials']);
});
