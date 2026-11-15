# CI test scopes and timing

The reusable `test.yml` workflow runs the same coverage for PR Test and Deploy to
GitHub Pages. Its required aggregate checks remain `test / test-e2e-offline` and
`test / test-e2e-android`: both use `always()` and require their entire matrix to
succeed. A failed cell does not cancel siblings. GitHub's failed-job rerun can
therefore rerun a smaller scope without repeating successful cells.

## Ordinary offline replay

`yarn test:e2e:offline` still runs the complete ordinary suite locally and in
Flaky Hunt. Normal CI uses `yarn test:e2e:offline:group --group=<scope>
--shard=<index>/<total>` instead:

| Scope | Files | Existing projects | Shards |
| --- | --- | --- | --- |
| `desktop` | Non-mobile specs, including nested specs | `offline`, `offline-firefox` | 4 |
| `mobile-ui` | Top-level `mobile_` specs except `mobile_stack_` | `offline-mobile` | 3 |
| `mobile-stack` | Top-level `mobile_stack_` specs | `offline-mobile` | 2 |

The runner discovers files rather than maintaining an allowlist, including
nested directories. Only top-level `mobile_` files belong to the mobile project,
matching its existing `testMatch`; nested files retain desktop coverage. Projects,
fixtures, four-worker CI policy, browser coverage, recording and assertions are
unchanged. Firefox selection stays with desktop instead of paying setup for a
nine-test standalone job. Failure artifact names include scope, shard and attempt.
Unit contracts cover exact-once file selection, complete shard ranges, and the
required aggregate checks.

## Android emulator

Every cell owns an emulator and keeps one Playwright worker:

| Group | Coverage | Build |
| --- | --- | --- |
| `apk` | WebView shell, keyboard, links; opt-in updater; native instrumented tests | App and androidTest APKs |
| `credentials-privacy` | Legacy migration/cleanup, frame isolation, diagnostic redaction | App APK |
| `credentials-lifecycle` | Encrypted deletion, process restart/page-source changes, compatible APK replacement; opt-in version update | App APK |
| `chrome` | Real Android Chrome interaction specs | None |

Shared credential helpers contain no test registration; both specs retain their
original test bodies and opt-in skips. Every spec belongs to exactly one group,
and instrumentation runs only in `apk`. No group still means all specs plus
instrumentation; `--group=apk` now selects the shell scope, so use no group to run
all Android coverage. Flaky Hunt uses the same Android groups. Each additional
APK group pays its own build, emulator boot and fixture setup; there is no shared
build artifact dependency delaying the start of tests.

## Measurement and expected tradeoff

On 2026-11-15, nine successful runs were sampled: PR Test
[43665089336](https://github.com/NoReasonKen/PttChrome/actions/runs/43665089336),
[43672076043](https://github.com/NoReasonKen/PttChrome/actions/runs/43672076043),
[43680744633](https://github.com/NoReasonKen/PttChrome/actions/runs/43680744633),
[43682224556](https://github.com/NoReasonKen/PttChrome/actions/runs/43682224556),
[43692063890](https://github.com/NoReasonKen/PttChrome/actions/runs/43692063890);
Deploy to GitHub Pages
[43666042987](https://github.com/NoReasonKen/PttChrome/actions/runs/43666042987),
[43672921434](https://github.com/NoReasonKen/PttChrome/actions/runs/43672921434),
[43681500151](https://github.com/NoReasonKen/PttChrome/actions/runs/43681500151),
[43692872201](https://github.com/NoReasonKen/PttChrome/actions/runs/43692872201).

| Before splitting | Observed range |
| --- | --- |
| Each of four offline test steps (including dependency install) | 343–563 seconds |
| Offline job overhead outside that step | 33–54 seconds |
| APK job | 420–702 seconds |
| APK emulator step | 332–588 seconds |

The slowest offline shard changed between runs. These were different commits and
runner CPU identities were not compared; the sample establishes the bottleneck,
not a causal CPU explanation or a measured speedup. It contains no 13–15 minute
APK job.

The [example APK job](https://github.com/NoReasonKen/PttChrome/actions/runs/43682224556/job/132717656748)
spent 48 seconds building, 524 seconds in its emulator step and about 7.6 minutes
in Playwright. Shell cases summed to 78.4 seconds, the seven active credential
cases to about 332 seconds, and 12 instrumented cases to about three seconds.
Splitting credentials by privacy and lifecycle keeps their respective case sums
near 129 and 205 seconds instead of leaving a single 5.7-minute credential job.

The same run's offline logs contained 1,094 tests: 526 desktop, nine Firefox, 422
other mobile and 137 stacked-navigation cases. Their summed test durations were
3,232, 74, 2,691 and 1,170 seconds respectively. Dividing by four workers and the
chosen shard counts, then adding roughly 40–51 seconds of setup, gives optimistic
job estimates around 3–4.5 minutes. Current collection includes additional cases.
Worker scheduling, startup costs, runner variation and available Actions
concurrency make actual results differ. More cells increase total setup work and
runner minutes; measure both PR and post-merge runs before claiming a wall-clock
improvement. No retry, timeout or assertion is relaxed to obtain faster results.

Local collection verified that all 1,100 ordinary offline cases appear exactly
once across the nine cells (desktop: 135/135/134/134; mobile UI: 142/141/142;
mobile stack: 69/68). Collection also checks the Android partition against the
whole Android project: 21 cases, partitioned as 5/4/4/8 in the table's group order,
including opt-in cases even when they will be skipped.
