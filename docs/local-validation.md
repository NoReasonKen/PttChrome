# Local validation before committing

Stage the intended changes, then run:

```bash
yarn verify:commit --check build
```

The entry formats staged files, runs the full unit suite and then each selected
package script sequentially. Repeat `--check` for relevant non-unit coverage.
Select coverage appropriate to the change and obtain authorization for heavy
or live work under the project's existing test policy. Live E2E and recording
commands use their separate explicit owner-authorized flow, not this entry.
Omit additional checks only when no non-unit coverage is relevant.

## Exact offline coverage

Add individual files without running the full offline suite:

```bash
yarn verify:commit --check build \
  --offline-spec offline:tests/e2e/offline/lights_on.offline.spec.js \
  --offline-spec offline-mobile:tests/e2e/offline/mobile_float_tools.offline.spec.js
```

Repeat `--offline-spec <project>:<file>` as needed. The supported projects are
`offline`, `offline-mobile`, and `offline-firefox`; the last selects only
`selection.offline.spec.js`, as in the Playwright configuration. Files must exist
inside `tests/e2e/offline/`, with no glob, traversal, or symlink escape. Live,
recording, triage, and measurement projects are rejected.

Staged changes to the shared floating-tools host or renderer automatically add
the existing desktop recording, lights-on, mobile recording-on-home, and mobile
floating-tools specs. The small dependency map lives in `verify-commit.mjs`;
extend it alongside changes to those shared entry points and consumers. This
coverage supplements the explicitly selected files and is printed before tests.
It does not replace other relevant regression or adverse-image coverage.

The validation run holds the shared queue through unit, build, and each offline
file. Only the held local queue grants the linked-worktree override. Each file
uses this checkout's Playwright CLI and existing worker policy, requires a new
development server instead of reusing port 8080, and cleans up only this
checkout's server. Without a local queue, the existing worktree guard still
applies; this command does not acquire ownership of other sessions' resources.

The command does not commit, push, stage unrelated files or stash work. Unstaged
tracked changes and nonignored untracked files are blockers: stage the intended
files and handle unrelated work deliberately before validation.

When this machine's shared queue script exists, the entry waits for that queue
automatically. Calling it from an already queued command also works. Machines
without the local queue script, including cloud/Windows checkouts, execute checks
sequentially; this entry cannot coordinate other sessions there.

Successful validation writes a local receipt in this worktree's Git directory.
The receipt records HEAD and the staged tree, and is saved only if content stays
unchanged through validation. The pre-commit hook retains file/credential guards
and formatting, then requires a matching receipt. It does not run a second full
unit suite. Any later content or HEAD change invalidates the receipt and requires
validation again. A failed check removes the old receipt instead of allowing
an earlier successful run to authorize the new commit.

Receipts also record each selected offline project and file. The commit hook
recomputes the shared-tools requirements and rejects a receipt missing one.
Older receipts without an offline list remain valid for unrelated changes.

This is a workflow guard, not tamper-proof security: a person able to modify
local Git metadata or disable Git hooks can bypass it. CI remains independent
confirmation, and owner acceptance is still required before pushing.
