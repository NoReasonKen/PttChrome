// Keep values seen during this page's lifetime available to diagnostic export,
// even after a form is cleared or the login credential cache is replaced.
// This is not a login cache and is never persisted or included in preferences.
import { packCredential } from './credential_pack';
import { normalizeOtpSecret } from './totp';

const ids = new Set();
const secrets = new Set();

function remember(set, value) {
  if (typeof value === 'string' && value) set.add(value);
}

export function rememberCredential({ user, pass, otpSecret } = {}) {
  remember(ids, user);
  remember(secrets, pass);
  remember(secrets, otpSecret);
  const secret = normalizeOtpSecret(otpSecret);
  remember(secrets, secret);
  if (pass && secret) remember(secrets, packCredential(pass, secret));
}

export function credentialRedaction() {
  return {
    ids: [...ids],
    // Redact complete envelopes before their password or secret substrings.
    secrets: [...secrets].sort((a, b) => b.length - a.length),
  };
}

export function _resetCredentialRedactionForTest() {
  ids.clear();
  secrets.clear();
}
