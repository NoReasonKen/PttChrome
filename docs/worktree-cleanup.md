# Cleanup status

Run `scripts/leftovers.local.sh` from the primary checkout after delivery. It reports
worktrees, neighboring folders, merged branches, stale remote-tracking refs and
issue states without changing them. Pass `--no-issues` to skip GitHub queries.
Pass `--protected-root PATH` or `--in-use-root PATH` for each host-known blocker;
Git cannot detect all host uses. `--json` provides the same status as JSON.

Only clean merged worktrees are suggested for review and archive. Dirty,
protected and in-use worktrees are blockers, and a checked-out branch requires
review of its worktree. A successful empty report exits 0; findings exit 1 and
query failures exit 2. Remote status uses existing refs; fetch separately when
current remote information is needed. Issue completion uses GitHub's closing
references, not ordinary references. Queries have bounded result limits.

After this change is merged and synchronized to the primary checkout, the local
wrapper automatically uses the tracked runner. Until then, invoke it from the
task checkout with `node scripts/cleanup-status.mjs`, or set `CLEANUP_RUNNER_ROOT`
to that checkout when using the local wrapper. If the primary checkout does not
yet have the tracked runner, the wrapper retains its legacy report, which has
known gaps and should not be used to decide what is safe to remove.
