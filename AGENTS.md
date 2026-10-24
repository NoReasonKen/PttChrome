# PttChrome Project Instructions

## Language

- Communicate with the user in Traditional Chinese.
- Write documentation and code in English, including comments and test descriptions. Keep README.md in Traditional Chinese to match its existing language.
- Explain behavior through the user-visible concepts in [GLOSSARY.md](GLOSSARY.md). Introduce technical terms by relating them to the familiar content or control before relying on them.

## User's reading context

- The user primarily uses the installed Android app with easy-reading experiences enabled. Start investigations of their questions and reports with the relevant easy-reading path and mobile interaction.
- Follow shared behavior into other reading modes and application surfaces when relevant. Design features and fixes for the repository as a whole, with readable, maintainable code and clear extension points.

## Engineering collaboration

- The user has a programming background and limited web/mobile experience. Explain platform-specific constraints through concrete user-visible behavior.
- Evaluate proposed mechanisms against the user's goal, current behavior, implementation and maintenance cost, performance/regression risks, and expected benefit. Separate source evidence from assumptions and unmeasured effects.
- Proactively correct mistaken assumptions, offer simpler alternatives, and recommend deferral when costs outweigh likely benefits. Make a reasoned recommendation and respect the user's explicit decisions.

## Subagent delegation

Proactively use subagents when one of these cases offers a clear benefit:

- **Parallel work:** delegate independent work that benefits from division or concurrent investigation to subagents using the main agent's model.
- **Context isolation:** delegate bounded work whose intermediate details do not help the main agent reason about the overall task to a subagent using the same model. Request concise findings, evidence, and unresolved questions.
- **Simple work:** use a lightweight model, preferably `gpt-6-luna` when available, for straightforward, well-scoped tasks with clear completion criteria. If it is unavailable, use the main agent's model.

Use the main agent's model for ambiguous or judgment-heavy work. Give each subagent a clear task, the necessary context, an expected result, and explicit file ownership when editing. The main agent remains responsible for reviewing and integrating results, validating changes, and committing completed milestones.

## Agent skills

### Issue tracker

Track development requirements in GitHub Issues for NoReasonKen/PttChrome. Before creating, reading, or updating tickets, read [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) for scope and conventions.

### Triage labels

Use the five canonical labels plus `backlog` and `resolved`. Before classifying work or changing its state, read [docs/agents/triage-labels.md](docs/agents/triage-labels.md); `ready-for-human` includes user decisions, testing, and implementation.

### Domain docs

Use a single-context layout: root [GLOSSARY.md](GLOSSARY.md) and `docs/adr/`. Before exploring code, follow the reading rules in [docs/agents/domain.md](docs/agents/domain.md).

## Navigation

Before exploring source, follow [domain reading rules](docs/agents/domain.md) and use the [topic index](docs/agents/topics.md) to read each relevant topic document before changing its area.

Before development commands, test selection, commits, pushes, or merges, identify the environment and follow [Git and CI workflow](docs/agents/git-workflow.md). It defines local-primary, linked-worktree, and cloud rules.

Before startup, dependency changes, editing files, or documentation/product maintenance, read [development guidance](docs/agents/development.md). For setup and environment checks, follow [local development](docs/run-local.md).

Before changing behavior or tests, or choosing verification for a change, read [testing guidance](docs/agents/testing.md), including environment-specific exceptions in the Git workflow.

Before module, rendering, lifecycle, browser/OS input, or PTT protocol changes, read [architecture and implementation](docs/agents/architecture.md). Before changing a core interface or crossing module boundaries, also read [core API contracts](docs/core-api-research.md) and verify the current implementation.

For Android installation, on-device testing, APK/web updates, publication, or native bridge changes, start with [Android app guidance](docs/android-app.md); use the topic index for additional affected surfaces.

For user debug captures, use the dedicated entry in the [topic index](docs/agents/topics.md).

## Work completion

**Local primary checkout:** work directly on the current branch, normally dev. Create no feature branch. After each coherent work milestone is completed and its relevant checks pass, commit the task's changes automatically with a focused English commit message. Keep unrelated changes out of the commit.

For linked worktrees and cloud sessions, follow their separate branch, commit, push, and integration rules in the Git workflow.

## Temporary files

Put temporary documents, such as handoffs, scratch notes, and one-off outputs, under `./tmp/` at the repository root. Git ignores `tmp/`; never commit its contents.

## Local test runs

**Run one test command at a time on the local machine.** Wait for each unit, integration, E2E, or build run to exit before starting the next, including in background shells and subagents. Local CPU and memory are limited; concurrent suites exhaust RAM and swap and cause unrelated timeouts.

## Live-login limits

**A complete live suite may log in exactly once, without exceptions.**

**Stop all login attempts when PTT reports a temporary DDoS/BOT block.**

Follow the testing guide for shared fixtures, recording commands, blocked-login recovery, and offline alternatives.

## Privacy

This is a public fork. Keep local absolute paths, OS usernames, PTT accounts, personal PATH/tool locations, and machine-specific details out of documentation, source, and commit messages. Use generic placeholders and relative commands in documentation. Review the diff for private data before committing.
