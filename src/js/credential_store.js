// Credential storage boundary. Android owns its selected source and encrypted
// record; the browser keeps its Credential Management API behavior. Both carry
// the existing optional-secret password envelope, decoded by the login caller.
// Native result/status helpers expose only allowlisted fields and error codes.

import { androidBridgeAvailable, requestAndroid } from './android_bridge';

export function androidEncryptedCredentialsAvailable() {
  return androidBridgeAvailable() && window.__PTT_ANDROID__.encryptedCredentials === true;
}

const sourceValid = source => source === 'local' || source === 'manager';
const presenceKeys = ['user', 'password', 'otpSecret'];
function readPresence(value) {
  if (!value || !presenceKeys.every(key => typeof value[key] === 'boolean')) return null;
  return Object.fromEntries(presenceKeys.map(key => [key, value[key]]));
}

// Native source and metadata belong to the installed app, never web preferences.
// Allowlist response fields so a status request cannot populate identity values.
export async function getAndroidCredentialStatus() {
  if (!androidEncryptedCredentialsAvailable()) return null;
  try {
    const result = await requestAndroid('getCredentialStatus');
    if (!result?.ok || !sourceValid(result.source)) return null;
    const local = readPresence(result.local?.presence);
    const manager = readPresence(result.manager?.presence);
    if (!local || !manager) return null;
    return {
      source: result.source,
      local: { presence: local, ...(result.local.error ? { error: 'unreadable' } : {}) },
      manager: { presence: manager, ...(result.manager.error ? { error: 'failed' } : {}) },
    };
  } catch {
    return null;
  }
}

export async function saveAndroidCredentials({ source, id, password }) {
  if (!androidEncryptedCredentialsAvailable() || !sourceValid(source)) return { status: 'unavailable' };
  try {
    const payload = { source };
    if (id || password) Object.assign(payload, { user: id || '', password: password || '' });
    const result = await requestAndroid('saveCredentials', payload);
    const presence = readPresence(result?.presence);
    if (result?.ok && result.source === source && presence) {
      return { status: 'saved', source, presence };
    }
    return { status: result?.error === 'cancelled' ? 'cancelled' : result?.error === 'unreadable' ? 'unreadable' : 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

export async function getAndroidLoginCredential(source) {
  if (!androidEncryptedCredentialsAvailable()) return { status: 'unavailable' };
  try {
    const result = await requestAndroid('getLoginCredential');
    if (result?.ok && result.source === source &&
        typeof result.user === 'string' && result.user &&
        typeof result.password === 'string' && result.password) {
      return { status: 'ready', credential: { id: result.user, password: result.password } };
    }
    return { status: ['missing', 'cancelled', 'unreadable'].includes(result?.error) ? result.error : 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

export function androidCredentialDeletionAvailable() {
  return androidEncryptedCredentialsAvailable() && window.__PTT_ANDROID__.credentialDeletion === true;
}

export async function deleteAndroidLocalCredentials() {
  if (!androidCredentialDeletionAvailable()) return { status: 'unavailable' };
  try {
    const result = await requestAndroid('deleteLocalCredentials');
    const presence = readPresence(result?.presence);
    if (result?.ok && sourceValid(result.source) && presence &&
        presenceKeys.every(key => !presence[key])) {
      return { status: 'deleted', source: result.source, presence };
    }
    return { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

export function androidCredentialSaveAvailable() {
  return androidBridgeAvailable() && window.__PTT_ANDROID__.credentialSave === true;
}

// Native metadata describes only the last confirmed provider operation. Reading
// it never opens the provider or retrieves an account identity or secret.
export async function getPasswordManagerPresence() {
  if (!androidCredentialSaveAvailable()) return null;
  try {
    const result = await requestAndroid('getPasswordStatus');
    const keys = ['user', 'password', 'otpSecret'];
    if (!result?.ok || !result.presence ||
        !keys.every(key => typeof result.presence[key] === 'boolean')) return null;
    return Object.fromEntries(keys.map(key => [key, result.presence[key]]));
  } catch {
    return null;
  }
}

const browserApiAvailable = () =>
  typeof window !== 'undefined' && !!window.PasswordCredential &&
  !!(navigator.credentials && navigator.credentials.get &&
     navigator.credentials.store);

export function credentialStoreAvailable() {
  return androidBridgeAvailable() || browserApiAvailable();
}

export async function getStoredCredential() {
  if (androidEncryptedCredentialsAvailable()) {
    const status = await getAndroidCredentialStatus();
    if (!status) return null;
    const result = await getAndroidLoginCredential(status.source);
    return result.credential || null;
  }
  if (androidBridgeAvailable()) {
    const r = await requestAndroid('getPassword');
    if (r && r.ok && r.user && r.password) {
      return { id: r.user, password: r.password };
    }
    return null;
  }
  if (!browserApiAvailable()) return null;
  const cred = await navigator.credentials.get({
    password: true,
    mediation: 'optional'
  });
  if (cred && cred.password) return { id: cred.id, password: cred.password };
  return null;
}

export async function storeCredential({ id, password }) {
  if (androidBridgeAvailable()) {
    try {
      const result = await requestAndroid('storePassword', { user: id, password });
      if (result?.ok) return { status: 'saved' };
      return { status: result?.error === 'cancelled' ? 'cancelled' : 'failed' };
    } catch {
      return { status: 'failed' };
    }
  }
  if (!browserApiAvailable()) return { status: 'unavailable' };
  try {
    await navigator.credentials.store(
      new window.PasswordCredential({ id, password, name: 'PTT' })
    );
    // Browser store() can resolve before its save UI is accepted. Keep that
    // legacy path separate from Android's confirmed native save contract.
    return { status: 'requested' };
  } catch {
    return { status: 'failed' };
  }
}
