# Android password-manager credentials

In Settings → Automatic login, enter a complete username and password, with an
optional 2FA authenticator secret, then choose **Save credentials**. This works
without a PTT connection and while automatic login is disabled. Ordinary login
preferences remain shared with the browser version and retain save-on-close
behavior; the Android credential draft is separate from those preferences.

Only the explicit save action requests password-manager creation or replacement.
Opening or closing settings does not retrieve credentials or query the provider's
inventory. Leaving with a draft offers Save, Discard, or Continue editing. A
complete replacement requires username and password; an empty optional secret
removes automatic TOTP for that entry. An entirely empty form leaves the saved
credentials alone. Successful saving clears every field, including the username.
Cancelled or failed saving keeps the draft for retry.
Input validation marks each invalid field with a red border and an explanation
below it. Fixing one field clears that field's error while leaving other errors
visible. Provider failures without field-specific information use an overall
status message rather than marking an arbitrary input.

The placeholder of each empty field reports its own last-confirmed saved state.
The installed app stores only three presence flags, updated after a confirmed
provider save or successful retrieval. Changing data externally can make these
flags stale. Status reads do not prompt for provider authentication. The optional
secret shares the existing password envelope; PttChrome generates TOTP codes,
while the password manager independently controls its own synchronization.

## Platform contract

- Native configuration advertises `credentialSave: true`. An older APK shows an
  upgrade explanation and cannot use the new editor; it does not substitute
  plaintext preferences or guess a save result.
- `storePassword` returns confirmed success or a sanitized `cancelled`/`failed`
  error. A successful provider operation followed by metadata persistence failure
  reports that saving could not be confirmed; an external provider side effect
  cannot be rolled back by PttChrome.
- `getPasswordStatus` reads app-private atomic metadata and returns only
  `presence: { user, password, otpSecret }`. No credential values are stored there.
- `getPassword` retains the existing password and optional-secret envelope format.
  Successful retrieval refreshes presence metadata. Provider cancellation or
  failure never erases the last-confirmed flags.
- Confirmed replacement invalidates the page's login cache. A pending older
  chooser result cannot refill it. An established PTT connection is unchanged;
  the next connection login retrieves the updated entry.
- Existing main-frame, configured-origin and backup restrictions remain in force.

Android drafts never enter preference persistence, synchronization, or export.
Credentials seen during saving or login also remain covered by diagnostic
redaction after the fields or login cache are cleared. The redaction registry is
page-local and is never persisted.

This is the first slice of [the Android storage redesign](https://github.com/NoReasonKen/PttChrome/issues/91).
Local encryption and explicit source selection follow in #93. Legacy plaintext
fallback removal and explicit local cleanup follow in #94; this slice retains
old preference data and does not automatically migrate it. The broader privacy
audit follows in #95. Browser-version storage and migration behavior are retained.

## Verification

Real-browser settings tests and a narrow mobile offline flow exercise explicit
saving, validation, cleared/reopened fields, unsaved choices, cancellation and
failure using a controlled Android message endpoint. Native JVM tests exercise
the provider workflow through a controlled provider and presence-store boundary.
These substitutes do not establish a real provider's UI or persistence behavior.

Device acceptance requires the updated APK and the reader's configured password
manager: explicitly save, verify the result and cleared fields, restart, then
verify retrieval for a subsequent login. Check cancellation and replacement
without an optional secret. No particular provider is required. Automated tests
use synthetic credentials and do not log into real PTT.
