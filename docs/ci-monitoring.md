# CI monitoring and notification latency

Agent monitoring, acknowledgement, retries and deployment verification follow
the project's `watch-ci` skill. This reference describes the state and timing
reported by `scripts/ci-status.mjs` and `scripts/ci-watch-state.mjs`.

The private file selected by `--state-file` contains the source, branch,
selected run identities/outcomes and timestamps. It omits API credentials,
request headers and logs.

The adjacent `<state-file>.failures.json` keeps metadata for reported failures,
keyed by repository, source SHA, run, attempt and job. It suppresses repeated
log fetches and diagnostic output for that failure without retaining log
bodies. A new attempt or job is reported separately; an unavailable log can
be fetched again on the next poll.

`detectionDelayMs` measures the latest applicable completed run's GitHub
`updated_at` timestamp to detection by the monitor. This is an observable proxy
for remote completion, not a guarantee about job-end timestamps.
`resumeDelayMs` measures detection to acknowledgement by the resumed session.
Repeated acknowledgement preserves the original time. A pending result cannot
be acknowledged. Missing timestamps or negative clock differences remain unknown.
With `--no-wait`, an incomplete CI snapshot stays pending even though the existing
CLI returns a nonzero status; only a completed outcome or monitoring error can
be acknowledged.

Measure these intervals independently. Polling cadence alone does not establish
how soon the controlling session receives and handles the result.
