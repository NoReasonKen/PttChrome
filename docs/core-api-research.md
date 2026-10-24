# Core API and Interface Research

Examined revision: `31b65174348438828e1fc10c47686aea96f9a185`.
Method: static inspection of the checked-in implementation and regression tests; no runtime, device, network, or performance verification was performed for this note.
Use [GLOSSARY.md](../GLOSSARY.md) for user-visible vocabulary and [domain-overview.md](domain-overview.md) for the reading journey.

## How to read this map

Here, an **interface** means the inputs, outputs, events, and ownership promises between parts of the application. Three different surfaces matter:

| Surface | Intended caller | Source |
| --- | --- | --- |
| Internal JavaScript modules | Other application modules; exports do not imply a stable third-party SDK | [App construction](../src/js/pttchrome.jsx#L136), [renderScreen](../src/js/term_ui.js#L41) |
| Browser automation API | A caller executing JavaScript in the running reading page | [window.pttAgent installation](../src/js/agent_tools.js#L384) |
| Android bridge | The shared reading page and its installed APK host, exchanging messages | [JavaScript bridge](../src/js/android_bridge.js#L104), [native receiver](../android/app/src/main/java/io/github/abccbaandy/pttchrome/MainActivity.kt#L220) |

## The main flow

```text
Page resources -> App.connect -> WebSocket / TelnetConnection
                                      |
                                   App.onData
                                      |
                               AnsiParser.feed
                                      |
                        TermBuf: cells, cursor, screen kind
                         |                         |
                 notify / view update       screenSettled
                         |                         |
                    TermView          reading sessions + CommandQueue
                         |                         |
               renderScreen -> ScreenController   next machine command
                         |
                  visible reading content
```

The arrows follow the actual boot, receive, redraw, and settle wiring. The settle branch decides when a response can advance an operation; it is separate from painting each incoming update. [Boot](../src/js/main.jsx#L70), [connection events](../src/js/pttchrome.jsx#L540), [receive](../src/js/pttchrome.jsx#L594), [notify](../src/js/term_buf.js#L1144), [settle](../src/js/term_buf.js#L1247), [queue consumption](../src/js/list_session.js#L1013), [render entry](../src/js/term_ui.js#L41).

## 1. Boot and connection: `App`

**Reader's purpose:** open PttChrome and establish the PTT session that supplies every board, article, and prompt. `new App()` creates and wires `view`, `buf`, `parser`, reading sessions, reading record, and the shared command queue. [Constructor](../src/js/pttchrome.jsx#L136).

- `startApp()` is a private boot function. Resource loading installs the conversion tables before it runs; boot creates the App, installs automation tools, then waits for deep-link handoff before connecting. [Resources](../src/js/main.jsx#L148), [boot](../src/js/main.jsx#L36).
- `app.connect(url)` returns no completion Promise. It resets `connectState`, validates the site URL, records connection metadata, and creates a WebSocket wrapped by `TelnetConnection`; connection results arrive through events. [connect](../src/js/pttchrome.jsx#L488), [wrapper](../src/js/pttchrome.jsx#L535).
- `onConnect()` marks the connection usable, gives it to TermView, and resets terminal modes for the new connection. Do not assume `view.conn` exists before this event. [onConnect](../src/js/pttchrome.jsx#L568).
- Listener construction order matters: EasyReading precedes ListSession, which precedes BoardListSession; article landing, queue completion, and list cleanup rely on that order. [Wiring and rationale](../src/js/pttchrome.jsx#L152).

**Regression entry points:** [boot-site precedence](../tests/unit/boot_site.test.js#L1), [failed initial connection](../tests/e2e/offline/connect_failure.offline.spec.js#L1).

## 2. Incoming PTT output: `onData` and `AnsiParser.feed`

**Reader's purpose:** turn the stream from PTT into the screen being read. This is terminal output processing rather than fetching an article from a JSON endpoint. [Receive handler](../src/js/pttchrome.jsx#L594), [parser](../src/js/ansi_parser.js#L77).

- `App.onData(data)` synchronously feeds the parser, informs board-entry skipping and the message inbox, and may deliver a waterball notification. Its return value is not the parsed screen. [Implementation](../src/js/pttchrome.jsx#L594).
- `new AnsiParser(termbuf)` retains parser state across `feed(data)` calls; `feed` walks the input characters and mutates the supplied terminal buffer. A network chunk is therefore not an article or complete-screen boundary. [State fields](../src/js/ansi_parser.js#L4), [feed loop](../src/js/ansi_parser.js#L77).
- Control sequences can change terminal modes as well as text: for example, DEC synchronized output invokes `beginSyncUpdate` / `endSyncUpdate`. Cursor-position requests have a separate optional callback. [Mode handling](../src/js/ansi_parser.js#L44), [callback](../src/js/ansi_parser.js#L18).

**Regression entry points:** [split/control-string parsing](../tests/unit/ansi_parser_string_seq.test.js#L1), [synchronized output](../tests/unit/term_buf_sync_update.test.js#L1), [cursor reports](../tests/unit/ansi_parser_cpr.test.js#L1).

## 3. Screen truth and completion: `TermBuf`

**Reader's purpose:** distinguish what PTT has drawn so far from a screen that has stopped changing long enough to evaluate. The App initially constructs `TermBuf(80, 24)` and binds it to the view. [Construction](../src/js/pttchrome.jsx#L143).

- `getRowText(row, colStart, colEnd, lines?) -> string` reads cells from the live buffer or supplied cell rows, adjusts Big5 boundaries, and decodes text. Callers pass zero-based rows and a column slice; this reads terminal content rather than rendered DOM. [Implementation](../src/js/term_buf.js#L1337).
- `notify(timer)` consumes content/cursor changes. For content it updates character attributes and page recognition, emits `change`, updates the view, then emits `viewUpdate`; cursor-only updates also participate in settling. [notify](../src/js/term_buf.js#L1144).
- `screenSettled` fires after the quiet-window check, including when the recognized screen kind stays the same. `pageStateSettled` fires only when that kind changes. Both are notifications; read the buffer fields rather than expecting event-detail payloads. [Dispatch](../src/js/term_buf.js#L1256).
- `buf.settleSnapshot` contains `{ changedRows: Set, cursorMoved, curX, curY, pageState }`. It captures the completed window before listeners run; it is **not** a copy of every cell or row text. Pending redraws and synchronized output postpone the signal. [Snapshot and gating](../src/js/term_buf.js#L1226).
- Terminal settling does not establish that images, animations, or viewport geometry have finished changing. Visual assertions need their own evidence, such as `waitPreviewsSettled` and `waitRectStable`, which separately check pending previews and element rectangles. [Terminal gate](../src/js/term_buf.js#L1226), [preview settling](../tests/e2e/helpers/layout.js#L52), [geometry settling](../tests/e2e/helpers/layout.js#L83).

**Regression entry points:** [snapshot scope](../tests/unit/term_buf_settle_snapshot.test.js#L37), [settle gating](../tests/unit/settle_gating.test.js#L1).

## 4. Visible content: `renderScreen` and `ScreenController`

**Reader's purpose:** display the native PTT view and enhanced reading surfaces through one core rendering owner. TermView's redraw prepares rows and enhancement information for this path. [TermView redraw](../src/js/term_view.js#L762), [render call](../src/js/term_view.js#L1139).

- `renderScreen(lines, forceWidth, enableLinkInlinePreview, enableLinkHoverPreview, cont, enhance) -> ScreenController` reuses one controller per root through a WeakMap and synchronously calls its `update(props)`. [Entry point](../src/js/term_ui.js#L41).
- `new ScreenController(screenRoot)` creates `#mainContainer`; `update(props)` stores the current props and renders. `enhance` carries article/list presentation facts and callbacks, rather than being an independent screen writer. [Constructor](../src/render/screen.js#L137), [update](../src/render/screen.js#L325), [enhancement assembly](../src/js/term_view.js#L1190).
- `setCursorHighlight(next)` updates interaction state; `syncRowIndex()` settles deferred row-index shifts before consumers inspect row locations. `destroy()` and node disposal own cleanup, including preview slots. [Highlight](../src/render/screen.js#L400), [row indices](../src/render/screen.js#L384), [destroy](../src/render/screen.js#L450), [slot disposal](../src/render/screen.js#L126).

**Regression entry points:** [whole-core DOM equivalence](../tests/unit/render_dom_equivalence.test.js#L30), [preview disposal](../tests/unit/render_dispose.test.js#L107).

## 5. Controls acting like keys: `sendKeyAsUser`

**Reader's purpose:** make a bottom-toolbar key mean the same thing as the corresponding keyboard key in the current reading experience. [Toolbar send path](../src/components/MobileToolbar/index.jsx#L166).

- `view.sendKeyAsUser(keyName, mods?)` accepts a `KeyboardEvent.key` name and optional `{ ctrlKey, altKey }`. It synchronously invokes `onKeyDown` with a cancelable synthetic event and supplements unclaimed single characters through keypress. It returns no delivery acknowledgment. [Implementation](../src/js/term_view.js#L1421).
- Cancellation is part of the contract: an upstream reading mode may consume the key; sending protocol bytes as well would duplicate or bypass the action. The method calls the dispatcher directly rather than dispatching another DOM event. [Constraints](../src/js/term_view.js#L1407).
- `App.sendNavKeyAsUser(keyName) -> boolean` additionally gates navigation. `true` means the action was admitted to the dispatcher, not that PTT has acknowledged it. [Implementation](../src/js/pttchrome.jsx#L1689).

**Regression entry points:** [synthetic shape, interception, and fallback](../tests/unit/term_view_send_key_as_user.test.js#L47).

## 6. User text versus machine output

**Reader's purpose:** preserve what the user intends when a scrolling list's reading position differs from PTT selection, while allowing automatic paging to use its own protocol path. [User adoption](../src/js/pttchrome.jsx#L1657), [machine boundary](../src/js/pttchrome.jsx#L712).

- `view._send(bytes)` and `_convSend(text)` are **user keyboard / IME exits**, despite the low-level names. They first ask `App.adoptUserBytes(bytes, opts?)`; a truthy result means the active list session has consumed or taken responsibility for the input, so the caller must not send again. `_convSend` passes `{ conv: true }`. [View exits](../src/js/term_view.js#L700), [active owner lookup](../src/js/pttchrome.jsx#L1663).
- `app.sendMachineBytes(bytes) -> boolean` is for machine state machines: it rejects empty data or a missing/disconnected connection, otherwise calls `conn.send` and returns true. Callers must observe false before recording a request as sent. This helper does not serialize operations; its owning caller must honor wire ownership, as `EasyReading._send` does before delegating. [Implementation](../src/js/pttchrome.jsx#L726), [caller ownership gate](../src/js/easy_reading.js#L1772).
- `TelnetConnection.send` and `sendUserKey` intentionally apply different escape-state handling. Queue commands use the machine path; do not route them through the user-adoption guard. [Transport split](../src/js/telnet.js#L223), [queue wiring](../src/js/pttchrome.jsx#L166).

**Regression entry points:** [send ownership wiring](../tests/unit/user_key_send_wiring.test.js#L36), [failed-send state](../tests/unit/easy_reading_send_gate.test.js#L496), [list byte adoption](../tests/unit/list_user_bytes.test.js#L1).

## 7. Multi-step PTT actions: `CommandQueue`

**Reader's purpose:** open an article, navigate to a board, or perform another sequence without mixing its keys with the response to a different action. App provides one shared queue. [Queue wiring](../src/js/pttchrome.jsx#L163).

```js
queue.enqueue({ keys, kind, expect, onDone, onFail, onSend, onFlushed,
  fullRepaint, probe, timeoutMs, hardTimeoutMs, probeTimeoutMs });
// expect(snapshot, facts) -> truthy result when this response is accepted
// onDone(result); onFail('miss' | 'timeout', facts?); callbacks are optional
```

This is callback-based, not a returned Promise. `enqueue` starts immediately when idle; `onSettle(snapshot, facts)` evaluates the in-flight command and returns `'done'`, `'miss'`, or `null`. A truthy expectation result is forwarded to `onDone`. [Command shape](../src/js/command_queue.js#L97), [completion](../src/js/command_queue.js#L129).

Soft expiry can trigger a repaint probe; hard expiry bounds waiting. `onSend` is where send-time facts belong, since queued work may wait. `flushPending` keeps the sent command paired with its response; shared-owner cleanup uses `flushKind(prefix)` rather than discarding other owners' work. [Timeout options](../src/js/command_queue.js#L104), [send-time callback](../src/js/command_queue.js#L115), [scoped cleanup](../src/js/command_queue.js#L213).

**Regression entry points:** [serialization and completion](../tests/unit/command_queue.test.js#L19), [shared-owner cleanup](../tests/unit/command_queue.test.js#L524).

## 8. Article easy reading: `EasyReading`

**Reader's purpose:** join article pages for continuous scrolling, temporarily show real PTT prompts, and resume the article afterward. `new EasyReading(core, view, termBuf)` listens to content, view, and settled-screen events. [Constructor and subscriptions](../src/js/easy_reading.js#L425), [subscriptions](../src/js/easy_reading.js#L519).

- `enterEasyReading()` resets article accumulation and paging state and forces a buffer notify; it can consequently trigger automatic paging. `exitEasyReading()` is the shared exit recipe. Neither is a Promise for a fully loaded article. [Enter](../src/js/easy_reading.js#L1933), [exit](../src/js/easy_reading.js#L1962).
- `ensureEnabledOnArticle(allowRetry, reason) -> boolean` validates the current landing, preferences, connection support, and navigation ownership; it can defer one enable retry when the landing is incomplete. [Implementation](../src/js/easy_reading.js#L2165).
- `requestScrollRestore(lineIndex)` schedules a later restoration once rows exist; zero/null requires no action. `functionMode` temporarily mirrors native prompts while preserving accumulated article rows. [Restore request](../src/js/easy_reading.js#L2189), [mode contract](../src/js/easy_reading.js#L470).
- Automatic paging shares ownership with the command queue: a busy wire postpones paging, and the App's queue-idle callback wakes it again. [Gate](../src/js/easy_reading.js#L1772), [idle callback](../src/js/pttchrome.jsx#L182).

**Regression entry points:** [paging decisions](../tests/unit/easy_reading_logic.test.js#L1), [wire ownership](../tests/unit/easy_reading_send_gate.test.js#L236).

## 9. Article-list easy reading: `ListSession`

**Reader's purpose:** scroll article entries continuously while keeping the visible reading position distinct from PTT selection. The session owns list state, buffered entries, local selection, and server-position knowledge. [Constructor fields](../src/js/list_session.js#L872).

- `new ListSession(core, view, termBuf, queue)` receives settled screens, builds `facts`, lets its queue command finish first, then runs its state transition. Board-list commands are excluded from its queue evaluator. [Settle handling](../src/js/list_session.js#L1013).
- `transitionListSession(state, event) -> { next, actions }` is the pure transition layer; states include `idle`, `active`, `functionMode`, `opening`, and `suspended`. `onKeyDown(e)` and `onDomScroll()` drive user interaction. [Transition contract](../src/js/list_session.js#L318), [keyboard](../src/js/list_session.js#L1404), [scroll](../src/js/list_session.js#L2443).
- `readingPosition() -> record | null` supplies `{ kind: 'list', board, mode, topNum, topPinnedKey, scrollFrac, cursorNum }` for an enhanced list, with a native-list fallback while idle. `requestViewportRestore(record)` validates/schedules restoration rather than immediately promising a scroll result. [Position](../src/js/list_session.js#L1282), [restore](../src/js/list_session.js#L1340).
- `beginExternalNavigation(opts?)` parks the session before another owner enqueues navigation; `endExternalNavigation()` releases that external hold. Intermediate list screens must not resume the list halfway through another operation. [External ownership](../src/js/list_session.js#L1243).

**Regression entry points:** [transition table](../tests/unit/list_session.test.js#L406), [scroll/selection independence](../tests/unit/list_session.test.js#L2741), [offline list journey](../tests/e2e/offline/easy-reading-list.offline.spec.js#L1).

## 10. Board-list smooth scrolling: `BoardListSession`

**Reader's purpose:** scroll supported favorites/category board lists; this is a different owner from the article list inside a board. `new BoardListSession(core, view, termBuf, queue)` tracks its own variant, selection, server cursor, and scroll anchor. [Constructor](../src/js/board_list_session.js#L276).

- `transitionBoardListSession(state, event)` is its pure decision layer. Commands share the App queue under board-list ownership; opening a board and cleaning up a board list must preserve commands belonging to the article list. [Transition](../src/js/board_list_session.js#L149), [App ownership wiring](../src/js/pttchrome.jsx#L188).
- `readingPosition() -> { kind: 'boardList', variant, topNum, scrollFrac, cursorNum } | null`; `requestViewportRestore(record)` schedules a matching viewport restore. [Position and restore](../src/js/board_list_session.js#L566).
- Matching only the list variant or number is insufficient: `_landedSameList(facts)` also verifies board names against buffered rows so a nested category is not merged with its parent. [Identity check](../src/js/board_list_session.js#L386).

**Regression entry points:** [shared queue ownership](../tests/unit/board_list_session.test.js#L764), [open/return preservation](../tests/unit/board_list_session.test.js#L1156), [offline board lists](../tests/e2e/offline/board_list.offline.spec.js#L1).

## 11. Returning to the reading position: `ReadingRecord`

**Reader's purpose:** return to the right visible place after a temporary operation, rather than guessing from the PTT cursor. `recordFor(core)` returns the shared owner, creating it if absent. [Accessor](../src/js/reading_record.js#L465).

```js
const record = recordFor(core);
const bookmark = record.begin(feature, own); // own is optional
// Finish the operation's appropriate success, cancellation, or failure path:
record.end(bookmark, outcome, opts); // outcome: 'done' | 'cancel' | 'fail'
```

`begin` returns a copied bookmark with article/list/board-list/home positions and optional explicit owners. `end` consults `RESTORE_TABLE` and delegates the resulting requests to each surface owner; it does not wait for later layout completion. `opts.only` limits the affected surface and `opts.article` can supply a return anchor. [begin](../src/js/reading_record.js#L324), [end](../src/js/reading_record.js#L355), [delegation](../src/js/reading_record.js#L412).

For example, a completed long comment goes to the article bottom; cancellation restores the origin. Article refresh uses bottom only when the bookmark was already there. Unknown feature/outcome pairs request no restoration. These are explicit policies, not a universal “always restore” rule. [Table](../src/js/reading_record.js#L58), [plan resolution](../src/js/reading_record.js#L159).

**Regression entry points:** [policy and transaction dispatch](../tests/unit/reading_record.test.js#L19), [article-list restoration](../tests/unit/reading_record_list.test.js#L1), [mobile journey](../tests/e2e/offline/mobile_reading_restore.offline.spec.js#L1).

## 12. Mobile controls, layout, and context actions

**Reader's purpose:** select the controls appropriate to the current article, article list, or board list, independently of whether the page runs in an APK. `isMobileEnv({ mode, coarse, hoverNone, width, height }) -> boolean` implements forced or automatic mobile-layout selection. [Layout decision](../src/js/mobile_layout.js#L12).

- `toolbarContextFromFacts(facts, pageState, opts)` returns action flags, search kinds, and `appBar`; input prompts suppress inappropriate article actions. `toolbarSlots(context)` maps those capabilities to six stable toolbar positions. [Context](../src/js/mobile_toolbar.js#L93), [slots](../src/js/mobile_toolbar.js#L64).
- `app.onScreenContextChange(fn) -> unsubscribe` immediately delivers the current context, then changes. `app.onMobileChange(fn) -> unsubscribe` only subscribes; callers read initial mobile state themselves. [Context subscription](../src/js/pttchrome.jsx#L897), [mobile subscription](../src/js/pttchrome.jsx#L923), [toolbar initialization](../src/components/MobileToolbar/index.jsx#L92).
- The context action menu listens to the browser's `contextmenu` event. Its disposition can preserve the native menu, swallow an event, or open the application menu; mobile selection mode affects that decision. [Handler](../src/components/ContextMenu/index.jsx#L403), [listener lifecycle](../src/components/ContextMenu/index.jsx#L1303).
- `setModalOpen(source, open)` aggregates named overlay owners, so closing one dialog cannot release keyboard focus while another remains open. [Modal ownership](../src/js/pttchrome.jsx#L1042).

**Regression entry points:** [toolbar context](../tests/unit/mobile_toolbar.test.js#L27), [context-menu disposition](../tests/unit/context_menu_disposition.test.js#L1), [mobile toolbar E2E](../tests/e2e/offline/mobile_toolbar.offline.spec.js#L1).

## 13. Stored settings versus effective settings

**Reader's purpose:** temporarily use native safe mode without losing the individual enhancements previously selected. [Effective-preference contract](../src/js/pref_storage.js#L420).

- `readValuesWithDefault() -> values` merges stored values over defaults, falling back to defaults on read/parse errors. `writeValues(values) -> values` writes the local preference envelope; storage failures are swallowed. Neither operation is a cloud acknowledgment. [Read](../src/js/pref_storage.js#L405), [write](../src/js/pref_storage.js#L455).
- `effectivePrefs(values)` returns the original object when safe mode is off; when on it returns a copy with the enumerated enhancement keys disabled. `readEffectivePrefs()` combines loading and projection. Use stored values for edits, and effective values for behavior; never persist the safe-mode projection. [Implementation and ownership](../src/js/pref_storage.js#L443).
- Boot separately applies local values and registers cloud values through `app.onValuesPrefChange(values)`. Cloud arrival can update the running application later. [Boot application](../src/js/main.jsx#L70).

**Regression entry points:** [safe-mode projection and read sites](../tests/unit/native_safe_mode.test.js#L18), [cloud sanitization/merge](../tests/unit/pref_sync_logic.test.js#L10).

## 14. Android page identity and connection destination

**Reader's purpose:** know which reading page an installed APK is actually displaying before expecting a source change to appear on the phone. The checked-in production URL points to this fork's GitHub Pages deployment; the APK loads a web page rather than bundling this checkout's screen code. [AppConfig](../android/app/src/main/java/io/github/abccbaandy/pttchrome/AppConfig.kt#L4).

- Kotlin `PageSource(url, origin, isDev)` and `PageSource.resolve(devEnabled, devUrl, allowLan)` select production or a validated development origin. `parseDevServer` normalizes allowed HTTP development URLs or returns null. [Resolver](../android/app/src/main/java/io/github/abccbaandy/pttchrome/PageSource.kt#L14).
- JavaScript `bootSite(prefs, siteOverride) -> string` selects the **PTT connection destination**, not that reading-page URL: explicit override, Android local proxy, preference proxy, then default. It does not write the native proxy into synchronized settings. [Implementation](../src/js/boot_site.js#L1).
- The APK injects config and a message channel for the selected page origin; the native receiver also checks main-frame and origin identity. Changing page source and changing connection destination are separate operations. [Native setup](../android/app/src/main/java/io/github/abccbaandy/pttchrome/MainActivity.kt#L219).

**Regression entry points:** [PageSource JVM tests](../android/app/src/test/java/io/github/abccbaandy/pttchrome/PageSourceTest.kt#L8), [connection precedence](../tests/unit/boot_site.test.js#L1).

## 15. Android capabilities: `requestAndroid`

**Reader's purpose:** reach host capabilities such as password storage, Android settings, file saving, notifications, and keyboard insets. These are host operations rather than PTT protocol commands. [Bridge message contract](../src/js/android_bridge.js#L9).

- `requestAndroid(op, payload = {}) -> Promise<reply>` sends JSON `{ ...payload, id, op }` through `PttAndroid.postMessage`. Replies are matched by id; unavailable bridge, timeout, or send exceptions reject. An arriving `{ ok: false }` still resolves: the caller must interpret it. [Send](../src/js/android_bridge.js#L103), [reply handling](../src/js/android_bridge.js#L79).
- `isAndroidApp()` checks injected config; `androidBridgeAvailable()` additionally checks the channel. `openAppSettings()` absorbs failures; `androidNotify({ title, body, tag })` returns whether it could initiate a request, without waiting for notification delivery. [Detection](../src/js/android_bridge.js#L57), [wrappers](../src/js/android_bridge.js#L127).
- `onAndroidIme(fn) -> unsubscribe` receives `pttandroid:ime` and normalizes the inset before calling `fn(inset)`; it does not immediately publish the cached value. `pttandroid:stop` signals backgrounding, and restored-page state is available separately. [IME and lifecycle interface](../src/js/android_bridge.js#L140).

**Regression entry points:** [reply matching and failures](../tests/unit/android_bridge.test.js#L61), [IME delivery](../tests/unit/android_bridge.test.js#L136).

## 16. In-page automation: `window.pttAgent`

**Reader's purpose:** let an automation caller inspect or navigate the already-running PTT session using explicit tools. Boot installs this API separately from development-only `window.__app`. [Boot installation](../src/js/main.jsx#L36).

- `pttAgent.list()` returns tool names, descriptions, and input schemas. `await pttAgent.call(name, args?)` executes a named tool and returns its value; unknown names reject. Optional WebMCP registration wraps values as JSON text content. [Installation](../src/js/agent_tools.js#L384).
- `ptt_list_articles({ board, before?, timeoutMs? })` navigates to a board and returns `{ board, articles, pinned, nextBefore }`, applying blacklist filtering. `ptt_read_article({ board, num?, aid?, pinned?, timeoutMs? })` navigates and collects parsed article fields plus `aid`, `url`, and `complete`; inspect `complete` rather than assuming full collection. [Listing](../src/js/agent_tools.js#L240), [article](../src/js/agent_tools.js#L293).
- `ptt_read_screen()` returns `{ connected, page, rows, cursor: { row, col }, busy }`. `ptt_send_keys({ keys, timeoutMs? })` parses key notation, sends through user byte/text exits, waits for settling, and returns screen data plus `settled`. This lower-level tool differs from toolbar `sendKeyAsUser`. [Screen shape](../src/js/agent_tools.js#L78), [key tool](../src/js/agent_tools.js#L340).
- Sending requires connection, visibility, and no conflicting serialized operation. High-level navigation also requires a recognized logged-in session. These tools act on the live session and can move its content location; they are not an independent read-only backend. [Guards](../src/js/agent_tools.js#L137), [navigation invocation](../src/js/agent_tools.js#L264).

**Regression entry point:** [agent tools and fake-session contract](../tests/unit/agent_tools.test.js#L1).

## 17. Article images: collection and viewer ownership

**Reader's purpose:** open an inline image, browse the article's images, and return to the viewed image's reading position. The following contracts supplement the original revision map above. [Viewer design](image-viewer-design.md).

- `ScreenController` emits a bubbling `previewimage` event only for a loaded inline image, with `{ src, width, height, alt, referrerPolicy, trigger }`. `ImageViewer.open(detail) -> boolean` rejects a missing source, invalid dimensions, or an already open viewer. The application owns one adapter; it supplies modal gating, sheet dismissal, and teardown. [Activation](../src/render/screen.js), [adapter](../src/js/image_viewer.js), [application owner](../src/js/pttchrome.jsx).
- `inlinePreviewHref(slot) -> string | undefined` reads WeakMap metadata without mounting or altering the slot. `requestPreview(href) -> Promise<descriptor>` retains per-link promise identity; `cachedPreviewDescriptor(href)` reads only a completed result without fetching. `supportsMediaPreview(href) -> boolean` excludes the resolver registry's unsupported catch-all but does not guarantee an image rather than video or iframe. [Slot metadata](../src/render/inline_preview_slot.js), [resolver exports](../src/components/ImagePreviewer.jsx).
- `collectArticleImages(container, selectedImage, dependencies?) -> { items, index }` collects document order without starting requests. `index` is zero-based or `-1`; duplicate links keep separate occurrences. Each item supplies `anchor()` for a fresh article-node lookup and is either a loaded `{ src, width, height, alt, referrerPolicy }`, a loading item with `resolve({ signal }) -> Promise<items[]>`, or one with `load({ signal }) -> Promise<loadedImage>`. Albums flatten only image descriptions, retaining failed images for retry. `loadArticleImage(descriptor, { signal, imageFactory?, delay? })` measures candidates using shared retry/referer rules and rejects on cancellation or exhausted candidates. Optional dependency arguments provide a test seam rather than a second resolver implementation. [Collection and loading](../src/js/article_images.js), [regressions](../tests/unit/article_images.test.js).
- The viewer owns mutations to its PhotoSwipe data source; it waits for gestures and slide transitions before refreshing affected holders. `close({ restore = true } = {})` aborts pending gallery work; final modal release happens on PhotoSwipe `destroy`, including Close/Escape paths owned by the library. Closing at another image schedules local article centering, canceled by user input or context change. It sends no terminal navigation keys. [Lifecycle and restoration](../src/js/image_viewer.js), [adapter regression](../tests/unit/image_viewer_gallery.test.js), [real touch coverage](../tests/e2e/offline/mobile_image_viewer.offline.spec.js).

## Where to begin with a symptom

This table is a navigation aid, not a diagnosis of an uninvestigated report.

| Observed symptom | First contracts and evidence |
| --- | --- |
| APK does not show a local change | Separate reading-page identity from PTT destination: [PageSource](../android/app/src/main/java/io/github/abccbaandy/pttchrome/PageSource.kt#L14), [bootSite](../src/js/boot_site.js#L11). |
| A toolbar key differs from typing it | Check user-action dispatch and byte ownership: [sendKeyAsUser](../src/js/term_view.js#L1421), [toolbar send](../src/components/MobileToolbar/index.jsx#L166). |
| An operation remains busy or acts on the wrong entry | Follow the response expectation and selected owner: [CommandQueue](../src/js/command_queue.js#L145), [activeListSession](../src/js/pttchrome.jsx#L1668). |
| Returning from an operation moves the viewport | Inspect the bookmark, outcome policy, and delayed restore: [ReadingRecord](../src/js/reading_record.js#L328), [ListSession restore](../src/js/list_session.js#L1344). |
| Screen text or layout differs from PTT output | Compare buffer text and the unified renderer: [getRowText](../src/js/term_buf.js#L1337), [renderScreen](../src/js/term_ui.js#L41), [golden DOM tests](../tests/unit/render_dom_equivalence.test.js#L30). |
| Touch-down appearance differs from completed tap behavior | Inspect event-phase feedback separately from the action: [pointer-down ripple](../src/js/ripple.js#L23), [contextmenu](../src/components/ContextMenu/index.jsx#L403), and [real-input helpers](../tests/e2e/helpers/real_input.js#L1); these sources do not establish the cause of a specific device flash. |

## Research limits and maintenance

The referenced tests establish where existing contracts are checked; they were read, not executed for this research. Synthetic key-dispatch tests do not establish native touch behavior: the real-input helper uses browser/OS entry points for those cases. [Key-dispatch tests](../tests/unit/term_view_send_key_as_user.test.js#L47), [real-input rationale](../tests/e2e/helpers/real_input.js#L1).

The `facts` objects are caller-built and context-specific, not one universal screen DTO: article-list facts add classification and article numbers, whereas board-list handling owns its separate screen interpretation. Do not pass one owner's facts to another owner's expectation. [Article-list facts](../src/js/list_session.js#L1052), [queue-owner guard](../src/js/list_session.js#L1033).

When these interfaces change, update their contract and source anchors here with the relevant regression entry point. Keep domain definitions in the glossary and detailed feature mechanisms in the existing topic documents.
