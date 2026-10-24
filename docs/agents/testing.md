# Testing guidance

All source paths and commands in this guide are relative to the repository root; Markdown links resolve from this document.

Read [Git workflow](git-workflow.md) before selecting commands: linked-worktree and cloud verification rules refine this guide.

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
- Settings tests normally use the real signed-out `pref_sync` adapter: subscribing and reading access state do not load Firebase. Where auth/setup state needs control, use `vi.mock(module, { spy: true })` and override only the necessary functions. Shared manual factories have caused cross-file factory-resolution failures in Vitest Browser Mode. For AI settings, control `window.LanguageModel` while retaining the real adapter and its complete exports.
- Keep the test server's `Cache-Control: no-store` header in `vitest.config.mjs`. Browser mock shims reuse module URLs across isolated test documents; cached shims can refer to another document's mock registry. This header also reaches provider-generated responses and leaves the production Vite configuration independent.
- Use real browser tests rather than restoring jsdom or happy-dom: simulated DOM behavior previously concealed real failures. See [docs/build-modernization.md](../build-modernization.md).

`tests/unit/` covers logic, parsing, state machines, conversion, and core screen rendering. `tests/unit/helpers/mount_screen.js` mounts ScreenController/buildRow with fake TermChar values; peripheral React tests use Testing Library.

Use `.test.jsx` for JSX tests and `vi.*` for mocks/timers. Vitest globals are enabled. Load modules at file scope: cold imports inside test bodies count toward the 5000 ms timeout and can fail under load. Covered by `tests/unit/module_load_cost.test.js`.

Put per-row enhancement logic in `comment_parse.annotateComment` and cover it with unit regressions.

### Integration tests

`yarn test:integration` tests preference sync using the real modular SDK, Auth/Firestore emulators, and actual `firestore.rules`. The official Firebase Emulator Suite runs in Docker using pinned `andreysenov/firebase-tools`; Vitest runs on the host. Docker is required locally. See `scripts/run-integration.mjs` and [docs/pref-sync-firestore.md](../pref-sync-firestore.md).

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

The unconditional live-login and BOT-block limits are defined in [AGENTS.md](../../AGENTS.md#live-login-limits).

Use the shared fixture from `tests/e2e/helpers/fixtures.js`; never add an independent page.goto('/'), login(), or browser.newContext(). The one boot uses the product's automatic login via `autoLoginBoot`; assert it through `shared.boot`. Unit tests cover repeat-login prompts and pre-login deep-link scheduling. Each record command also consumes one login.

PTT limits login frequency. The open-source lower bounds are delays above three attempts per minute or twenty per hour, and rejection above ten per minute; see [docs/pttbbs-screen-protocol.md](../pttbbs-screen-protocol.md) section 11.2. Even a clean-tree versus modified-tree comparison gets one live run. The static guard is `tests/unit/e2e_login_budget.test.js`.

This private protection layer is absent from the open-source pttbbs source. Its screen says manual removal is unavailable, recovery may take up to twelve hours with no login activity, and continued attempts can extend the block indefinitely. Recovery time starts from the latest attempt; disable normal automatic login too. `tests/e2e/helpers/bot_block.js` recognizes the block and stops the run. Continue with unit and offline E2E tests. Read the E2E README and protocol document for details.

Live/record input and failure handling:

- Use `helpers/ptt.js#pressAndSettle` to wait for actual buffer changes and settling. Fixed sleeps followed by one check can misclassify delayed replies and send extra keys.
- Identify password screens with `buf.isPassScreenNow()`. End includes pinned articles; choose the intended article from the list before opening it.
- If early tests pass and later tests all fail with identical `ERR_CONNECTION_REFUSED` timings, first check that port 8080 and the development server remain alive.
- Offline-only runs may use multiple workers; live runs always use one. Policy lives in `tests/e2e/workers_policy.js`.
- Offline specs must be independent with fullyParallel enabled, including tests in the same file. Avoid describe.serial, shared beforeAll pages, shared files, and fixed ports.
- A whole suite failing immediately without AssertionErrors usually indicates a local environment problem, such as missing browsers or Windows process failures. Read [docs/local-env-troubleshooting.md](../local-env-troubleshooting.md) before changing application code.

### Real input and rendering verification

For inputs whose shape or ordering belongs to the browser or OS, use `tests/e2e/helpers/real_input.js` and Playwright mouse/keyboard or CDP Input APIs. This includes context clicks, touch holds, wheels, scrolling, dragging, clipboard, IME composition, focus, fullscreen, and image load/error. Hand-built dispatchEvent calls or direct onKeyDown calls do not verify native behavior.

Unit tests may synthesize events for branches, but include a `// real-input: tests/e2e/...` pointer to real-input E2E coverage. See `tests/unit/e2e_real_input.test.js` and the E2E README. If real input turns a test red, first question whether the synthetic test was truthful.

For rendering or screen changes, run offline E2E, adverse offline E2E, and one live core run before committing. This includes term_view.js, term_ui.js, src/render/**, src/components/**, easy_reading.js, rendering/switching in pttchrome.jsx, and rendering-related term_buf.js code. Unit/build success alone misses complete boot/WebSocket failures, including prototype loss from JSON cloning TermChar. Environment-specific worktree/cloud rules in docs/agents/git-workflow.md refine live coverage.

After UI work, take and inspect screenshots in a scratch or gitignored directory. Verify readable text, stable layout without overlap/clipping/overflow, and colors consistent with the dark theme. Include a narrow viewport for mobile changes. Screenshots are not committed.

Add new overlay features and bootOffline options to COMBOS in both bottom_overlay and mobile_bottom_overlay specs. Feature-specific tests disable other features, so only the matrix exposes combinations.

### Offline replay and regression policy

`yarn test:e2e:offline` replays byte cassettes through a stub WebSocket with real browser rendering. The Node-only Layer 2 test `tests/unit/replay_fixture.test.jsx` reconstructs cross-page deduplication with real findPageOverlap.

- Treat offline flakes as insufficiently precise assertions. Use `tests/e2e/helpers/layout.js` helpers: waitPreviewsSettled, waitRectStable, assertElementUnder, stableCommentRow, and plainLeftEdge. Fixed waitForTimeout calls do not establish layout stability.
- Lazy previews load during scrollIntoView and can move measured rectangles after scrolling. Covered by `tests/unit/e2e_layout_settle.test.js`.
- Local images normally return immediately. Rendering/layout work also needs `yarn test:e2e:offline:adverse`, which deterministically covers 5.2-second images, 404, 301, and mixed responses. Exit codes: 0 success, 1 real failure, 2 environment problem. See [docs/offline-replay-testing.md](../offline-replay-testing.md).
- Record article-scoped fixtures with guest-only `yarn record:cassette`; captures exclude account data.
- Offline E2E includes an offline-firefox project for selection.offline.spec.js. Install Firefox with `yarn playwright install firefox`; Chromium does not expose every selection/copy problem.

Behavior changes require corresponding tests. For each bug, first write a failing reproduction, then fix it and retain the regression. Prefer pure unit tests for parsing, conversion, per-row decisions, and state logic; use E2E for DOM/network/React behavior unit tests cannot capture. Assert symptoms and behavior rather than implementation details. Run new and related tests before committing, with E2E for rendering changes.
