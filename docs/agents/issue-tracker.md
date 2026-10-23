# Issue tracker: GitHub

Issues and specifications for this fork live in [NoReasonKen/PttChrome](https://github.com/NoReasonKen/PttChrome/issues). Use the `gh` CLI and explicitly pass `--repo NoReasonKen/PttChrome` for issue, label, and pull request operations.

## Scope

Create issues for development requirements that need tracking: bugs, features, enhancements, and concrete technical changes with a defined outcome. Keep intentionally deferred requirements open as `backlog` until the user reprioritizes them.

Record investigation, feasibility analysis, and validation in the related requirement's issue or topic document. Keep routine retrospective follow-up, agent guidance, local setup, and completed-work summaries in repository documentation and commits rather than opening separate tracking issues. A skill's issue-tracking workflow applies only to work within this scope unless the user explicitly requests an issue.

## Conventions

- **Create**: `gh issue create --repo NoReasonKen/PttChrome --title "..." --body-file <file>`.
- **Read**: `gh issue view <number> --repo NoReasonKen/PttChrome --json number,title,body,labels,comments`.
- **List**: `gh issue list --repo NoReasonKen/PttChrome --state open --json number,title,body,labels,comments`, with suitable label and state filters.
- **Edit**: `gh issue edit <number> --repo NoReasonKen/PttChrome --body-file <file>`.
- **Comment**: `gh issue comment <number> --repo NoReasonKen/PttChrome --body-file <file>`.
- **Apply or remove labels**: `gh issue edit <number> --repo NoReasonKen/PttChrome --add-label "..." --remove-label "..."`.
- **Complete**: satisfy the completion rules in `triage-labels.md`, apply `resolved`, and close with `--reason completed`.
- **Decline**: apply `wontfix` and close with `--reason "not planned"`.

For multiline bodies and comments, write the exact text to a temporary file and pass it with `--body-file`.
Use `triage-labels.md` for label meanings and state transitions.

## Skill terminology

- **Publish to the issue tracker**: create a GitHub issue.
- **Fetch the relevant ticket**: read the issue and its comments.

## Parent issues and dependencies

Prefer GitHub's native sub-issues and issue dependencies. If unavailable, put `Part of #<parent>` at the top of each child issue, maintain a task list in the parent, and record dependencies as `Blocked by: #<number>`.

For skills that use a work map, keep the map in one issue and link its tickets as children. An actionable ticket is labeled `ready-for-agent` and has no open blockers or assignee. Claim it by assigning yourself, then record the result and update the map when the work is resolved.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub issues and pull requests share a number space. When a bare number is ambiguous, check its type before acting.
