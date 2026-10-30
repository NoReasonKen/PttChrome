# Android APK updates

Settings > About separates installed APK identity from the online reading-page
build. Reading-page deployment is unchanged. Older APKs and browsers show release
history and a manual Releases link without claiming native update capabilities.
The native App Settings page and launcher shortcut retain their existing routes.

## Ownership and policy

The native updater owns device-local preferences, trusted release discovery,
DownloadManager IDs, verified files, and installer handoff. The web update store
exposes snapshots and explicit actions; it never receives APK bytes or supplies
an arbitrary native download URL. Bridge origin/main-frame restrictions still
apply. The PTT connection service does not own update downloads.

Automatic checks run on launch/foreground after 24 hours since success, with at
least one hour between automatic attempts after failure. Manual checks bypass
those gates. Development-page mode suppresses automatic checks. Version skips
and the default-on automatic-check switch remain local, outside cloud sync.

Only stable releases from this fork are accepted. The latest metadata includes
the last native-change version code, so a device that missed a native update is
still prompted when the newest release is web-only. Check errors remain errors;
they are never reported as evidence that the installed version is current.

## Download and installation

DownloadManager owns background transfer, including system retry/resume. A
responsive modal blocks PttChrome interaction through download and verification.
Back and Escape do not cancel or close underlying settings; Home/app switching
remain available. Only Cancel download removes the active request. Terminal
failure releases the modal and requires explicit retry.

The downloaded file must match the release digest/size, installed package and
signer, expected increasing version code, minimum SDK and supported native ABI.
After verification, an app-private retained APK remains available if installation
is postponed or canceled. It is verified again before installation. A retained
file that no longer verifies is discarded so it can be downloaded again.

The system completion receiver accepts DownloadProvider's signature-protected
completion broadcast, then reconciles the updater's own persisted request rather
than trusting a broadcast-supplied artifact. Background completion can notify
without taking focus; denied notification permission does not block the flow.
On return, native state restores progress or opens the ready result in About.

Installation requires a separate confirmation, explains interruption and unsent
input, and invokes the existing reading-position checkpoint. Android handles
source-install permission and the installation UI. Canceling either does not
delete the verified APK. The updater does not preserve drafts or force-launch the
app afterward; existing recovery preferences govern normal next startup.

## Release records and language

See [release publication](release-publishing.md) for authoritative records,
consecutive-release commit ranges, artifact metadata and publication synchronization.
Only confirmed published records appear in About. Summary text follows the
phone's primary system language: any Chinese language tag uses Traditional
Chinese; everything else uses English. General UI language selection is unchanged.
The reading bundle imports summaries and publication dates, not commit detail.

## Verification boundaries

Browser tests exercise real About/bridge/store interaction, modal ownership,
Back/Escape, summaries, errors and unsupported hosts. Native coordinator tests use
controlled external platform adapters to exercise lifecycle and policy. These do
not prove actual system download, broadcast or installation behavior.

Android device acceptance must verify background completion, denied notification
permission, interrupted download, source-install permission, canceled/failed
installation, overwrite installation and subsequent reading recovery. The
existing offline emulator fixture disables OS networking and cannot establish
DownloadManager transfer success unchanged. A controlled native transport can be
compiled into debug builds with an explicit loopback origin; release builds
always compile an empty test origin and retain the fixed production source.

## Controlled Android run

On a machine with the Android SDK, Java 21 and a usable emulator, run through the
shared local test queue:

```bash
scripts/when-idle.local.sh node scripts/run-update-android-e2e.mjs
```

The opt-in runner builds two debug-signed artifacts for the disposable debug
package, with increasing versions and a fixed loopback transport. It then runs
the connected About/bridge/DownloadManager/verification/system-installer tests.
The test resets only that debug package, enables OS networking for DownloadManager
and stubs the reader's PTT socket. A corrupted digest must fail without installation;
the valid artifact must overwrite the package with the higher version code.
Ordinary Android suites skip this spec unless those artifacts are supplied.
Default debug APKs keep their version suffix; only the explicit loopback fixture
build omits it so strict release identity checks remain testable.

This controlled run does not cover all physical-device acceptance above. Record
its actual outcome separately from JVM/browser results, and report an unavailable
emulator as unavailable rather than a pass.
