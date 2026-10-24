# Development and maintenance

All source paths and commands in this guide are relative to the repository root; Markdown links resolve from this document.

For first-time setup and environment checks, follow [local development](../run-local.md). Before running commands, identify the environment using [Git workflow](git-workflow.md).

## Running locally

- Start the development server with `yarn start` at `http://localhost:8080` (Vite).
  - If this session starts a development server, run `yarn kill:dev` before ending the session.
  - The SessionEnd hook in `.claude/settings.json` runs `kill-dev-server.js --own`, which only kills this checkout's Vite process using the pidfile written by `vite.config.mjs`. Keep this cleanup at SessionEnd: a Stop hook fires after every assistant turn and can kill Playwright's server, causing widespread `ERR_CONNECTION_REFUSED`.
  - On Windows, Vite may bind only to IPv6 `[::1]:8080`. `kill-dev-server.js` filters `netstat -ano` without `-p`; covered by `tests/unit/kill_dev_server_parse.test.js`.
  - Use Node, preferably current v24. The development server requires at least 20.19; Vitest 5 requires at least 22. Bun's WebSocket proxy does not forward upgrades.
  - Use Yarn v4 with the `node-modules` linker from `.yarnrc.yml`. `corepack enable` exposes Yarn, with its version pinned in `package.json`. Use `yarn install --immutable` in CI. Avoid npm and its extra lockfile.
  - Yarn v4 does not run custom pre/post scripts. Vite's `emptyOutDir` cleans build output. Yarn's portable shell supports inline `VAR=1 cmd` across platforms; cross-env is unnecessary.
- The server provides a `/bbs` WebSocket proxy, rewriting Origin to term.ptt.cc and connecting to `wss://ws.ptt.cc/bbs`. Opening the page connects to real PTT without another relay.
- The default development site is `wstelnet://localhost:8080/bbs`, supplied by `DEFAULT_SITE` in `vite.config.mjs`.
- Read [docs/run-local.md](../run-local.md) for details.

### Line endings and edits

- Use LF, enforced by `.gitattributes` with `* text=auto eol=lf`, regardless of core.autocrlf. The exception is *.bat, including android/gradlew.bat, checked out as CRLF.
- Write escaped NUL representations in source, never literal NUL bytes. A NUL makes Git treat a file as binary, disabling text normalization and readable diffs. `scripts/edit-guard.mjs` and `tests/unit/edit_guard.test.js` enforce this.
- Record formatting-only commits in `.git-blame-ignore-revs`; GitHub uses it automatically. Locally set `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- Before committing, check git diff --stat or git show --stat for line counts proportionate to the actual change.
- Edit project files through dedicated editing/writing tools rather than shell redirection, inline scripts, sed -i, heredocs, or Set-Content. `scripts/edit-guard.mjs` checks NUL, CRLF, and large duplicates after writes and again before commits. Follow guard failures instead of bypassing them.
- For batch edits, write a script through a file tool before running it. In that script, use a function as String.replace's replacement argument so dollar sequences cannot duplicate source text.

### Documentation and product maintenance

Record pitfalls that most future sessions will encounter in the corresponding topic document. Reserve AGENTS.md for rules relevant to every session. Describe the current rule and its reason rather than incident history or dates; omit fixed problems already protected by regressions that future work will not encounter.

Keep documentation, comments, and test names independent of private captures or conversation-only references. User recording names and timestamps are unavailable to future sessions. Describe the facts, or convert replay material into a repo cassette and point to it. Covered by `tests/unit/no_recording_refs.test.js`.

Before each commit, decide whether the change adds a user-facing feature. If so, update README.md's feature list; optimizations and bug fixes do not count as new features.

- Keep the README readable in three minutes. Each feature is one line with a bold name and one or two sentences explaining what it does, under its appropriate feature category. Configuration, limitations, mechanisms, and previous failures belong in settings or docs.
- Extend an existing feature entry instead of adding a duplicate. `tests/unit/readme_features.test.js` enforces at most 100 characters and two sentences per entry.
- Preserve the exact existing extension-installation heading: connection_probe.js#ORIGIN_SETUP_URL links to its anchor, protected by the same test.

Public-facing current-version, website, download, and issue links target NoReasonKen/PttChrome and its GitHub Pages deployment. Preserve abccbaandy/PttChrome, robertabcd/PttChrome, and iamchucky/PttChrome attribution in source/credits. About links are defined in PrefModal.jsx#ABOUT_LINKS. Engineering tickets use NoReasonKen/PttChrome as configured in docs/agents/issue-tracker.md.

Major framework/build/dependency upgrades must also update the technology-upgrade section in About, through about_new_content in both `src/js/zh_TW_messages.js` and `src/js/en_US_messages.js`.

Maintain the modernized build/dependency baseline described in [docs/build-modernization.md](../build-modernization.md):

- Prefer evaluating upgrades or maintained replacements and report the proposal to the user before accumulating workarounds or !important overrides. Stability and modernization take priority over minimal diffs.
- Evaluate a mainstream replacement stack when it has become the ecosystem standard, rather than only incrementing versions. Inline or replace unmaintained small packages. Record evaluations in the modernization document.
- Target current mainstream desktop Chrome, Edge, Firefox, Safari, and current Android Chrome. Check vite.config.mjs build.target and docs/mobile.md. Legacy/niche compatibility does not justify extra polyfills, transpilation, or workarounds.
- The inherited prototype/var style in src/js is tested and functional. Modernize touched files without initiating an unrelated broad rewrite. Deprecated browser APIs have already been removed; repeated inventory scans are unnecessary.
