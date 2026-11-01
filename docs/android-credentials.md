# Android login credentials

Settings → Automatic login offers **Local encrypted storage** and **Password
manager** with one shared username, password, and optional 2FA authenticator-secret
form. Local encryption is initially selected but unconfigured. Enter credentials
manually and choose **Save credentials**; nothing is imported automatically.
Saving works offline and while automatic login is disabled.

Changing the storage radio immediately persists the selected login source,
retaining both destinations independently. It never submits the input fields,
copies credentials, or opens the password manager. Controls wait for confirmation;
a failed switch preserves the previous source and any entered credentials.
Source changes affect the next connection, not an established PTT session.

Only **Save credentials** replaces credentials in the selected destination. A
replacement requires username and password; a blank optional secret removes automatic TOTP
for that entry. Successful saving clears every input, including the username,
and displays **Saved successfully** inside the disabled save button until the next
credential edit or source switch. There is no timed cooldown: a credential edit enables saving
immediately. Opening settings with empty unchanged fields leaves saving disabled;
clearing all input disables it again. Switching the source alone never enables
the save button; any existing unsaved input is retained for explicit saving. Success
adds no separate message below the button; errors and cancellation remain visible
as explanatory text.
No saved identity, secrets, or masking-dot values are repopulated. Each field's
placeholder independently reports presence for the selected destination.
The two long explanations below the 2FA secret field appear only while it is
focused or its current draft is nonempty; saved-secret presence alone does not show them.

Leaving with credential edits offers Save, Discard, or Continue editing; a source
switch alone needs no confirmation on exit. Failed/cancelled credential saving
preserves the draft and already selected source. Discarding input does not undo
a confirmed source switch. Only Save validates fields, with a red border and an explanation
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
| `deleteLocalCredentials` | No credentials; requires `credentialDeletion: true` | Unchanged `source` and empty local `presence` |

Errors are sanitized `missing`, `cancelled`, `failed`, `unreadable`, or invalid
request outcomes; raw platform exceptions and credential values are never logged.
Legacy provider operations remain available to older loaded pages.

Drafts and source choice never enter ordinary web preferences, cloud sync, or
settings exports. The native record is excluded from Android backup and transfer;
clearing app data, uninstalling, or changing devices requires manual enrollment.
Credentials encountered during save/login are registered with diagnostic
redaction before use, even after fields or login caches are cleared. The
redaction registry is page-local and never persisted.

## Legacy plaintext and local deletion

Old web preferences may still contain plaintext credentials. The Android login
path never uses them, even if the selected destination fails or returns nothing.
Settings explains their presence without filling any field; an unconfigured login
also prompts for manual setup. Password-manager selection, saving and retrieval
retain that copy unused. Only a confirmed local encrypted enrollment automatically
clears all three old fields. A failed enrollment retains them. If encryption succeeds
but web storage cleanup fails, the saved encrypted entry remains usable and settings
reports that explicit legacy cleanup is still needed.

**Clear old plaintext credentials** and **Delete local encrypted credentials** are
separate confirmed actions. Either can be cancelled without changing saved state.
They retain unrelated settings, the selected source, the other destination and the
current PTT connection. They never delete external password-manager entries.
Confirmed deletion invalidates cached and pending login results so a reconnect
cannot silently reuse the deleted entry. Ordinary preference saves, imports and
cloud merges cannot refresh or restore the old plaintext after cleanup.

Legacy cleanup affects the current reading-page origin's web preferences; encrypted
deletion affects the installed app's shared local record. An older APK without the
deletion capability shows an update explanation. Unreadable encrypted payloads can
be explicitly removed without decrypting them; a structurally corrupt record that
cannot identify the selected source reports failure instead of guessing a reset.
Storage failures remain visible and never claim deletion succeeded.

This implements #92, #93 and #94 of [the Android storage redesign](https://github.com/NoReasonKen/PttChrome/issues/91).
The broader cross-feature privacy audit follows in #95.

## Verification

Real-browser unit and narrow mobile offline tests cover shared settings, radios,
immediate source selection, validation, cleared fields, placeholders, unsaved input,
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
the offline APK flow, from the APKs built for that job, and fails when none of them
passed (see [Android e2e](android-e2e.md)). These require an available Android device/emulator; compiling them
or passing browser/JVM substitutes alone does not establish native acceptance.

Device acceptance also uses the reader's configured **password manager** for
actual save/update/cancellation/retrieval UI. No particular provider is required.
All automated credentials and protocol responses are synthetic; no real PTT
login is part of these tests.
