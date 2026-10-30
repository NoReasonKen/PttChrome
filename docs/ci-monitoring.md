# CI monitoring and notification latency

Run one background monitor for the exact pushed source and keep its compact state
inside the checkout's private Git directory:

```bash
yarn ci:status --branch dev --sha <full-sha> --state-file <private-state.json>
```

Capture its output to a scratch log without piping away its exit status. The
existing script owns polling and workflow-creation grace periods. State contains
only the source, branch, selected run identities/outcomes and timestamps, not API
credentials, request headers or logs.

When a background-task completion event can resume the controlling session, use
that event. A detached process alone does not provide such a wake-up mechanism.
Otherwise, a scheduled follow-up can read the state file: pending state requires
no notification; a terminal result should be acknowledged once and handled.
Keep the scheduled prompt short and reference the state file and remaining task
instead of repeating a complete handoff on every tick.

```bash
yarn ci:ack --ack <private-state.json>
```

`detectionDelayMs` measures the latest applicable completed run's GitHub
`updated_at` timestamp to detection by the monitor. This is an observable proxy
for remote completion, not a guarantee about job-end timestamps.
`resumeDelayMs` measures detection to acknowledgement by the resumed session.
Repeated acknowledgement preserves the original time. A pending result cannot
be acknowledged. Missing timestamps or negative clock differences remain unknown.
With `--no-wait`, an incomplete CI snapshot stays pending even though the existing
CLI returns a nonzero status; only a completed outcome or monitoring error can
be acknowledged.

Measure these intervals independently. A requested scheduler interval does not
prove the actual wake-up cadence, and fast API polling alone does not establish
fast notification. Remove the scheduled follow-up after its task is complete.
