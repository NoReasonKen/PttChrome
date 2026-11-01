// @unit-env browser
// real-input: tests/e2e/offline/mobile_android_credentials.offline.spec.js
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PrefModal } from '../../src/components/ContextMenu/PrefModal';
import { setupI18n, i18n } from '../../src/js/i18n';
import { hideCredentialApi } from './helpers/credential_api';

const empty = { user: false, password: false, otpSecret: false };
let host;
const field = name => document.querySelector(`[name="${name}"]`);
const radio = source => screen.getByRole('radio', { name: i18n('options_credentialsSource_' + source) });

beforeAll(() => setupI18n());
beforeEach(() => {
  localStorage.clear();
  hideCredentialApi();
  host = { source: 'local', local: { presence: { ...empty } }, manager: { presence: { ...empty, user: true, password: true } }, sent: [], error: null };
  window.__PTT_ANDROID__ = { encryptedCredentials: true };
  window.PttAndroid = { postMessage(text) {
    const request = JSON.parse(text);
    host.sent.push(request);
    let reply = { ok: true, source: host.source, local: host.local, manager: host.manager };
    if (request.op === 'saveCredentials') {
      if (host.error) reply = { ok: false, error: host.error };
      else {
        host.source = request.source;
        if (request.user) host[request.source].presence = { user: true, password: true, otpSecret: request.password.startsWith('pttchrome:v1:') };
        reply = { ok: true, source: host.source, presence: host[host.source].presence };
      }
    }
    queueMicrotask(() => window.PttAndroid.onmessage({ data: JSON.stringify({ id: request.id, ...reply }) }));
  } };
});
afterEach(() => { delete window.PttAndroid; delete window.__PTT_ANDROID__; });

function openSettings() {
  const onSave = vi.fn();
  render(<MantineProvider><PrefModal show onSave={onSave} onReset={() => {}} /></MantineProvider>);
  fireEvent.click(screen.getByRole('tab', { name: i18n('options_autoLoginTab') }));
  return { onSave };
}

test('local is the initial source; draft changes do not persist, and empty explicit save selects retained manager data', async () => {
  openSettings();
  await waitFor(() => expect(radio('local')).toBeChecked());
  await waitFor(() => expect(field('autoLoginUser')).toHaveAttribute('placeholder', i18n('placeholder_local_user_empty')));
  fireEvent.click(radio('manager'));
  expect(radio('local')).not.toBeChecked();
  expect(host.source).toBe('local');
  expect(field('autoLoginUser')).toHaveValue('');
  expect(field('autoLoginUser')).toHaveAttribute('placeholder', i18n('placeholder_manager_user_saved'));
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(host.source).toBe('manager'));
  expect(screen.getByRole('button', { name: i18n('options_credentials_saved') })).toBeDisabled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(host.sent.filter(request => request.op === 'saveCredentials')).toEqual([expect.objectContaining({ source: 'manager' })]);
  expect(host.sent.some(request => request.user || request.password)).toBe(false);
  const preferences = localStorage.getItem('pttchrome.pref.v1') || '';
  expect(preferences).not.toContain('credentialSource');
});

test('successful saving confirms inside the button for exactly three seconds even when the reader starts editing again', async () => {
  openSettings();
  await waitFor(() => expect(radio('local')).toBeEnabled());
  fireEvent.change(field('autoLoginUser'), { target: { value: 'reader' } });
  fireEvent.change(field('autoLoginPassword'), { target: { value: 'synthetic-password' } });
  vi.useFakeTimers();
  try {
    await act(async () => fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') })));
    expect(screen.getByRole('button', { name: i18n('options_credentials_saved') })).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.change(field('autoLoginUser'), { target: { value: 'replacement' } });
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('button', { name: i18n('options_credentials_saved') })).toBeDisabled();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: i18n('options_credentialsSave') })).toBeEnabled();
    expect(host.sent.filter(request => request.op === 'saveCredentials')).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

test('local saving clears all fields and independently reflects optional-secret presence while automatic login is off', async () => {
  localStorage.setItem('pttchrome.pref.v1', JSON.stringify({ values: { autoLogin: false } }));
  openSettings();
  await waitFor(() => expect(radio('local')).toBeEnabled());
  expect(field('autoLogin')).not.toBeChecked();
  for (const [key, value] of Object.entries({ autoLoginUser: 'local-reader', autoLoginPassword: 'local-password', autoLoginOtpSecret: 'JBSWY3DPEHPK3PXP' })) {
    fireEvent.change(field(key), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(field('autoLoginUser')).toHaveValue(''));
  expect(field('autoLoginOtpSecret')).toHaveAttribute('placeholder', i18n('placeholder_local_otpSecret_saved'));
  expect(host.source).toBe('local');
  expect(host.sent.filter(request => request.op === 'saveCredentials')).toEqual([
    expect.objectContaining({ source: 'local', user: 'local-reader', password: 'pttchrome:v1:JBSWY3DPEHPK3PXP:local-password' }),
  ]);
  fireEvent.change(field('autoLoginUser'), { target: { value: 'replacement' } });
  fireEvent.change(field('autoLoginPassword'), { target: { value: 'replacement-pass' } });
  await waitFor(() => expect(screen.getByRole('button', { name: i18n('options_credentialsSave') })).toBeEnabled(), { timeout: 4000 });
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(field('autoLoginPassword')).toHaveValue(''));
  expect(field('autoLoginOtpSecret')).toHaveAttribute('placeholder', i18n('placeholder_local_otpSecret_empty'));
  for (const key of ['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret']) expect(field(key)).toHaveValue('');
});

test('a failed source-and-credential save preserves the active source, old presence, and draft until discard', async () => {
  const { onSave } = openSettings();
  await waitFor(() => expect(radio('manager')).toBeEnabled());
  fireEvent.click(radio('manager'));
  fireEvent.change(field('autoLoginUser'), { target: { value: 'replacement' } });
  fireEvent.change(field('autoLoginPassword'), { target: { value: 'replacement-pass' } });
  host.error = 'cancelled';
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(i18n('options_credentials_cancelled')));
  expect(host.source).toBe('local');
  expect(field('autoLoginPassword')).toHaveValue('replacement-pass');
  expect(field('autoLoginUser')).toHaveAttribute('placeholder', i18n('placeholder_manager_user_saved'));
  fireEvent.click(screen.getByLabelText('Close'));
  const dialog = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(dialog).getByRole('button', { name: i18n('options_credentialsDiscard') }));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(host.source).toBe('local');
});

test('leaving with only an unsaved source choice offers save, discard, and continued editing', async () => {
  const { onSave } = openSettings();
  await waitFor(() => expect(radio('manager')).toBeEnabled());
  fireEvent.click(radio('manager'));
  fireEvent.click(screen.getByLabelText('Close'));
  let dialog = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(dialog).getByRole('button', { name: i18n('options_credentialsContinue') }));
  expect(onSave).not.toHaveBeenCalled();
  expect(host.source).toBe('local');
  expect(radio('manager')).toBeChecked();
  fireEvent.click(screen.getByLabelText('Close'));
  dialog = await screen.findByRole('dialog', { name: i18n('options_credentialsUnsaved') });
  fireEvent.click(within(dialog).getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(host.source).toBe('manager');
});

test('unreadable local storage is visible without claiming field presence or blocking a retained manager source', async () => {
  host.local.error = 'unreadable';
  openSettings();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(i18n('options_credentials_unreadable')));
  expect(field('autoLoginUser')).not.toHaveAttribute('placeholder');
  fireEvent.click(radio('manager'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(field('autoLoginUser')).toHaveAttribute('placeholder', i18n('placeholder_manager_user_saved'));
  fireEvent.click(screen.getByRole('button', { name: i18n('options_credentialsSave') }));
  await waitFor(() => expect(host.source).toBe('manager'));
});

test('manual editing waits for the installed app to identify the active source', async () => {
  let finishStatus;
  window.PttAndroid.postMessage = text => {
    const request = JSON.parse(text);
    finishStatus = () => window.PttAndroid.onmessage({ data: JSON.stringify({
      id: request.id, ok: true, source: 'manager', local: host.local, manager: host.manager,
    }) });
  };
  openSettings();
  for (const name of ['autoLoginUser', 'autoLoginPassword', 'autoLoginOtpSecret']) expect(field(name)).toBeDisabled();
  finishStatus();
  await waitFor(() => expect(radio('manager')).toBeChecked());
  expect(field('autoLoginUser')).toBeEnabled();
});
