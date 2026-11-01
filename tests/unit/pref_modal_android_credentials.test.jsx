// @unit-env browser
// real-input: tests/e2e/offline/mobile_android_credentials.offline.spec.js
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PrefModal } from '../../src/components/ContextMenu/PrefModal';
import { setupI18n, i18n } from '../../src/js/i18n';
import { DEFAULT_PREFS, readValuesWithDefault } from '../../src/js/pref_storage';
import { hideCredentialApi } from './helpers/credential_api';
import { AutoLogin, _resetSessionCredentialForTest } from '../../src/js/auto_login';

let sent;
let saveResult;
let presence;
const SECRET = 'ABCDEFGHIJKLMNOP';
const field = name => document.querySelector(`[name="${name}"]`);
const typeCredentials = (secret = '') => {
  for (const [name, value] of Object.entries({
    autoLoginUser: 'reader', autoLoginPassword: 'synthetic-password', autoLoginOtpSecret: secret,
  })) fireEvent.change(field(name), { target: { value } });
};

function mountSettings(prefs = {}) {
  localStorage.setItem('pttchrome.pref.v1', JSON.stringify({ values: { ...DEFAULT_PREFS, ...prefs } }));
  const onSave = vi.fn();
  const onReset = vi.fn();
  const props = { show: true, onSave, onReset };
  const ui = render(<MantineProvider><PrefModal {...props} /></MantineProvider>);
  fireEvent.click(screen.getByRole('tab', { name: i18n('options_autoLoginTab') }));
  return { onSave, onReset, ...ui, reopen: () => {
    ui.rerender(<MantineProvider><PrefModal {...props} show={false} /></MantineProvider>);
    ui.rerender(<MantineProvider><PrefModal {...props} /></MantineProvider>);
  } };
}

beforeAll(() => setupI18n());
beforeEach(() => {
  hideCredentialApi();
  localStorage.clear();
  sent = [];
  saveResult = { ok: true };
  _resetSessionCredentialForTest();
  presence = { user: false, password: false, otpSecret: false };
  window.__PTT_ANDROID__ = { credentialSave: true };
  window.PttAndroid = {
    postMessage: text => {
      const msg = JSON.parse(text);
      sent.push(msg);
      if (msg.op === 'storePassword' && saveResult.ok) {
        presence = { user: true, password: true, otpSecret: msg.password.startsWith('pttchrome:v1:') };
      }
      queueMicrotask(() => window.PttAndroid.onmessage({ data: JSON.stringify({
        id: msg.id, ...(msg.op === 'storePassword' ? saveResult : { ok: true }), presence,
      }) }));
    },
  };
});
afterEach(() => {
  delete window.PttAndroid;
  delete window.__PTT_ANDROID__;
});

test('explicit Android save works offline with automatic login disabled, then clears fields without plaintext preferences', async () => {
  const { reopen } = mountSettings({ autoLogin: false });
  typeCredentials(SECRET);
  expect(sent.filter(m => m.op === 'getPassword' || m.op === 'storePassword')).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(field('autoLoginUser')).toHaveValue(''));
  expect(sent.find(m => m.op === 'storePassword')).toMatchObject({ user: 'reader', password: `pttchrome:v1:${SECRET}:synthetic-password` });
  expect(readValuesWithDefault()).toMatchObject({ autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '' });
  reopen();
  await waitFor(() => expect(field('autoLoginUser')).toHaveAttribute('placeholder', i18n('placeholder_manager_user_saved')));
  expect(field('autoLoginPassword')).toHaveValue('');
  expect(field('autoLoginOtpSecret')).toHaveValue('');
  expect(field('autoLoginOtpSecret')).toHaveAttribute('placeholder', i18n('placeholder_manager_otpSecret_saved'));
  expect(sent.filter(m => m.op === 'getPassword')).toEqual([]);
});

test.each(['cancelled', 'failed'])('a %s replacement preserves the previous metadata and editable draft', async error => {
  presence = { user: true, password: true, otpSecret: true };
  mountSettings();
  await waitFor(() => expect(field('autoLoginOtpSecret')).toHaveAttribute('placeholder', i18n('placeholder_manager_otpSecret_saved')));
  typeCredentials();
  saveResult = { ok: false, error };
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(i18n('options_credentials_' + error)));
  expect(field('autoLoginPassword')).toHaveValue('synthetic-password');
  expect(field('autoLoginUser')).toHaveValue('reader');
  expect(field('autoLoginOtpSecret')).toHaveAttribute('placeholder', i18n('placeholder_manager_otpSecret_saved'));
  for (const name of ['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret']) {
    expect(field(name)).not.toHaveAttribute('aria-invalid', 'true');
  }
  expect(readValuesWithDefault().autoLoginPassword).toBe('');
});

test('a complete password-only replacement clears the optional-secret presence without inheriting legacy data', async () => {
  presence = { user: true, password: true, otpSecret: true };
  const { reopen } = mountSettings({ autoLoginUser: 'old-reader', autoLoginPassword: 'old-password', autoLoginOtpSecret: SECRET });
  expect(field('autoLoginUser')).toHaveValue('');
  typeCredentials();
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(field('autoLoginUser')).toHaveValue(''));
  expect(sent.find(m => m.op === 'storePassword').password).toBe('synthetic-password');
  expect(field('autoLoginOtpSecret')).toHaveAttribute('placeholder', i18n('placeholder_manager_otpSecret_empty'));
  fireEvent.click(screen.getByLabelText('Close'));
  expect(readValuesWithDefault().autoLoginPassword).toBe('old-password');
  reopen();
  await waitFor(() => expect(field('autoLoginOtpSecret')).toHaveAttribute('placeholder', i18n('placeholder_manager_otpSecret_empty')));
  expect(field('autoLoginPassword')).toHaveValue('');
});

test.each([
  ['autoLoginUser', 'reader', ['autoLoginPassword']],
  ['autoLoginPassword', 'synthetic-password', ['autoLoginUser']],
  ['autoLoginOtpSecret', SECRET, ['autoLoginUser', 'autoLoginPassword']],
])('marks each missing required field for a partial replacement containing only %s', async (name, value, missing) => {
  mountSettings();
  fireEvent.change(field(name), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  for (const key of missing) {
    await waitFor(() => expect(field(key)).toHaveAttribute('aria-invalid', 'true'));
    expect(field(key)).toHaveAccessibleDescription(i18n(key === 'autoLoginUser' ? 'options_credentials_userRequired' : 'options_credentials_passwordRequired'));
  }
  expect(field(name)).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(sent.filter(m => m.op === 'storePassword')).toHaveLength(0);
  expect(field(name)).toHaveValue(value);
});

test('invalid TOTP is rejected; a complete URI is normalized and saved explicitly', async () => {
  mountSettings();
  typeCredentials('123456');
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(field('autoLoginOtpSecret')).toHaveAttribute('aria-invalid', 'true'));
  expect(field('autoLoginOtpSecret')).toHaveAccessibleDescription(i18n('options_credentials_invalidSecret'));
  expect(sent.filter(m => m.op === 'storePassword')).toHaveLength(0);
  fireEvent.change(field('autoLoginOtpSecret'), { target: { value: `otpauth://totp/reader?secret=${SECRET}&issuer=PTT` } });
  fireEvent.blur(field('autoLoginOtpSecret'));
  expect(field('autoLoginOtpSecret')).toHaveValue(SECRET);
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(field('autoLoginOtpSecret')).toHaveValue(''));
});

test('blurring a malformed authenticator URI preserves the invalid draft for correction', async () => {
  mountSettings();
  const malformed = 'otpauth://totp/reader?issuer=PTT';
  typeCredentials(malformed);
  fireEvent.blur(field('autoLoginOtpSecret'));
  expect(field('autoLoginOtpSecret')).toHaveValue(malformed);
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(field('autoLoginOtpSecret')).toHaveAttribute('aria-invalid', 'true'));
  expect(field('autoLoginOtpSecret')).toHaveAccessibleDescription(i18n('options_credentials_invalidSecret'));
  expect(sent.filter(m => m.op === 'storePassword')).toHaveLength(0);
});

test('editing clears only that field error until another explicit save, even if it remains invalid', async () => {
  mountSettings();
  fireEvent.change(field('autoLoginOtpSecret'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  for (const name of ['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret']) {
    await waitFor(() => expect(field(name)).toHaveAttribute('aria-invalid', 'true'));
  }
  fireEvent.change(field('autoLoginUser'), { target: { value: 'reader' } });
  expect(field('autoLoginUser')).not.toHaveAttribute('aria-invalid', 'true');
  expect(field('autoLoginPassword')).toHaveAttribute('aria-invalid', 'true');
  expect(field('autoLoginOtpSecret')).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(field('autoLoginUser'), { target: { value: '' } });
  expect(field('autoLoginUser')).not.toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(field('autoLoginOtpSecret'), { target: { value: '12345' } });
  fireEvent.blur(field('autoLoginOtpSecret'));
  expect(field('autoLoginOtpSecret')).not.toHaveAttribute('aria-invalid', 'true');
  expect(field('autoLoginPassword')).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  for (const name of ['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret']) {
    expect(field(name)).toHaveAttribute('aria-invalid', 'true');
  }
  fireEvent.blur(field('autoLoginOtpSecret'));
  expect(field('autoLoginOtpSecret')).toHaveAttribute('aria-invalid', 'true');
  expect(sent.filter(m => m.op === 'storePassword')).toHaveLength(0);
});

test('saving an invalid draft from the close confirmation returns to the marked fields', async () => {
  const { onSave } = mountSettings();
  fireEvent.change(field('autoLoginUser'), { target: { value: 'reader' } });
  fireEvent.click(screen.getByLabelText('Close'));
  const confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n('options_credentialsUnsaved') })).not.toBeInTheDocument());
  expect(field('autoLoginPassword')).toHaveAttribute('aria-invalid', 'true');
  expect(field('autoLoginPassword')).toHaveAccessibleDescription(i18n('options_credentials_passwordRequired'));
  expect(onSave).not.toHaveBeenCalled();
  expect(field('autoLoginUser')).toHaveValue('reader');
});

test('closing an empty form saves ordinary settings without retrieving or storing credentials', () => {
  const { onSave } = mountSettings();
  fireEvent.click(field('autoLogin'));
  fireEvent.click(screen.getByLabelText('Close'));
  expect(onSave).toHaveBeenCalled();
  expect(readValuesWithDefault().autoLogin).toBe(false);
  expect(sent.filter(m => m.op === 'getPassword' || m.op === 'storePassword')).toHaveLength(0);
});

test('unsaved credentials can continue editing, discard, or explicitly save before closing', async () => {
  const { onSave, reopen } = mountSettings();
  typeCredentials();
  fireEvent.click(screen.getByLabelText('Close'));
  expect(onSave).not.toHaveBeenCalled();
  let confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsContinue') }));
  expect(field('autoLoginUser')).toHaveValue('reader');
  fireEvent.click(screen.getByLabelText('Close'));
  confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsDiscard') }));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(sent.filter(m => m.op === 'storePassword')).toHaveLength(0);
  reopen();
  typeCredentials();
  fireEvent.click(screen.getByLabelText('Close'));
  confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(sent.filter(m => m.op === 'storePassword')).toHaveLength(1);
  expect(readValuesWithDefault().autoLoginUser).toBe('');
});

test('a cancelled save from the unsaved dialog does not close settings or drop the draft', async () => {
  const { onSave } = mountSettings();
  typeCredentials();
  saveResult = { ok: false, error: 'cancelled' };
  fireEvent.click(screen.getByLabelText('Close'));
  const confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(within(confirmation).getByRole('status')).toHaveTextContent(i18n('options_credentials_cancelled')));
  expect(onSave).not.toHaveBeenCalled();
  expect(field('autoLoginPassword')).toHaveValue('synthetic-password');
});

test('an older APK cannot silently use the old ambiguous save contract', () => {
  delete window.__PTT_ANDROID__.credentialSave;
  mountSettings();
  expect(screen.getByRole('alert')).toHaveTextContent(i18n('options_credentialsUpgrade'));
  expect(field('autoLoginUser')).toBeDisabled();
  expect(screen.getByRole('button', { name: i18n('options_credentialsSave') })).toBeDisabled();
  expect(sent).toHaveLength(0);
});

test('importing settings defers both persistence and closing until the credential draft is handled', async () => {
  const { onReset } = mountSettings();
  typeCredentials();
  fireEvent.click(screen.getByRole('tab', { name: i18n('options_backup') }));
  const original = readValuesWithDefault().autoLogin;
  const file = new File([JSON.stringify({ prefs: { autoLogin: !original } })], 'settings.json', { type: 'application/json' });
  const selectImport = () => fireEvent.change(document.querySelector('.PrefModal input[type="file"]'), { target: { files: [file] } });
  selectImport();
  let confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  expect(onReset).not.toHaveBeenCalled();
  expect(readValuesWithDefault().autoLogin).toBe(original);
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsContinue') }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n('options_credentialsUnsaved') })).not.toBeInTheDocument());
  expect(readValuesWithDefault().autoLogin).toBe(original);
  selectImport();
  confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsDiscard') }));
  await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
  expect(readValuesWithDefault().autoLogin).toBe(!original);
  expect(sent.filter(m => m.op === 'storePassword')).toHaveLength(0);
});

test('restoring defaults asks about the credential draft before changing any preferences', async () => {
  const { onReset } = mountSettings({ autoLogin: false });
  typeCredentials();
  fireEvent.click(screen.getByRole('button', { name: i18n('options_reset') }));
  const confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  expect(onReset).not.toHaveBeenCalled();
  expect(readValuesWithDefault().autoLogin).toBe(false);
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsDiscard') }));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(readValuesWithDefault().autoLogin).toBe(DEFAULT_PREFS.autoLogin);
});

test('an import that finishes after new credential edits still protects the current draft', async () => {
  const { onReset } = mountSettings();
  fireEvent.click(screen.getByRole('tab', { name: i18n('options_backup') }));
  let finishReading;
  const file = new File([], 'settings.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => new Promise(resolve => { finishReading = resolve; }) });
  fireEvent.change(document.querySelector('.PrefModal input[type="file"]'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('tab', { name: i18n('options_autoLoginTab') }));
  typeCredentials();
  await act(async () => finishReading(JSON.stringify({ prefs: { autoLogin: false } })));
  const confirmation = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  expect(onReset).not.toHaveBeenCalled();
  expect(readValuesWithDefault().autoLogin).toBe(true);
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n('options_credentialsContinue') }));
  expect(field('autoLoginPassword')).toHaveValue('synthetic-password');
});

test('confirmed replacement invalidates cached login credentials without starting a connection', async () => {
  let account = { ok: true, user: 'previous-reader', password: 'previous-password' };
  const endpoint = window.PttAndroid.postMessage;
  window.PttAndroid.postMessage = text => {
    const msg = JSON.parse(text);
    if (msg.op !== 'getPassword') return endpoint(text);
    sent.push(msg);
    queueMicrotask(() => window.PttAndroid.onmessage({ data: JSON.stringify({ id: msg.id, ...account }) }));
  };
  const login = new AutoLogin({ connectState: 1 });
  expect(await login._resolveCredential(DEFAULT_PREFS)).toMatchObject({ user: 'previous-reader' });
  mountSettings();
  typeCredentials();
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(field('autoLoginUser')).toHaveValue(''));
  account = { ok: true, user: 'reader', password: 'synthetic-password' };
  expect(await login._resolveCredential(DEFAULT_PREFS)).toMatchObject({ user: 'reader', pass: 'synthetic-password', otpSecret: '' });
  expect(sent.filter(m => m.op === 'getPassword')).toHaveLength(2);
});
