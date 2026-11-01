// @unit-env browser
// real-input: tests/e2e/offline/mobile_android_credentials.offline.spec.js
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PrefModal } from '../../src/components/ContextMenu/PrefModal';
import { setupI18n, i18n } from '../../src/js/i18n';
import { DEFAULT_PREFS, readValuesWithDefault } from '../../src/js/pref_storage';
import { AutoLogin, _resetSessionCredentialForTest } from '../../src/js/auto_login';
import { hideCredentialApi } from './helpers/credential_api';

const legacy = { autoLoginUser: 'old-reader', autoLoginPassword: 'old-password', autoLoginOtpSecret: 'ABCDEFGHIJKLMNOP' };
const empty = () => ({ user: false, password: false, otpSecret: false });
let host;
const field = name => document.querySelector(`[name="${name}"]`);

beforeAll(() => setupI18n());
beforeEach(() => {
  localStorage.clear();
  hideCredentialApi();
  _resetSessionCredentialForTest();
  host = { source: 'local', requests: [], local: empty(), manager: empty(), saveError: null, deleteError: null };
  window.__PTT_ANDROID__ = { encryptedCredentials: true, credentialDeletion: true };
  window.PttAndroid = { postMessage(text) {
    const request = JSON.parse(text);
    host.requests.push(request);
    let response = { ok: true, source: host.source, local: { presence: host.local }, manager: { presence: host.manager } };
    if (request.op === 'saveCredentials') {
      if (host.saveError) response = { ok: false, error: host.saveError };
      else {
        host.source = request.source;
        if (request.user) host[host.source] = { user: true, password: true, otpSecret: request.password.startsWith('pttchrome:v1:') };
        response = { ok: true, source: host.source, presence: host[host.source] };
      }
    } else if (request.op === 'deleteLocalCredentials') {
      if (host.deleteError) response = { ok: false, error: host.deleteError };
      else {
        host.local = empty();
        response = { ok: true, source: host.source, presence: host.local };
      }
    } else if (request.op === 'getLoginCredential') {
      response = host[host.source].user
        ? { ok: true, source: host.source, user: 'saved-reader', password: 'saved-password' }
        : { ok: false, error: 'missing' };
    }
    queueMicrotask(() => window.PttAndroid.onmessage({ data: JSON.stringify({ id: request.id, ...response }) }));
  } };
});
afterEach(() => {
  delete window.PttAndroid;
  delete window.__PTT_ANDROID__;
  _resetSessionCredentialForTest();
});

async function mountSettings() {
  localStorage.setItem('pttchrome.pref.v1', JSON.stringify({ values: { ...DEFAULT_PREFS, ...legacy, lineWrap: 65 } }));
  const props = { show: true, onSave: vi.fn(), onReset: vi.fn() };
  const ui = render(<MantineProvider><PrefModal {...props} /></MantineProvider>);
  fireEvent.click(screen.getByRole('tab', { name: i18n('options_autoLoginTab') }));
  await waitFor(() => expect(screen.getByRole('radio', { name: i18n('options_credentialsSource_' + host.source) })).toBeEnabled());
  return { ...ui, ...props };
}

function enterCredentials() {
  fireEvent.change(field('autoLoginUser'), { target: { value: 'new-reader' } });
  fireEvent.change(field('autoLoginPassword'), { target: { value: 'new-password' } });
}

test('confirmed local enrollment removes legacy plaintext without repopulating it when settings close', async () => {
  await mountSettings();
  expect(field('autoLoginUser')).toHaveValue('');
  enterCredentials();
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave'), exact: true }));
  await waitFor(() => expect(field('autoLoginUser')).toHaveValue(''));
  expect(readValuesWithDefault()).toMatchObject({ autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '', lineWrap: 65 });
  fireEvent.click(screen.getByLabelText('Close'));
  expect(readValuesWithDefault().autoLoginPassword).toBe('');
});

test.each(['local', 'manager'])('a failed %s save preserves retained plaintext and the draft', async source => {
  host.source = source;
  host.saveError = 'failed';
  await mountSettings();
  expect(screen.getByRole('note')).toHaveTextContent(i18n('options_credentialsLegacySetup'));
  enterCredentials();
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave'), exact: true }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(i18n('options_credentials_failed')));
  expect(readValuesWithDefault()).toMatchObject(legacy);
  expect(field('autoLoginUser')).toHaveValue('new-reader');
});

test('password-manager saving and retrieval retain old plaintext without using its secret', async () => {
  host.source = 'manager';
  await mountSettings();
  enterCredentials();
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave'), exact: true }));
  await waitFor(() => expect(field('autoLoginUser')).toHaveValue(''));
  const login = new AutoLogin({});
  expect(await login._resolveCredential(readValuesWithDefault())).toMatchObject({ user: 'saved-reader', otpSecret: '' });
  expect(readValuesWithDefault()).toMatchObject(legacy);
});

async function deletion(kind) {
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsDelete' + kind), exact: true }));
  return screen.findByRole('dialog', { name: i18n('options_credentialsDelete' + kind) });
}
async function confirmDeletion(kind) {
  const dialog = await deletion(kind);
  fireEvent.click(within(dialog).getByRole('button', { name: i18n('options_credentialsConfirmDelete'), exact: true }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
}

test('legacy cleanup is confirmed, preserves other settings and cannot be undone by the open settings snapshot', async () => {
  await mountSettings();
  const dialog = await deletion('Legacy');
  fireEvent.click(within(dialog).getByRole('button', { name: i18n('options_credentialsCancelDelete') }));
  expect(readValuesWithDefault()).toMatchObject(legacy);
  await confirmDeletion('Legacy');
  expect(readValuesWithDefault()).toMatchObject({ autoLoginUser: '', autoLoginPassword: '', autoLoginOtpSecret: '', lineWrap: 65 });
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Close'));
  expect(readValuesWithDefault().autoLoginPassword).toBe('');
  expect(host.requests.every(request => request.op === 'getCredentialStatus')).toBe(true);
});

test('deleting a retrieved local entry invalidates the cache without deleting legacy or external data or disconnecting', async () => {
  host.local = { user: true, password: true, otpSecret: false };
  host.manager = { user: true, password: true, otpSecret: true };
  const app = { connectState: 1, disconnect: vi.fn(), sendData: vi.fn(), view: { flashListHint: vi.fn() } };
  const login = new AutoLogin(app);
  expect(await login._resolveCredential(DEFAULT_PREFS)).toMatchObject({ user: 'saved-reader' });
  await mountSettings();
  const dialog = await deletion('Local');
  fireEvent.click(within(dialog).getByRole('button', { name: i18n('options_credentialsCancelDelete') }));
  expect(host.local.user).toBe(true);
  expect(host.requests.filter(request => request.op === 'deleteLocalCredentials')).toHaveLength(0);
  await confirmDeletion('Local');
  expect(field('autoLoginUser')).toHaveAttribute('placeholder', i18n('placeholder_local_user_empty'));
  expect(await login._resolveCredential(readValuesWithDefault())).toBeNull();
  expect(readValuesWithDefault()).toMatchObject(legacy);
  expect(host.manager).toEqual({ user: true, password: true, otpSecret: true });
  expect(host.source).toBe('local');
  expect(app.disconnect).not.toHaveBeenCalled();
  expect(app.sendData).not.toHaveBeenCalled();
});

test('failed deletion visibly preserves saved presence and usable credentials', async () => {
  host.local = { user: true, password: true, otpSecret: false };
  host.deleteError = 'failed';
  await mountSettings();
  await confirmDeletion('Local');
  expect(screen.getByRole('status')).toHaveTextContent(i18n('options_credentials_deleteFailed'));
  expect(field('autoLoginUser')).toHaveAttribute('placeholder', i18n('placeholder_local_user_saved'));
  expect(await new AutoLogin({})._resolveCredential(DEFAULT_PREFS)).toMatchObject({ user: 'saved-reader' });
});

test('a pending retrieval cannot repopulate the login cache after confirmed deletion', async () => {
  host.local = { user: true, password: true, otpSecret: false };
  await mountSettings();
  const original = window.PttAndroid.postMessage;
  let pending;
  window.PttAndroid.postMessage = text => {
    const request = JSON.parse(text);
    if (request.op === 'getLoginCredential') pending = request;
    else original(text);
  };
  const login = new AutoLogin({ view: { flashListHint: vi.fn() } });
  const retrieving = login._resolveCredential(DEFAULT_PREFS);
  await waitFor(() => expect(pending).toBeDefined());
  await confirmDeletion('Local');
  await act(async () => window.PttAndroid.onmessage({ data: JSON.stringify({
    id: pending.id, ok: true, source: 'local', user: 'deleted-reader', password: 'deleted-password',
  }) }));
  expect(await retrieving).toBeNull();
  window.PttAndroid.postMessage = original;
  expect(await login._resolveCredential(DEFAULT_PREFS)).toBeNull();
});

test('a lost delete acknowledgement cannot let the old page cache conceal an already deleted native entry', async () => {
  host.local = { user: true, password: true, otpSecret: false };
  await mountSettings();
  const login = new AutoLogin({ view: { flashListHint: vi.fn() } });
  expect(await login._resolveCredential(DEFAULT_PREFS)).toMatchObject({ user: 'saved-reader' });
  const original = window.PttAndroid.postMessage;
  window.PttAndroid.postMessage = text => {
    const request = JSON.parse(text);
    if (request.op !== 'deleteLocalCredentials') return original(text);
    host.local = empty();
    // Simulate native commit followed by a failed acknowledgement, without
    // waiting for a real bridge timeout in the browser unit suite.
    queueMicrotask(() => window.PttAndroid.onmessage({ data: JSON.stringify({ id: request.id, ok: false, error: 'failed' }) }));
  };
  await confirmDeletion('Local');
  expect(screen.getByRole('status')).toHaveTextContent(i18n('options_credentials_deleteFailed'));
  expect(await login._resolveCredential(DEFAULT_PREFS)).toBeNull();
});

test('a local save reports a failed plaintext cleanup without losing the confirmed encrypted enrollment', async () => {
  await mountSettings();
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Unavailable', 'QuotaExceededError'); });
  try {
    enterCredentials();
    fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave'), exact: true }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(i18n('options_credentials_legacyCleanupFailed')));
    expect(field('autoLoginUser')).toHaveValue('');
    expect(host.local.user).toBe(true);
    expect(readValuesWithDefault()).toMatchObject(legacy);
  } finally { write.mockRestore(); }
});

test('legacy deletion failure is visible and preserves the prompt and stored data', async () => {
  await mountSettings();
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Unavailable', 'QuotaExceededError'); });
  try {
    await confirmDeletion('Legacy');
    expect(screen.getByRole('status')).toHaveTextContent(i18n('options_credentials_deleteFailed'));
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(readValuesWithDefault()).toMatchObject(legacy);
  } finally { write.mockRestore(); }
});

test('an older encrypted-storage APK explains that deletion requires an update', async () => {
  delete window.__PTT_ANDROID__.credentialDeletion;
  host.local = { user: true, password: true, otpSecret: false };
  await mountSettings();
  expect(screen.getByRole('button', { name: i18n('options_credentialsDeleteLocal') })).toBeDisabled();
  expect(screen.getByText(i18n('options_credentialsDeleteUpgrade'))).toBeVisible();
  expect(host.requests.some(request => request.op === 'deleteLocalCredentials')).toBe(false);
});
