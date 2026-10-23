# PttChrome Project Instructions

## Language

- Communicate with the user in Traditional Chinese.
- Write documentation and code in English, including comments and test descriptions.
- Explain behavior through the user-visible concepts in `GLOSSARY.md`. Introduce technical terms by relating them to the familiar content or control before relying on them.

## User's reading context

- The user primarily uses the installed Android app with easy-reading experiences enabled. Start investigations of their questions and reports with the relevant easy-reading path and mobile interaction.
- Follow shared behavior into other reading modes and application surfaces when relevant. Design features and fixes for the repository as a whole, with readable, maintainable code and clear extension points.

## Subagent delegation

Proactively use subagents when one of these cases offers a clear benefit:

- **Parallel work:** delegate independent work that benefits from division or concurrent investigation to subagents using the main agent's model.
- **Context isolation:** delegate bounded work whose intermediate details do not help the main agent reason about the overall task to a subagent using the same model. Request concise findings, evidence, and unresolved questions.
- **Simple work:** use a lightweight model, preferably `gpt-6-luna` when available, for straightforward, well-scoped tasks with clear completion criteria. If it is unavailable, use the main agent's model.

Use the main agent's model for ambiguous or judgment-heavy work. Give each subagent a clear task, the necessary context, an expected result, and explicit file ownership when editing. The main agent remains responsible for reviewing and integrating results, validating changes, and committing completed milestones.

## Agent skills

### Issue tracker

Track engineering work in GitHub Issues for NoReasonKen/PttChrome. Before creating, reading, or updating tickets, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical labels plus `resolved`. Before classifying work or changing its state, read `docs/agents/triage-labels.md`; `ready-for-human` includes user decisions, testing, and implementation.

### Domain docs

Use a single-context layout: root `GLOSSARY.md` and `docs/adr/`. Before exploring code, follow the reading rules in `docs/agents/domain.md`.

## Project overview

PTT BBS browser terminal client. This personal fork starts from `abccbaandy/PttChrome`, which derives from `robertabcd/PttChrome @ dev`, the source of term.ptt.cc.

The stack is Vite 8 (Rolldown) and bundled React 19. `@vitejs/plugin-react` uses Vite 8's Babel-free oxc transform. Tests use Vitest 5. Peripheral UI uses Mantine with a default dark theme. Load only the component styles needed in `src/css/mantine.css`; when adding a component, follow the instructions from `mantine_css_subset.test.js`. Vite reads `postcss.config.cjs` with postcss-preset-mantine. There are no CDN runtime dependencies.

**Files containing JSX must use the `.jsx` extension.** Vite 8's oxc does not accept JSX in `.js` files.

**Core screens use plain JavaScript DOM rendering in `src/render/`: article lists, list reading mode, articles, and article reading mode.** BBS screens are redrawn on each received page; React adds overhead here. Measurements are in `docs/easy-reading.md`. React remains for peripheral UI: preferences, context menus, alerts, upload overlays, and the one leaf island in core screens, `ImagePreviewer`. Keep one writer for `#mainContainer` and preserve the plain DOM rendering pipeline; competing writers can permanently freeze detached nodes (see `docs/enhanced-addon.md`).

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
- Read `docs/run-local.md` for details.

## Architecture

Before changing a core interface or crossing module boundaries, read `docs/core-api-research.md` for source-backed signatures, return values, event ordering, ownership rules, and related tests. Verify the current implementation when modifying a documented contract.

- Entry chain: root `index.html` -> `src/entry.js` -> `src/js/main.jsx`. Load the Big5 conversion tables in `conv/*.bin`, then `startApp()`, then `new App().connect(DEFAULT_SITE)`.
- Development builds call `connect()` on boot, matching production timing. This matters for URL consumers such as deep links. `process.env.DEVELOPER_MODE` only exposes probes such as `window.__app` and `__i18n`; Vite selects development for serve and production for build.
- Login follows the telnet BBS protocol, handled by PTT's `daemon/logind`. Opt-in automatic login lives in `src/js/auto_login.js`: it reads screen prompts and uses browser-managed credentials. See `docs/enhanced-addon.md`.
- Core objects created by `new App()` in `src/js/pttchrome.jsx`:
  - `core`: App.
  - `view`: TermView, `src/js/term_view.js`.
  - `termBuf`: TermBuf, `src/js/term_buf.js`.
  - `EasyReading(core, view, termBuf)`: `src/js/easy_reading.js`, the reading-mode paging and scrolling state machine.
- Hidden input `#t` receives keyboard events. Core screen rows render into `#mainContainer` through `src/render/screen.js`. Read current screen text through `buf.getRowText`; `#mainContainer.innerText` lags one frame.
- Pure logic includes `string_util.js` (Big5 conversion needs `window.lib.*`), `symbol_table.js`, `event.js`, and `ansi_parser.js`.
- DOM-coupled code includes `term_view.js`, `term_ui.js`, and `src/render/`. React handles the peripheral components mounted by `pttchrome.jsx` and `ImagePreviewer`.
- Preference sync: `src/js/pref_sync.js` uses Google sign-in and Firestore `users/{uid}`. The modular SDK loads through dynamic imports; signed-out users download none of it. Passwords never sync. Storage lives in `pref_storage.js`.
- App Check with reCAPTCHA Enterprise limits scripted API use. Development uses an `APPCHECK_DEBUG_TOKEN` environment variable kept outside the repo. See `docs/pref-sync-firestore.md`.

## Tests

### Unit tests

Prefer `yarn test:unit`: Vitest without network access, configured in `vitest.config.mjs`. It runs two projects:

- `unit`: Node with the threads pool for pure logic, parsing, and static checks.
- `unit-browser`: Vitest Browser Mode in real headless Chromium for DOM, rendering, and React UI.

Install Chromium locally with `yarn playwright install chromium`. DOM tests start with `// @unit-env browser`; pure logic tests omit it. Covered by `tests/unit/unit_environment.test.js`.

Browser test constraints:

- Use JSON or `?raw` imports for fixtures. Node APIs such as fs, path, Buffer, require, __dirname, and global are unavailable. Use `globalThis` and the `vitest/browser` commands for file writes; see `render_dom_equivalence.test.js`.
- Mock read-only browser globals with `Object.defineProperty` or `vi.spyOn`; see `tests/unit/helpers/credential_api.js`.
- Give scrolling elements real dimensions and overflow. Keep layout properties such as scrollHeight and offsetTop real. IntersectionObserver is asynchronous; stub or inject it when explicit control is needed.
- `vi.resetModules()` cannot rerun native ESM modules in browser mode. Expose a test reset function for page-lifetime caches, following `auto_login.js#_resetSessionCredentialForTest`.
- Use real browser tests rather than restoring jsdom or happy-dom: simulated DOM behavior previously concealed real failures. See `docs/build-modernization.md`.

`tests/unit/` covers logic, parsing, state machines, conversion, and core screen rendering. `tests/unit/helpers/mount_screen.js` mounts ScreenController/buildRow with fake TermChar values; peripheral React tests use Testing Library.

Use `.test.jsx` for JSX tests and `vi.*` for mocks/timers. Vitest globals are enabled. Load modules at file scope: cold imports inside test bodies count toward the 5000 ms timeout and can fail under load. Covered by `tests/unit/module_load_cost.test.js`.

Put per-row enhancement logic in `comment_parse.annotateComment` and cover it with unit regressions.

### Integration tests

`yarn test:integration` tests preference sync using the real modular SDK, Auth/Firestore emulators, and actual `firestore.rules`. The official Firebase Emulator Suite runs in Docker using pinned `andreysenov/firebase-tools`; Vitest runs on the host. Docker is required locally. See `scripts/run-integration.mjs` and `docs/pref-sync-firestore.md`.

Keep `vitest.config.mjs` independent of `vite.config.mjs`: the application's define replacements would freeze emulator environment variables to undefined. E2E tests do not connect to Firebase; validate sync through integration tests.

### Live E2E tests

`yarn test:e2e` uses Playwright against real PTT. Credentials come from `PTT_USER` and `PTT_PASS`; otherwise it uses guest login, which can fast-fail when guest slots are full. Failures save screenshots, videos, and console output. Helpers live in `tests/e2e/helpers/ptt.js`; read `tests/e2e/README.md`.

- Live coverage is limited to `tests/e2e/core.spec.js`: login, menu/list/article screen sanity, and opening images. `helpers/screen_sanity.js` checks DOM/buffer equality, grid layout, Big5 decoding, and horizontal overflow rather than exact screen content.
- Test other features offline. Record new server interactions with `yarn record:scenarios`, which uses one login. The `e2e_login_budget` guard allows only core.spec.js in live coverage.
- Each live run saves a DebugRecorder capture under gitignored `tests/e2e/__recordings__/`. Reproduce protocol/layout failures offline from the capture, fix them, then use one final live verification run.
- `yarn triage:recordings` checks captures frame by frame through screen_sanity without logging in. Failed frames become cassettes in gitignored `cassettes/pending/` plus a list; successful runs produce no output artifacts.
- Keep `src/` unchanged while live or record tests run: Vite HMR reloads the app and triggers another automatic login.
- The live/record `preflight` project checks PTT reachability. A failure stops the suite and distinguishes an application boot failure, PTT unreachable/maintenance (`connectState=2`), and a connected server that emits no screen. During maintenance, verify term.ptt.cc before investigating app code. Escape hatch: `E2E_SKIP_PREFLIGHT=1`. Covered by `tests/unit/e2e_preflight_message.test.js`.
- Test connection failures offline with `installReplay(page, { neverOpen: true })`; see `tests/e2e/offline/connect_failure.offline.spec.js`. `page.routeWebSocket()` opens the mock socket and runs onConnect, so it cannot represent this case.

**A complete live suite may log in exactly once, without exceptions.**

Use the shared fixture from `tests/e2e/helpers/fixtures.js`; never add an independent page.goto('/'), login(), or browser.newContext(). The one boot uses the product's automatic login via `autoLoginBoot`; assert it through `shared.boot`. Unit tests cover repeat-login prompts and pre-login deep-link scheduling. Each record command also consumes one login.

PTT limits login frequency. The open-source lower bounds are delays above three attempts per minute or twenty per hour, and rejection above ten per minute; see `docs/pttbbs-screen-protocol.md` section 11.2. Even a clean-tree versus modified-tree comparison gets one live run. The static guard is `tests/unit/e2e_login_budget.test.js`.

**Stop all login attempts when PTT reports a temporary DDoS/BOT block.** This private protection layer is absent from the open-source pttbbs source. Its screen says manual removal is unavailable, recovery may take up to twelve hours with no login activity, and continued attempts can extend the block indefinitely. Recovery time starts from the latest attempt; disable normal automatic login too. `tests/e2e/helpers/bot_block.js` recognizes the block and stops the run. Continue with unit and offline E2E tests. Read the E2E README and protocol document for details.

Live/record input and failure handling:

- Use `helpers/ptt.js#pressAndSettle` to wait for actual buffer changes and settling. Fixed sleeps followed by one check can misclassify delayed replies and send extra keys.
- Identify password screens with `buf.isPassScreenNow()`. End includes pinned articles; choose the intended article from the list before opening it.
- If early tests pass and later tests all fail with identical `ERR_CONNECTION_REFUSED` timings, first check that port 8080 and the development server remain alive.
- Offline-only runs may use multiple workers; live runs always use one. Policy lives in `tests/e2e/workers_policy.js`.
- Offline specs must be independent with fullyParallel enabled, including tests in the same file. Avoid describe.serial, shared beforeAll pages, shared files, and fixed ports.
- A whole suite failing immediately without AssertionErrors usually indicates a local environment problem, such as missing browsers or Windows process failures. Read `docs/local-env-troubleshooting.md` before changing application code.

### Real input and rendering verification

For inputs whose shape or ordering belongs to the browser or OS, use `tests/e2e/helpers/real_input.js` and Playwright mouse/keyboard or CDP Input APIs. This includes context clicks, touch holds, wheels, scrolling, dragging, clipboard, IME composition, focus, fullscreen, and image load/error. Hand-built dispatchEvent calls or direct onKeyDown calls do not verify native behavior.

Unit tests may synthesize events for branches, but include a `// real-input: tests/e2e/...` pointer to real-input E2E coverage. See `tests/unit/e2e_real_input.test.js` and the E2E README. If real input turns a test red, first question whether the synthetic test was truthful.

For rendering or screen changes, run offline E2E, adverse offline E2E, and one live core run before committing. This includes term_view.js, term_ui.js, src/render/**, src/components/**, easy_reading.js, rendering/switching in pttchrome.jsx, and rendering-related term_buf.js code. Unit/build success alone misses complete boot/WebSocket failures, including prototype loss from JSON cloning TermChar. Environment-specific worktree/cloud rules below refine live coverage.

After UI work, take and inspect screenshots in a scratch or gitignored directory. Verify readable text, stable layout without overlap/clipping/overflow, and colors consistent with the dark theme. Include a narrow viewport for mobile changes. Screenshots are not committed.

Add new overlay features and bootOffline options to COMBOS in both bottom_overlay and mobile_bottom_overlay specs. Feature-specific tests disable other features, so only the matrix exposes combinations.

### Offline replay and regression policy

`yarn test:e2e:offline` replays byte cassettes through a stub WebSocket with real browser rendering. The Node-only Layer 2 test `tests/unit/replay_fixture.test.jsx` reconstructs cross-page deduplication with real findPageOverlap.

- Treat offline flakes as insufficiently precise assertions. Use `tests/e2e/helpers/layout.js` helpers: waitPreviewsSettled, waitRectStable, assertElementUnder, stableCommentRow, and plainLeftEdge. Fixed waitForTimeout calls do not establish layout stability.
- Lazy previews load during scrollIntoView and can move measured rectangles after scrolling. Covered by `tests/unit/e2e_layout_settle.test.js`.
- Local images normally return immediately. Rendering/layout work also needs `yarn test:e2e:offline:adverse`, which deterministically covers 5.2-second images, 404, 301, and mixed responses. Exit codes: 0 success, 1 real failure, 2 environment problem. See `docs/offline-replay-testing.md`.
- Record article-scoped fixtures with guest-only `yarn record:cassette`; captures exclude account data.
- Offline E2E includes an offline-firefox project for selection.offline.spec.js. Install Firefox with `yarn playwright install firefox`; Chromium does not expose every selection/copy problem.

Behavior changes require corresponding tests. For each bug, first write a failing reproduction, then fix it and retain the regression. Prefer pure unit tests for parsing, conversion, per-row decisions, and state logic; use E2E for DOM/network/React behavior unit tests cannot capture. Assert symptoms and behavior rather than implementation details. Run new and related tests before committing, with E2E for rendering changes.

## Privacy

This is a public fork. Keep local absolute paths, OS usernames, PTT accounts, personal PATH/tool locations, and machine-specific details out of documentation, source, and commit messages. Use generic placeholders and relative commands in documentation. Review the diff for private data before committing.

## Conventions

### Native behavior and PTT protocol

Connect OS/browser behavior through official entry points instead of rebuilding it from page events. This applies to trackpad gestures, history navigation, inertia, native menus/dialogs, IME, clipboard, drag/drop, fullscreen, and notifications. Browser chrome and platform-specific input phases cannot be faithfully reconstructed in the page.

Remove existing barriers when enabling native behavior. For example, split overscroll-behavior by axis: the shorthand contain/none also blocks browser navigation. Add static regression coverage for such integration lines; see `tests/unit/native_gesture_css.test.js` and `docs/mouse.md`.

Features that override PTT screens must fall back to native behavior when recognition fails. If a fingerprint element differs, decline interception or return to the native mirror; never send guessed keys. Add fingerprint mutations to `tests/unit/parse_failure_degrade.test.js`.

Any feature that changes real PTT screens or sends navigation keys must use reading-record ownership:

- Start with `recordFor(core).begin(feature)`.
- Finish every success, cancellation, or failure with `end(bm, outcome)`.
- Add the feature/result entry to `reading_record.js#RESTORE_TABLE`, its tests, and `docs/reading-record.md`.

When returned to a list, FULLUPDATE preserves the cursor: reopen with Enter and restore the row instead of relying on #AID, which search results reject.

**Verify PTT behavior in `3rd_script/pttbbs` source on upstream main before implementing protocol logic.** Captures validate source understanding; they do not establish rules by inference. See `docs/pttbbs-screen-protocol.md`.

- PTT runs private commits, and PTT1/PTT2 deploy at different times. Accept both old and new screen formats, retaining compatibility with strings removed upstream.
- pttbbs source is Big5. Convert search text from UTF-8 to Big5 before searching and decode excerpts with `iconv -f BIG5 -t UTF-8`; a UTF-8 search silently misses matches.
- PTT uses Big5 on the wire and Unicode internally through `string_util.js` b2u/u2b and `window.lib.b2uArray/u2bArray`.
- Each cell holds one code unit: a Big5 byte, or Unicode plus WIDE_TRAIL for UTF-8 characters outside Big5. See `src/js/unicode_cells.js`. Use textCellWidth/charCells for text-to-column conversion instead of high-byte heuristics or u2b length.

Changes under `src/components/**` run Prettier through Husky/lint-staged.

### Topic documentation

Read the corresponding document before changing the listed area or answering the listed operational questions:

| Area | Document |
| --- | --- |
| Local startup | `docs/run-local.md` |
| Project sources and Origin allowlist constraints | `docs/pttchrome-research.md` |
| Deployed Origin rewriting | `docs/origin-rewrite-extension.md` |
| Enhancements, preferences, blacklist, floors, comment merging, auto-login, active pitfalls | `docs/enhanced-addon.md` |
| Article reading, settling, rendering, chunking, functionMode | `docs/easy-reading.md` |
| List reading contracts and state, list_session.js, command_queue.js, buffer settling | `docs/easy-reading-list.md` |
| List-reading design alternatives | `docs/easy-reading-list-research.md` |
| Server screen protocol and recognition invariants | `docs/pttbbs-screen-protocol.md` |
| Capture/replay and privacy | `docs/offline-replay-testing.md` |
| Preference sync, Firebase, platform pitfalls | `docs/pref-sync-firestore.md` |
| Preview add-ons, image hosts, referer rules | `docs/media-preview-addons.md` |
| Image preview behavior, easy-reading controls, loading, and regression coverage | `docs/image-preview-research.md` |
| Official PTT projects and terminal comment formats | `docs/ptt-official-app-research.md` |
| On-device AI caption pairing | `docs/merge-caption-ai-assist.md` |
| Build tools and dependency selection | `docs/build-modernization.md` |
| Image latency and proxies; reuse existing measurements | `docs/imgur-latency-research.md` |
| Mouse entry points, regions, priority, left exit-strip geometry, native gestures | `docs/mouse.md` |
| deep_link*.js and external-link navigation, startup scheduling, PWA/APK handlers | `docs/deep-link.md` |
| image_upload*.js, API/CORS, insertion, upload overlays | `docs/image-upload.md` |
| board_list*.js and term_view board-list branches | `docs/board-list-smooth-scroll.md` |
| long_push*.js, byte boundaries, filtering, no form-feed | `docs/long-push.md` and protocol section 11.3 |
| term_size.js, setTermFontSize, centering, NAWS, fixed 80 columns | `docs/terminal-size.md` |
| Android installation, on-device testing, APK/web updates and deployment; android/**, android_bridge.js, credential_store.js, boot_site.js | `docs/android-app.md` |
| Announcement worker and scripts/ptt-announcements.mjs | `docs/ptt-announcement-bot.md` |
| Touch, mobile_layout.js, MobileToolbar/AppBar/Sheet, navigation, system back | `docs/mobile.md` |
| article_search.js, search_history.js, SearchModal | `docs/article-search.md` |
| board_note_skip.js | `docs/board-note-skip.md` |
| screen_refresh.js, pull_refresh.js, aid_navigation.refresh, F5 | `docs/screen-refresh.md` |
| reading_record.js and any feature changing screens or restore anchors | `docs/reading-record.md` |
| PTT agent use, agent_tools.js, agent_parse.js, aid_navigation startBoard/startNum | `docs/agent-tools.md` |
| unread_jump.js | `docs/unread-jump.md` |
| command_palette.js and CommandPalette | `docs/command-palette.md` |
| home_dashboard.js and HomeDashboard | `docs/home-dashboard.md` |
| split_reader.js and SplitReader | `docs/split-reader.md` |
| Picking/listing articles and blacklist enforcement through list_row_filter.js | `docs/list-row-filter.md` |
| next_article.js and pull_next_article.js | `docs/next-article.md` |
| new_comments.js | `docs/new-comments.md` |
| article_tools.js and ArticleTools | `docs/article-tools.md` |
| message_inbox.js and App.onData message parsing | `docs/message-inbox.md` |
| help_menu.js and HelpMenu | `docs/help-menu.md` |
| Android E2E specs and tests/e2e/android | `docs/android-e2e.md` |
| CI failures, required checks, and new CI job ordering | `docs/ci-troubleshooting.md` |
| tools/ptt-src-screens and screen scenarios | `docs/ptt-src-screens.md` |
| public/sw.js and open_cache.js | `docs/open-cache.md` |

For user-provided debug captures, first use `yarn debug:screens` (`scripts/debug-screens.mjs`). Without a timestamp it prints a readable send/log timeline; --from/--to narrow it. A millisecond timestamp prints the screen using the app's TermBuf/AnsiParser through Vite ssrLoadModule and cassette.rows. Keep this parser authoritative: miniature hand-written terminal parsers can misread CUP and create false remnants. Mid-session captures are incomplete before the first full redraw. Covered by `tests/unit/debug_screens.test.js`.

Unfinished handoffs live under `docs/handoff/`, one Markdown file per unfinished feature/fix. Delete that handoff after finishing it; read `docs/handoff/README.md`.

### Git workflow by environment

Determine the environment first:

1. `CLAUDE_CODE_REMOTE=true`: cloud session.
2. Otherwise, a .git file pointing into .git/worktrees/: local linked worktree (`scripts/worktree.js#isLinkedWorktree`).
3. Otherwise: local primary checkout.

**Local primary checkout:** work directly on the current branch, normally dev. Create no feature branch. After each coherent work milestone is completed and its relevant checks pass, commit the task's changes automatically with a focused English commit message. Keep unrelated changes out of the commit.

**Local worktree:**

- Run only `yarn test:unit`, which limits workers to two and timeout to twenty seconds.
- `scripts/worktree.js` rejects E2E, integration, record, and Android commands with exit 2: these compete for port 8080, Docker, login budget, and CPU. Playwright reuseExistingServer can silently exercise the primary checkout's code.
- Use `ALLOW_WORKTREE_E2E=1` only after the user confirms that the primary checkout is not running tests.
- Create a `claude/<topic>` branch, commit, push, open a PR targeting dev, and use `yarn ci:status --branch <branch>` until green. Wait for the user before merging.
- For unrelated CI failures, use `docs/ci-troubleshooting.md` and its rerun guidance instead of changing unrelated code. Stop and report after three repair rounds of the same failure.
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

### Line endings and edits

- Use LF, enforced by `.gitattributes` with `* text=auto eol=lf`, regardless of core.autocrlf. The exception is *.bat, including android/gradlew.bat, checked out as CRLF.
- Write escaped NUL representations in source, never literal NUL bytes. A NUL makes Git treat a file as binary, disabling text normalization and readable diffs. `scripts/edit-guard.mjs` and `tests/unit/edit_guard.test.js` enforce this.
- Record formatting-only commits in `.git-blame-ignore-revs`; GitHub uses it automatically. Locally set `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- Before committing, check git diff --stat or git show --stat for line counts proportionate to the actual change.
- Edit project files through dedicated editing/writing tools rather than shell redirection, inline scripts, sed -i, heredocs, or Set-Content. `scripts/edit-guard.mjs` checks NUL, CRLF, and large duplicates after writes and again before commits. Follow guard failures instead of bypassing them.
- For batch edits, write a script through a file tool before running it. In that script, use a function as String.replace's replacement argument so dollar sequences cannot duplicate source text.

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

For unrelated failures, code-scanning alerts, new job ordering, and required checks, read `docs/ci-troubleshooting.md`.

### Rendering and lifecycle invariants

- The rendering path is unified through ScreenController in both modes; read `docs/easy-reading.md` before changing it.
- Golden snapshots in `tests/unit/fixtures/screen_golden/*.html` and `tests/unit/render_dom_equivalence.test.js` protect the entire core DOM contract.
- Preserve data-type="bbsline" and data-row (selection/copy lookup), .wpadding (fixedResize), data-pusher-col/-end/-date-end (comment click regions), and data-list-author/-title (context-menu blacklist). Their consumers lie outside unit coverage.
- Only intentionally changed output warrants `UPDATE_GOLDEN=1 yarn test:unit render_dom_equivalence`; inspect the diff line by line.
- Long reading pages put rows inside div.screenChunk, not directly under #mainContainer. Use `screen_chunk.readSelectionText()` for selection and `renderChunksAround(el)` before scrolling to a row.
- Dirty-row patch eligibility belongs to `src/js/screen_annotations.js#annotationsAreRowIndependent`, not term_view. term_view reports enhance.changedRows and enhance.rowIdentityStable; annotation code decides whether cross-row coupling permits a patch.
- When adding cross-row logic to computeAnnotations, update annotationsAreRowIndependent and annotationFrontier together. Forward-only state such as FloorCounter and ModernCommentThread must follow incremental caching and appear in randomized `screen_annotations_frontier.test.js` coverage.
- TermChar.needUpdate is cleared after updateCharAttr consumes it. lineChangeds is cleared only by term_view.redraw. Clearing it in updateCharAttr breaks easy_reading._forceRepaint and list_session._forceRedraw.
- Plain DOM rendering owns cleanup. Replacing a row or rebuilding the screen must destroy lazy preview placeholders and their IntersectionObserver, ResizeObserver, and ImagePreviewer React roots. The one entry point is `render/screen.js#disposeNode`, covered by `tests/unit/render_dispose.test.js`.
- pttchrome.modalShown is derived from named sources through `App.setModalOpen(source, open)`. React's ContextMenu effect derives it from render state. Direct writes or parallel manual bookkeeping can leave keyboard focus permanently captured by hidden input #t. Covered by modal_shown_sources.test.js and connect_failure.offline.spec.js. showsInputHelper and showsLiveArticleHelper intentionally do not count as modals.
- view.conn is assigned only by App.onConnect and can be undefined before a successful connection. UI controls use view.sendKeyAsUser(); keyboard/IME input uses view._send()/_convSend(), which apply user-input adoption rules. Machine operations use CommandQueue for serialized transactions or App.sendMachineBytes() through an owning state machine; the caller must honor current wire ownership.

### Documentation and product maintenance

Record pitfalls that most future sessions will encounter in the corresponding topic document. Reserve this file for rules relevant to every session. Describe the current rule and its reason rather than incident history or dates; omit fixed problems already protected by regressions that future work will not encounter.

Keep documentation, comments, and test names independent of private captures or conversation-only references. User recording names and timestamps are unavailable to future sessions. Describe the facts, or convert replay material into a repo cassette and point to it. Covered by `tests/unit/no_recording_refs.test.js`.

Before each commit, decide whether the change adds a user-facing feature. If so, update README.md's feature list; optimizations and bug fixes do not count as new features.

- Keep the README readable in three minutes. Each feature is one line with a bold name and one or two sentences explaining what it does, under its appropriate feature category. Configuration, limitations, mechanisms, and previous failures belong in settings or docs.
- Extend an existing feature entry instead of adding a duplicate. `tests/unit/readme_features.test.js` enforces at most 100 characters and two sentences per entry.
- Preserve the exact existing extension-installation heading: connection_probe.js#ORIGIN_SETUP_URL links to its anchor, protected by the same test.

The inherited public-facing product links (About's current-version link, README, and GitHub About) target abccbaandy/PttChrome. robertabcd/PttChrome and iamchucky/PttChrome appear only in source/credits sections. About links are defined in PrefModal.jsx#ABOUT_LINKS. Engineering tickets for this personal fork use NoReasonKen/PttChrome as configured in docs/agents/issue-tracker.md.

Major framework/build/dependency upgrades must also update the technology-upgrade section in About, through about_new_content in both `src/js/zh_TW_messages.js` and `src/js/en_US_messages.js`.

Maintain the modernized build/dependency baseline described in `docs/build-modernization.md`:

- Prefer evaluating upgrades or maintained replacements and report the proposal to the user before accumulating workarounds or !important overrides. Stability and modernization take priority over minimal diffs.
- Evaluate a mainstream replacement stack when it has become the ecosystem standard, rather than only incrementing versions. Inline or replace unmaintained small packages. Record evaluations in the modernization document.
- Target current mainstream desktop Chrome, Edge, Firefox, Safari, and current Android Chrome. Check vite.config.mjs build.target and docs/mobile.md. Legacy/niche compatibility does not justify extra polyfills, transpilation, or workarounds.
- The inherited prototype/var style in src/js is tested and functional. Modernize touched files without initiating an unrelated broad rewrite. Deprecated browser APIs have already been removed; repeated inventory scans are unnecessary.
