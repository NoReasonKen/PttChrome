# Architecture and implementation

All source paths and commands in this guide are relative to the repository root; Markdown links resolve from this document.

## Project overview

PTT BBS browser terminal client. This personal fork starts from `abccbaandy/PttChrome`, which derives from `robertabcd/PttChrome @ dev`, the source of term.ptt.cc.

The stack is Vite 8 (Rolldown) and bundled React 19. `@vitejs/plugin-react` uses Vite 8's Babel-free oxc transform. Tests use Vitest 5. Peripheral UI uses Mantine with a default dark theme. Load only the component styles needed in `src/css/mantine.css`; when adding a component, follow the instructions from `mantine_css_subset.test.js`. Vite reads `postcss.config.cjs` with postcss-preset-mantine. There are no CDN runtime dependencies.

**Files containing JSX must use the `.jsx` extension.** Vite 8's oxc does not accept JSX in `.js` files.

**Core screens use plain JavaScript DOM rendering in `src/render/`: article lists, list reading mode, articles, and article reading mode.** BBS screens are redrawn on each received page; React adds overhead here. Measurements are in [docs/easy-reading.md](../easy-reading.md). React remains for peripheral UI: preferences, context menus, alerts, upload overlays, and the one leaf island in core screens, `ImagePreviewer`. Keep one writer for `#mainContainer` and preserve the plain DOM rendering pipeline; competing writers can permanently freeze detached nodes (see [docs/enhanced-addon.md](../enhanced-addon.md)).

## Architecture

Before changing a core interface or crossing module boundaries, read [docs/core-api-research.md](../core-api-research.md) for source-backed signatures, return values, event ordering, ownership rules, and related tests. Verify the current implementation when modifying a documented contract.

- Entry chain: root `index.html` -> `src/entry.js` -> `src/js/main.jsx`. Load the Big5 conversion tables in `conv/*.bin`, then `startApp()`, then `new App().connect(DEFAULT_SITE)`.
- Development builds call `connect()` on boot, matching production timing. This matters for URL consumers such as deep links. `process.env.DEVELOPER_MODE` only exposes probes such as `window.__app` and `__i18n`; Vite selects development for serve and production for build.
- Login follows the telnet BBS protocol, handled by PTT's `daemon/logind`. Opt-in automatic login lives in `src/js/auto_login.js`: it reads screen prompts and uses browser-managed credentials. See [docs/enhanced-addon.md](../enhanced-addon.md).
- Core objects created by `new App()` in `src/js/pttchrome.jsx`:
  - `core`: App.
  - `view`: TermView, `src/js/term_view.js`.
  - `termBuf`: TermBuf, `src/js/term_buf.js`.
  - `EasyReading(core, view, termBuf)`: `src/js/easy_reading.js`, the reading-mode paging and scrolling state machine.
- Hidden input `#t` receives keyboard events. Core screen rows render into `#mainContainer` through `src/render/screen.js`. Read current screen text through `buf.getRowText`; `#mainContainer.innerText` lags one frame.
- Pure logic includes `string_util.js` (Big5 conversion needs `window.lib.*`), `symbol_table.js`, `event.js`, and `ansi_parser.js`.
- DOM-coupled code includes `term_view.js`, `term_ui.js`, and `src/render/`. React handles the peripheral components mounted by `pttchrome.jsx` and `ImagePreviewer`.
- Preference sync: `src/js/pref_sync.js` uses Google sign-in and Firestore `users/{uid}`. The modular SDK loads through dynamic imports; signed-out users download none of it. Passwords never sync. Storage lives in `pref_storage.js`.
- App Check with reCAPTCHA Enterprise limits scripted API use. Development uses an `APPCHECK_DEBUG_TOKEN` environment variable kept outside the repo. See [docs/pref-sync-firestore.md](../pref-sync-firestore.md).

### Native behavior and PTT protocol

Connect OS/browser behavior through official entry points instead of rebuilding it from page events. This applies to trackpad gestures, history navigation, inertia, native menus/dialogs, IME, clipboard, drag/drop, fullscreen, and notifications. Browser chrome and platform-specific input phases cannot be faithfully reconstructed in the page.

Remove existing barriers when enabling native behavior. For example, split overscroll-behavior by axis: the shorthand contain/none also blocks browser navigation. Add static regression coverage for such integration lines; see `tests/unit/native_gesture_css.test.js` and [docs/mouse.md](../mouse.md).

Features that override PTT screens must fall back to native behavior when recognition fails. If a fingerprint element differs, decline interception or return to the native mirror; never send guessed keys. Add fingerprint mutations to `tests/unit/parse_failure_degrade.test.js`.

Any feature that changes real PTT screens or sends navigation keys must use reading-record ownership:

- Start with `recordFor(core).begin(feature)`.
- Finish every success, cancellation, or failure with `end(bm, outcome)`.
- Add the feature/result entry to `reading_record.js#RESTORE_TABLE`, its tests, and [docs/reading-record.md](../reading-record.md).

When returned to a list, FULLUPDATE preserves the cursor: reopen with Enter and restore the row instead of relying on #AID, which search results reject.

**Verify PTT behavior in `3rd_script/pttbbs` source on upstream main before implementing protocol logic.** Captures validate source understanding; they do not establish rules by inference. See [docs/pttbbs-screen-protocol.md](../pttbbs-screen-protocol.md).

- PTT runs private commits, and PTT1/PTT2 deploy at different times. Accept both old and new screen formats, retaining compatibility with strings removed upstream.
- pttbbs source is Big5. Convert search text from UTF-8 to Big5 before searching and decode excerpts with `iconv -f BIG5 -t UTF-8`; a UTF-8 search silently misses matches.
- PTT uses Big5 on the wire and Unicode internally through `string_util.js` b2u/u2b and `window.lib.b2uArray/u2bArray`.
- Each cell holds one code unit: a Big5 byte, or Unicode plus WIDE_TRAIL for UTF-8 characters outside Big5. See `src/js/unicode_cells.js`. Use textCellWidth/charCells for text-to-column conversion instead of high-byte heuristics or u2b length.

Changes under `src/components/**` run Prettier through Husky/lint-staged.

### Rendering and lifecycle invariants

- The rendering path is unified through ScreenController in both modes; read [docs/easy-reading.md](../easy-reading.md) before changing it.
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
