# Git and CI workflow

All source paths and commands in this guide are relative to the repository root; Markdown links resolve from this document.

### Git workflow by environment

Determine the environment first:

1. `CLAUDE_CODE_REMOTE=true`: cloud session.
2. Otherwise, a .git file pointing into .git/worktrees/: local linked worktree (`scripts/worktree.js#isLinkedWorktree`).
3. Otherwise: local primary checkout.

For a local primary checkout, follow the automatic milestone commit rule in [AGENTS.md](../../AGENTS.md#work-completion).

**Local worktree:**

- Run only `yarn test:unit`, which limits workers to two and timeout to twenty seconds.
- `scripts/worktree.js` rejects E2E, integration, record, and Android commands with exit 2: these compete for port 8080, Docker, login budget, and CPU. Playwright reuseExistingServer can silently exercise the primary checkout's code.
- Use `ALLOW_WORKTREE_E2E=1` only after the user confirms that the primary checkout is not running tests.
- Create a `claude/<topic>` branch, commit, push, open a PR targeting dev, and use `yarn ci:status --branch <branch>` until green. Wait for the user before merging.
- For unrelated CI failures, use [docs/ci-troubleshooting.md](../ci-troubleshooting.md) and its rerun guidance instead of changing unrelated code. Stop and report after three repair rounds of the same failure.
- CI offline/adverse coverage substitutes for the rendering pre-commit E2E requirement. State that live coverage was not run. The primary checkout runs the one live suite after integration into dev.

**Cloud session:**

- Stay on the session's assigned branch, usually claude/*. Do not switch to or push directly to dev.
- Commit and push completed work before the disposable container ends. Open a PR to dev when needed.
- Cloud sessions may merge their PR when its CI is fully green without further user confirmation. After merging, wait for dev's CI as described below.
- Local primary/worktree commit rules do not apply in cloud sessions. Privacy review, proportionate diff checks, tests, and README feature rules still apply.
- deploy.yml runs on pushes to dev. Branches under claude/* get pr.yml (the same test.yml) after opening a PR.
- Use `yarn ci:status --branch <branch>`; it requires GH_TOKEN. If unavailable, report CI as unverified.
- A green PR does not establish green dev: the merged commit differs and concurrent merges can interact.
- Cloud setup calls `scripts/cloud-setup.sh`; the SessionStart hook refreshes stale dependencies/browsers. Change that script when changing installed environment components.
- `3rd_script/pttbbs` is a depth-one clone; fetch --unshallow before inspecting history.
- Cloud runs on Linux; Windows-specific pitfalls may not apply. PTT credentials are normally unavailable, so run unit/offline coverage and report live E2E as unrun rather than consuming login budget in the cloud.

### CI after pushes and merges

Every push requires checking the GitHub Actions workflow `Deploy to GitHub Pages`, including unit, integration, and offline E2E results.

After any integration into dev, in any environment, wait for the run on the resulting commit:
`yarn ci:status --branch dev --sha <integrated-commit>`.

If it fails:

1. Inspect the previous first-parent dev commit (`git log --first-parent -2 --format=%h origin/dev`) with ci:status --sha <previous> --no-wait.
2. If the previous run passed, own the first failure. Create an issue identifying the failed job and test, with a run link; reproduce and fix it, integrate, wait for green dev, then close the issue. Rerun only known flakes. After three unsuccessful repair rounds, stop, report the state in the issue, and leave it open.
3. If the previous run also failed, compare the job, step, and actual failed test/error. Matching job/step alone is insufficient. For the same error, add the new run link to its existing open ownership issue; if none exists, take ownership as in step 2. A different error is a new failure that you own.

Use `yarn ci:status` (`scripts/ci-status.mjs`, GH_TOKEN required). It waits for all runs on the commit, prints outcomes, and extracts failed job/step log tails. Options include --branch, --sha (short SHA, HEAD, or tag), --no-wait, and --rerun-failed (only reruns recognized flakes). Exit codes: 0 all green, 1 failure, 2 tool/configuration problem. Absence of evidence is not success.

A run with event dynamic may be Dependabot or another dynamic workflow. It does not establish that the project's deployment workflow ran; creation can be delayed by more than ten minutes. The script requires a project workflow run and exits 2 if it cannot find one. Covered by `tests/unit/ci_status_parse.test.js`. Before changing the script, read its final comment: process.exit() can cause Windows to replace its exit code with 127.

Keep CI polling inside ci:status rather than custom curl/jq or gh run loops. Run it without a pipe, since tail/grep/head can hide the real exit code or terminate the process via SIGPIPE. Capture output to a file and inspect the original exit status. Apply the same rule to test commands whose exit code is the conclusion.

For unrelated failures, code-scanning alerts, new job ordering, and required checks, read [docs/ci-troubleshooting.md](../ci-troubleshooting.md).
