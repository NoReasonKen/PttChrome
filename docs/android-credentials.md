# Android login credentials

Settings → Automatic login offers **Local encrypted storage** and **Password
manager** with one shared username, password, and optional 2FA authenticator-secret
form. Local encryption is initially selected but unconfigured. Enter credentials
manually and choose **Save credentials**; nothing is imported automatically.
Saving works offline and while automatic login is disabled.

Only saving commits a source choice or replacement. An entirely empty form
changes only the source, retaining both destinations independently. A replacement
requires username and password; a blank optional secret removes automatic TOTP
for that entry. Successful saving clears every input, including the username,
and displays **Saved successfully** inside the disabled save button for three
seconds. Success adds no separate message below the button; errors and cancellation
remain visible as explanatory text. Editing during the confirmation does not end
its three-second duration.
No saved identity, secrets, or masking-dot values are repopulated. Each field's
placeholder independently reports presence for the draft destination. Changing
the draft source never changes the active login source until saved.

Leaving with credential edits or an unsaved source choice offers Save, Discard,
or Continue editing. Failed/cancelled saving preserves the draft and previous
active source. Only Save validates fields, with a red border and an explanation
below each invalid input. Editing clears that field's error until the next Save;
text and placeholders keep their normal colors. Other preferences retain their
normal save-on-close behavior.

## Native persistence and login

- The installed app owns source selection and the retained encrypted record,
  shared across its explicitly configured production and development page sources.
  Existing main-frame checks and configured-origin allowlists remain unchanged.
- An app-owned, non-exportable Android Keystore AES-256 key protects the username,
  password, and optional-secret envelope using AES-GCM with a fresh random IV,
  a 128-bit authentication tag, and versioned associated data. Only ciphertext,
  IV, format, and source selection enter the atomic private record under
  `Context.noBackupFilesDir`. No raw key is persisted beside the record.
- Ordinary starts and compatible in-place APK updates reuse the key. Normal use
  adds no biometric/PIN prompt or unusual device setting. This protects persisted
  data; login still requires transient plaintext in the trusted app/page process.
- Selection and local replacement commit together in one atomic write. A failed
  write preserves the previous record. An unreadable existing record is never
  overwritten or used to justify regenerating a missing key. Its status shows an
  explicit error, not a usable saved account or an empty enrollment.
- Login reads only the selected destination. Local selection never requests
  password-manager authentication or saving. Missing, cancelled, or failed reads
  stop automatic login with a visible error, without another source or legacy
  plaintext fallback. Successful source changes/replacements invalidate the
  page's login cache; stale pending retrievals cannot refill it. An established
  PTT session is not interrupted. Disabling automatic login retains enrollment.
- Password and optional-secret decoding, TOTP generation, bounded attempts, and
  manual verification when no secret is saved use the existing login flow.
- Both storage destinations retain their data across source switches. PttChrome
  does not copy credentials or request external provider deletion. Password-manager
  verification and independent synchronization remain controlled by that provider.

The provider's per-field metadata records only the last confirmed save/retrieval.
Status reads never open the provider or retrieve identities. External edits may
make that metadata stale. Provider save cancellation/failure is not success;
if an external save succeeds but subsequent app persistence fails, PttChrome
cannot roll back the external provider and does not claim the transaction succeeded.

## Bridge and privacy

Native configuration advertises `encryptedCredentials: true`. Older APKs show an
upgrade explanation and disable the redesigned editor/login rather than pretending
encryption works. Browser-version storage and migration behavior are unchanged.

| Operation | Request | Successful response |
| --- | --- | --- |
| `getCredentialStatus` | No credentials | `source`, `local` and `manager` status containing `presence: { user, password, otpSecret }`; destination errors carry only sanitized codes |
| `saveCredentials` | `source: local/manager`, optional complete `user`/`password` pair | Confirmed `source` and `presence` |
| `getLoginCredential` | No source override | Selected `source`, `user`, and existing password/optional-secret envelope |

Errors are sanitized `missing`, `cancelled`, `failed`, `unreadable`, or invalid
request outcomes; raw platform exceptions and credential values are never logged.
Legacy provider operations remain available to older loaded pages.

Drafts and source choice never enter ordinary web preferences, cloud sync, or
settings exports. The native record is excluded from Android backup and transfer;
clearing app data, uninstalling, or changing devices requires manual enrollment.
Credentials encountered during save/login are registered with diagnostic
redaction before use, even after fields or login caches are cleared. The
redaction registry is page-local and never persisted.

This implements #92 and #93 of [the Android storage redesign](https://github.com/NoReasonKen/PttChrome/issues/91).
Retained legacy plaintext is unused, not migrated. Automatic removal after local
enrollment and confirmed local deletion follow in #94. The broader cross-feature
privacy audit follows in #95; these do not defer basic protection of new secrets.

## Verification

Real-browser unit and narrow mobile offline tests cover shared settings, radios,
draft selection, validation, cleared fields, placeholders, unsaved choices,
failures, cache invalidation and strict-source login. Their Android endpoint is
a controlled substitute, not evidence of installed Keystore behavior. JVM tests
cover source transactions and real JCE authenticated-encryption roundtrips/tampering.

`tests/e2e/android/credentials.android.spec.js` uses the installed debug APK,
actual bridge/Keystore and offline synthetic PTT prompts. It covers fresh-process
retrieval, ciphertext inspection, optional TOTP, approved page sources, compatible
package replacement and clearing app data. A genuinely higher-version compatible
APK can be supplied through `ANDROID_CREDENTIAL_UPDATE_APK`; reinstalling the same
artifact is explicitly separate from version-update evidence. Supplemental
`DeviceCredentialsInstrumentedTest` checks actual Keystore authentication policy,
non-exportability, integrity failure and unavailable-key preservation with isolated
test records. The Android CI emulator runs those instrumentation checks after
the offline APK flow. These require an available Android device/emulator; compiling them
or passing browser/JVM substitutes alone does not establish native acceptance.

Device acceptance also uses the reader's configured **password manager** for
actual save/update/cancellation/retrieval UI. No particular provider is required.
All automated credentials and protocol responses are synthetic; no real PTT
login is part of these tests.
