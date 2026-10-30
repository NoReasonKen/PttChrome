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

This is a workflow guard, not tamper-proof security: a person able to modify
local Git metadata or disable Git hooks can bypass it. CI remains independent
confirmation, and owner acceptance is still required before pushing.
