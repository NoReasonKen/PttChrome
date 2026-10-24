# Independent APK: security remediation and publication

Status: unfinished. The user requested a handoff after the current tests, before
continuing publication. This handoff starts with the reported GitHub secret
scanning alert, including the resulting security work and release blockers.
Do not publish an APK or enable further production enforcement in this session.
Resume publication when the user asks to continue.

## Goal and constraints

- Publish a signed, directly downloadable **PttChrome Fork** APK, with this
  fork's own Firebase preference sync. Publication was already authorized.
- Cloud sync is initially owner-only. Hide the entire cloud section from normal
  users; reveal the session-only setup entry with `#cloud-sync-setup`. Backend
  authorization still requires the administrator-granted boolean `cloudSync`
  claim. The setup URL grants no data access.
- Keep the Firebase Spark plan, billing unlinked, and no paid upgrades. Terms
  requiring personal acceptance were accepted by the user.
- Use Traditional Chinese with the user, English for code/docs, Traditional
  Chinese for README. Work on local-primary `dev`; automatically commit completed
  milestones after relevant checks. Never commit credentials or machine details.
- Start user-reported reading investigations with Android article easy reading,
  but preserve shared behavior across the repository.
- [Issue #6](https://github.com/NoReasonKen/PttChrome/issues/6) tracks publication.
  [Issue #5](https://github.com/NoReasonKen/PttChrome/issues/5), the image-viewer
  loading queue, remains **backlog**; do not implement it during this work.

## Security alert and remediation

The user reported [secret-scanning alert #1](https://github.com/NoReasonKen/PttChrome/security/secret-scanning/1)
because a Firebase Browser API key had been committed literally in
`src/js/firebase_config.js`. The user deleted that key and created a replacement.

Completed, with service readback during this session:

- The old Browser key was deleted. Alert #1 was resolved as **revoked**; the last
  checked list contained no open secret-scanning alerts.
- Git history was not rewritten. Older commits still contain the revoked browser
  identifier; rotation and restrictions address its use. Do not describe source
  removal as erasing the old value from history.
- After the environment restart, a fresh alert API read returned HTTP 404 despite
  working repository admin access. The earlier resolved/revoked readback remains
  the available evidence; this 404 does not freshly confirm alert state. Check
  the security UI/API again when resuming if necessary.
- The replacement is stored in GitHub Actions secret `FIREBASE_API_KEY` and the
  ignored local `.env.local` (private file permissions). Do not reproduce either
  key value in code, documentation, tickets, logs, or chat.
- Commit `1642f59` removes the literal source value, injects the selected input
  during production builds, and fails a production build with no key. The blank
  template `.env.example` is tracked; `.env` and `.env.*` are ignored.
- The production build excludes App Check debug input even when that environment
  variable is present. Tests and a built-output canary check verified this.
- Integration tests use a fake emulator API key and need no production key.
- Both Browser and Android keys are restricted to these six APIs:
  `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`,
  `firebaseappcheck.googleapis.com`, `firebase.googleapis.com`,
  `logging.googleapis.com`, and `firestore.googleapis.com`.
- The Browser key additionally allows only this fork's GitHub Pages origin and
  its Firebase Auth helper origin, using root and path referrer patterns. Auth
  configuration probes returned 200 for an allowed referrer and 403 for foreign
  or absent referrers. Production localhost access is intentionally excluded.
- The Android key additionally allows only the release package and certificate
  SHA-1. Firebase requests in the app's HTTPS WebView use the Browser key; native
  Google sign-in uses its OAuth registration.
- Audited tracked files and this fork's patches for recognizable private keys,
  GitHub/OAuth/access/refresh tokens and exact locally held signing passwords,
  signing-store content, CLI tokens, and OAuth provider client secret: no private
  credential was found. The downloaded signed APK also contained no private
  credential file or signing password.

**Security distinction:** environment injection avoids committing the value; it
does not make a Firebase browser key secret. The shipped JavaScript contains it.
Protection comes from API/application restrictions, Auth, Firestore rules, and
App Check. Server credentials, signing keys/passwords, OAuth client secrets,
and administrative tokens must remain private. See
[Firebase API key guidance](https://firebase.google.com/docs/projects/api-keys)
and [preference sync](../pref-sync-firestore.md).

## Cloud provisioned so far

- Active project: `pttchrome-7fae4`, number `1012243465943`; billing remained
  unlinked at the last service readback. An earlier Cloud-only project,
  `pttchrome-noreasonken`, was not used or deleted.
- Web app: `1:1012243465943:web:e2a9996308186f24fed292`.
- Release Android app: `1:1012243465943:android:e5d5527c79db53dffed292`.
- Package: `io.github.noreasonken.pttchrome`; debug uses `.debug` and does not yet
  have its own Firebase/Google sign-in registration.
- Google provider is enabled. Web/Android OAuth clients and release signing
  certificate were checked against generated Android configuration. Authorized
  Auth domains include the fork's GitHub host and its project Firebase domains.
- The Firebase Auth helper site exists and `/__/auth/handler` returned HTTP 200.
- Firestore Standard `(default)` is in `asia-east1`. Deployed rules exactly
  matched `firestore.rules`: matching user UID **and boolean** `cloudSync: true`.
  Anonymous access was denied. Emulator tests deny false/string claims,
  cross-user access and client self-elevation while preserving local settings.
- The intended owner was pre-authorized after private Google identity
  verification. No account email/UID belongs in this public handoff. First real
  Google sign-in and device-to-device sync still require user acceptance.
- reCAPTCHA Enterprise App Check is configured for the exact production GitHub
  domain, no localhost/test bypass, one-day token TTL and minimum score 0.5.
  **Firestore App Check enforcement has NOT been enabled.** Obtain a token with
  the actual published SDK/client first, then enable and read back enforcement.
  Do not lower the score or add a debug bypass merely to pass headless tests.
- Do not enable Auth App Check enforcement by upgrading to paid Identity
  Platform. An experiment exchanging the Firebase CLI's Google token for Firebase
  sign-in failed due to the audience; do not weaken the audience to make it work.

The private sync UI/backend and denial cleanup are already committed. Ordinary
users see local backup only. The private entry captures cold-start/hash changes;
an authorized session reveals controls automatically. Denial signs out and
preserves local preferences, including after an established listener loses access.
See [Android guide](../android-app.md) and [sync guide](../pref-sync-firestore.md).

## Release state and signing

- No release tag or downloadable APK has been published yet. Planned first tag:
  `android-v0.1.0`, after the selected dev revision passes deployment checks.
- Native identity is independent: **PttChrome Fork**, package above, page
  `https://noreasonken.github.io/PttChrome/`. Upstream attribution is preserved.
- Four signing secrets are configured in GitHub: `ANDROID_KEYSTORE_B64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- The fixed encrypted signing store, metadata and passwords are private outside
  Git. Preserve them; use existing private local provisioning state. Do not
  regenerate the key or upload it/passwords to a release. A separate maintainer
  backup is still important for future updates.
- [Android run 40097957000](https://github.com/NoReasonKen/PttChrome/actions/runs/40097957000)
  passed native tests, release build and signature verification. Its downloaded
  APK certificate matched the registered release certificate. This was a dev
  artifact, not a published release or proof of device acceptance.
- `android.yml` fails release tags missing signing inputs, verifies the signed
  APK, and publishes `pttchrome.apk` plus `LICENSE`, tagged source/archive links
  and installation instructions. Version code is the workflow run number.
- This fork has no deployed root Digital Asset Links file. Users may manually
  enable the supported domain in Android settings. Sideloaded app and Chrome
  credentials remain separate; do not claim automatic association.

## CI failures encountered and fixes

| Requirement | Evidence and current fix |
| --- | --- |
| Browser unit mock isolation | Shared manual mock factories/cached Vitest shims crossed isolated documents. Use the real signed-out sync adapter, spy-only overrides where needed, the real AI platform boundary, and `Cache-Control: no-store` for the test server. No dependency workaround. Full unit passed after this fix. |
| [#7](https://github.com/NoReasonKen/PttChrome/issues/7): E2E container startup | Original deployment failed before tests with missing `lsof`. Commit `405f70b` adds shared `.github/actions/setup-e2e`, default root E2E containers and the existing browser image. A follow-up root Firefox launch used another user's inherited HOME; local commit `03a39ba` gives only Firefox the actual root account home on Linux CI. Related 62 tests passed; actual container launch still needs next CI. |
| [#8](https://github.com/NoReasonKen/PttChrome/issues/8): fork link / observer check | Updated stale upstream setup-link expectation. Commit `303f16b` fixes ResizeObserver test attribution for `content-visibility:auto` skipped content, retaining last delivery instead of fabricating zero. Negative controls keep real loops detectable. No product rendering behavior was changed by that commit. |
| [#9](https://github.com/NoReasonKen/PttChrome/issues/9): reading position | Strict mobile 50% restoration exposed a real defect: a fractional bookmark was applied while its image row was temporarily short; late image expansion changed the saved position by 25px. Reproduced with either observer guard. Initially deferred, then promoted to a release blocker when CI failed it. Product fix and validation are below. |

Latest completed deployment run:
[40118167454](https://github.com/NoReasonKen/PttChrome/actions/runs/40118167454)
on `303f16b` **failed**. Normal offline shard 4 failed the bookmark case and
Firefox startup; other test jobs, including adverse, unit, integration and
Android E2E, passed. There has not been a successful selected-revision Pages
deployment. Do not claim that the public site serves the pending changes.

Pushes from this environment did not automatically start the expected workflow;
the cause was not established. If no run appears after pushing, dispatch
`deploy.yml` on `dev`, then use `yarn ci:status --branch dev --sha <commit>` with
private `GH_TOKEN` to wait for the complete workflow. Do not hide its exit status,
skip failed checks or retry away known assertions. Leave #7/#8/#9 open until their
criteria and the complete dev deployment are green.

## Reading-position fix awaiting CI

New `src/js/scroll_restore_follow.js` and `easy_reading.js` preserve the saved row
fraction as that row changes size. A small local ResizeObserver watches only the
target row and reading viewport, coalesces animation frames, and retargets through
the existing view-update hook. Reader wheel/touch/pointer/key input, a new restore,
article cleanup or invalid connection/mode releases ownership. No polling, fixed
readiness delay or eager loading of all images. No public API signature changed.

The original strict three-proportion regression assertions remain unchanged.
Tests were added at real TermView/EasyReading integration and actual browser input
seams; temporarily removing wheel cancellation made the new E2E fail as expected.
Contracts were updated in `docs/reading-record.md` and `docs/core-api-research.md`.

Validation before the final full run:

- Original 25/50/80% mobile restoration stress: **15/15 passed**.
- Full mobile restoration file, including real input takeover: **7/7 passed**.
- Related unit tests: **213/213 passed**.
- Adjacent desktop/mobile offline batch: **18/19 passed**. One existing reverse
  reading test (`easy_reading_reverse`, first case) observed simulator
  `overlaps=13` instead of zero under four workers. Its isolated two repetitions
  passed. This was not repaired or classified as harmless; preserve this evidence
  and investigate if it recurs. The failing case does not request a restore.
- Mobile screenshot inspected: readable dark layout, no observed clipping.

Final full-run results are recorded in the final checkpoint below.
The first unrestricted full-unit/adverse runs competed for memory: RAM and swap
were exhausted and unrelated cases timed out for minutes. The environment then
restarted; those processes and `/tmp` logs/helpers/artifacts disappeared. Those
runs are **interrupted, not passing evidence**. Repository changes and private
home provisioning state survived. Restart verification sequentially with limited
workers; do not run full unit and adverse suites concurrently here.

## Resume sequence

1. Read project instructions and affected topic docs. Inspect working tree and
   local `dev` versus `origin/dev`; commit/push state is recorded below. Preserve
   the existing release key and ignored key input.
2. Finish any pending local verification. No further live PTT login in this
   release task: the one allowed guest attempt was already rejected and closed.
   Do not retry, including after an environment restart. Offline replays do not
   consume this budget.
3. Push the verified fixes and wait for the entire selected-revision Pages CI.
   Own any new genuine failure under the repo CI rules. Close #7/#8/#9 only after
   confirmed completion; #6 still needs device acceptance.
4. Confirm the public HTML/assets and successful GitHub Pages deployment match
   that revision. Download its exact Pages artifact if inspecting SDK chunks;
   do not mix hashed assets from different builds.
5. Verify App Check through the published production SDK without PTT login
   (block WebSockets in browser probes). Then enable/read back Firestore
   enforcement. If real browser/WebView acceptance is needed, state that explicitly
   rather than using a production debug bypass. Recheck billing and key/rule
   restrictions. Earlier scratch admin/probe scripts are gone after the restart;
   regenerate safe private helpers as needed, never printing their credentials.
6. Tag the green revision `android-v0.1.0`, push, and if necessary dispatch
   `android.yml` on that tag. Verify signed release asset, certificate, license,
   tagged source links, and the actual downloadable URL before reporting success.
7. Give the user the release link and test instructions: install the fork next to
   upstream, import settings **before** first sync, re-enter local PTT credentials,
   check easy reading/gallery/background connection, then open the private setup
   URL in the installed app and sign in with the owner Google account. Browser
   sign-in does not establish APK sign-in. Test preference sync on a second device.
8. Set #6 to `ready-for-human` with exact remaining device acceptance. Never mark
   native Google login, WebView App Check or sync accepted without user evidence.
9. Delete this handoff when publication and its remaining work are complete.

## Final checkpoint

2026-10-25, stopped at the user's requested handoff boundary:

| Check | Result |
| --- | --- |
| `yarn test:unit --maxWorkers=2` | Exit 0; 442 files, 7,281 passed, 4 skipped; 98.44 seconds. |
| `yarn test:e2e:offline:adverse --workers=2` | Exit 0; all three batches green, 270 passed, 3 skipped; 10.3 minutes. Slow: 122 passed/1 skipped; broken: 73 passed/2 skipped; mixed: 75 passed. |
| `yarn build` | Exit 0; production build succeeded. |
| Diff/edit guard and privacy | Passed. A fresh recognizable-private-credential scan of source, workflows and Android files found none. The handoff contains no key value or private local path. |
| Cleanup | `yarn kill:dev --own` completed. No live PTT login was attempted again. |

- Product fix: local commit **`b061f22`**, including the new helper, regression
  tests and contract docs. Firefox configuration fix **`03a39ba`** is also local.
  This handoff is committed separately after those two commits.
- Remote `dev` was read back at **`303f16b`**. The two fixes and handoff have not
  been pushed; the working tree is clean after the handoff commit.
- No new CI dispatch, release tag, APK publication, production deployment, or
  App Check enforcement was performed after the user's handoff request.
- Current full unit/adverse/build checks are green. Full selected-revision
  GitHub CI, Firefox root-container execution and public deployment remain
  unverified. The earlier adjacent reverse-reading assertion remains recorded
  above; an isolated pass did not establish its cause.
- The last integration verification was 24 passing real emulator tests before
  the rendering fix; that fix does not change cloud code. Actual owner Google
  sign-in, native WebView App Check and device-to-device sync remain pending.
- #6/#7/#8/#9 remain open as `ready-for-agent`; #5 remains `backlog`. Resume at
  step 3 after checking repository state, without consuming another live login.
