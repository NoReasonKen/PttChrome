# Article Swipe Drawer Feasibility

## Conclusion and scope

A right-side drawer that follows a finger is feasible in the shared web application. The work is moderate rather than a configuration-only change: the repository already owns menu/modal integration, but neither its current sheet nor the installed Drawer exposes the required drag-progress and release policy. No additional dependency or Android bridge is established as necessary. This is a source-based assessment, not a prototype, device validation, or performance measurement. [Existing sheet](../src/components/MobileSheet/index.jsx), [Mantine Drawer](https://mantine.dev/core/drawer/).

The proposed interaction is an article-content left drag from any horizontal starting position, up to 75% viewport coverage. Opening, drawer retraction, and article exit use the distinct release rules recorded below. An open drawer can also be dismissed by tapping the remaining 25% backdrop. Exact fling thresholds, cancellation details, and input-exclusion rules remain design decisions.

## Confirmed interaction decisions

The design interview has confirmed these decisions; they do not authorize implementation:

- Map horizontal finger displacement to drawer reveal one-to-one. Retain the 50%-of-viewport release threshold. Accept that a slow drag starting in the left half may run out of screen space before reaching that threshold; a deliberate fast fling can still open the drawer.
- Allow opening drags to start on inline preview images and article links as well as text and blank article space. Preserve ordinary taps and long presses, and suppress activation caused by a completed drawer drag. Separate controls such as an open image viewer, video controls, editable fields, and text selection retain their own input behavior.
- Use the direction and velocity of the final recent movement before release for fling decisions, rather than the whole gesture's average. A fast final left fling opens the drawer; a fast final right fling closes the drawer or exits the article according to the gesture's starting state. Exact sampling and intentional-movement thresholds remain undecided.
- Enable the first version only in mobile layout during article easy reading, for both the Android app and mobile browser. Article lists, mail, desktop layout, and other reading surfaces retain their current behavior.
- Classify intentional initial movement into up, down, left, or right sectors. Up/down belongs to article scrolling; left/right belongs to drawer interaction. Once scrolling or a long press has taken ownership, do not convert that contact into a drawer drag. Keep the chosen axis for the contact while allowing direction reversal within the horizontal axis. Initial movement tolerance remains to be specified; exact diagonal ties count as vertical.
- On touch cancellation or a second contact interrupting the drawer drag, restore the drawer's state from before that drag instead of applying normal release or fling rules. Leaving the original article closes the drawer.
- Classify horizontal movement when its absolute displacement exceeds vertical displacement; classify exact diagonal ties as vertical. A fully open drawer cannot reveal farther left. A right drag starting with the drawer closed is an article-exit gesture; a right drag starting with it open only closes the drawer. Never chain drawer close and article exit within the same contact.
- Once a drawer drag is recognized, suspend background article interaction. Enable menu action activation only after the drawer has settled open. Backdrop tap, system Back, and Escape close it; closing without navigation preserves the article reading position. Both drawer reveal/retraction and article exit must follow the finger visually; their surfaces, underlay, and basic geometry are defined below.
- Use the existing same-thread terminology and semantics consistently across the title-related shortcuts instead of exact whole-title string equality. Exact protocol behavior still requires source verification.
- The same-thread and same-author search shortcuts directly show results for the entire current board, using the current article as the query source without opening an editable prompt. Starting from an existing search result does not restrict the new search to that result set. Chained return behavior is defined below.
- With the drawer closed, vertical gestures browse the article, left gestures reveal the drawer, and right gestures retract the article. With the drawer open, only a right gesture retracts it; other swipe directions have no action and must not scroll the background article. Menu taps and explicit dismissal remain available.
- Opening or retracting the drawer moves only the drawer over a stationary article. Exiting the article moves its title and content with the finger, leaving the app-owned bottom toolbar fixed.
- During article retraction, reveal a non-interactive static preview of the list from before article entry. Use a dark fallback if no preview is available. This is not a live list or a promise of current server content. Commit the existing article-exit navigation only after release accepts the exit; cancellation preserves the article.
- A deliberate final fling overrides distance in either direction, including reversing a pending action: a final right fling cancels drawer opening, and a final left fling cancels drawer/article retraction. Without a qualifying fling, evaluate net panel position at release, not cumulative travel distance.
- Article retraction moves only the article title and content. The app-owned bottom toolbar stays fixed rather than moving as part of the PTT article surface.
- The drawer is 75% of viewport width and 60% of the article area's available height after excluding the bottom toolbar. Anchor it to the right and center it vertically within that area. Divide its height equally among the five actions. Apply 50% transparency to the background only; text remains opaque and can wrap without truncating action names. Minimum target-size behavior remains undecided.
- Tapping any space outside the shorter drawer, including above or below it, closes it without activating underlying content. Keep the bottom toolbar outside the drawer's geometry.
- Search return reopens the originating article, aiming for its previous reading position without requiring identical pixel offsets. Do not define return behavior using terminal-page row counts. If the original article is deleted or cannot be located reliably, stop at its board's list and explain the failure instead of opening a guessed replacement.
- Retain at most eight recent search origins; discard the oldest on overflow. Store only lightweight article/query/context and reading-position metadata, never eight complete article buffers. For article A -> search results -> article B, exiting B first returns to its search results; the next Back reopens A. Apply the same sequence to nested searches, unwinding one step at a time.
- Add an enabled-by-default article horizontal-gesture preference controlling both drawer opening and article exit. Preserve existing menu entries as alternate access.
- Choose initial movement tolerance, recent-velocity sampling, and fling thresholds during implementation, then calibrate with prototype/device feedback without changing the agreed geometry and state semantics. Exact equality at a distance threshold does not commit the action; restore the starting state.
- An already open drawer adapts its geometry to rotation or available-area changes. A size change during an active drawer drag cancels the drag and closes the drawer without article navigation. Search return history is scoped to one board: retain it through disconnection/reload and clear it on a board switch. Persistent lifetime and resume validation remain to be agreed.
- With no search results, return to the source article and show a notice. Permit only one navigation/search operation at a time. If an operation fails and safe restoration is unavailable, stop and explain instead of repeatedly retrying.

## Confirmed asymmetric release rules

Opening and retraction have different thresholds. Let viewport width be W:

- Opening a closed drawer: reveal more than 0.5W, or finish with an intentional fast left fling, to settle at its full 0.75W width. Otherwise close it.
- Retracting an open drawer: move right by more than half its panel width (0.375W), or finish with an intentional fast right fling, to close it. Otherwise restore it fully open.
- Retracting the article with the drawer closed: treat the article as a full-width panel. Move right by more than 0.5W, or finish with an intentional fast right fling, to exit. Otherwise restore the article.

Exact equality does not commit an action. Quantitative fling thresholds remain implementation-calibration parameters. Direction reversal and net-position semantics are confirmed above.

Use one owner for horizontal article gestures and state-dependent outcomes. Reuse existing user-navigation and easy-reading exit behavior rather than issuing raw protocol bytes or imitating browser history navigation. Keep the exit action separate from drawer rendering so implementation and regressions can be organized independently. Article exit rendering now includes continuous visual motion, so the earlier low-cost stationary-article feedback proposal no longer applies. [Existing navigation entry](../src/js/pttchrome.jsx), [Navigation gates](../src/js/nav_key_gate.js), [Existing Back routing](../src/js/history_back_guard.js).

## Reuse and additional work

| Area | Assessment |
| --- | --- |
| Right-side placement and 75% width | Straightforward: Drawer supports side placement and CSS width values. |
| Modal ownership and system Back dismissal | Reuse the established named modal gate and sheet-dismissal registration. |
| Backdrop, focus containment, Escape | Drawer provides these building blocks, but their activation must match the drag lifecycle. |
| Continuous finger tracking | Add a small gesture controller and direct visual progress; an `opened` boolean alone cannot express partial reveal. |
| Position/velocity release decision | Small deterministic state logic; velocity needs a recent sample window and minimum intentional displacement. |
| Conflicting inputs and cancellation | Main integration and regression cost; preserve scrolling, selection, media controls, and existing overlays. |

Mantine's public documentation confirms placement, sizing, transitions, and compound components. The locally installed `@mantine/core` 9.7.3 source additionally shows default `keepMounted: false`, portal rendering, and transition styles driven by modal open state; its Drawer/ModalBase interfaces have no drawer-specific drag-progress or fling option. This does not mean the library cannot be adapted. It means the application must own the gesture and coordinate it with the shell. [Official documentation](https://mantine.dev/core/drawer/), installed `DrawerRoot.mjs`, `DrawerRoot.d.ts`, and `ModalBaseContent.mjs` under `node_modules/@mantine/core`.

The current `MobileSheet` is specifically a bottom/floating sheet. It only tracks downward drags on its handle. A separate right-drawer adapter or a deliberate shared-shell refactor is preferable to adding unrelated article-gesture branches to every existing sheet. Existing visual theme, dismissal, and modal conventions remain reusable. [MobileSheet](../src/components/MobileSheet/index.jsx), [ContextSheet](../src/components/ContextMenu/ContextSheet.jsx).

## Important constraints

### Starting anywhere and the distance threshold

With a literal one-to-one mapping between finger displacement and drawer reveal, a slow left drag starting in the left half cannot reveal more than half the screen before the finger leaves the display. Starting very far left also cannot fully reveal a 75%-wide drawer. Fast-fling override helps but does not make every slow starting position equivalent.

This is a geometry consequence of the proposed percentages, not a framework limitation. The confirmed interaction decision accepts this limitation and keeps the one-to-one mapping and 50%-of-screen threshold.

### Gesture arbitration

The browser normally owns panning and pinch zoom. For a Pointer Events implementation, a narrowly scoped `touch-action: pan-y pinch-zoom` is a candidate for leaving vertical scrolling and pinch to the browser while reserving horizontal input. The policy must be present before the gesture starts; changing it after recognizing a drag does not change the current browser decision. Handle `pointercancel` as cancellation, not as a successful release. This candidate has not been validated against the app's media/selection paths. [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action).

Direction locking must occur after a short intentional movement, then remain stable for that contact. Vertical or diagonal reading scrolls should give up drawer tracking early. A second finger, native text selection, input editing, an open image viewer, embedded media controls, and another active modal need explicit arbitration rather than a blanket document-wide interception. Existing pull-to-refresh and pull-next-article use passive touch listeners and their own direction decisions; test combined behavior. [Refresh gesture](../src/js/pull_refresh.js), [Next-article gesture](../src/js/pull_next_article.js), [Image viewer](../src/js/image_viewer.js).

The full-area opening gesture starts outside a closed drawer. The controller must therefore live on a stable article/application owner, not only inside the drawer. Pointer capture can retain subsequent events, but mounting a portal or changing focus during the drag does not automatically transfer the original stream to its new content. Keep one owner through release/cancellation and suppress the completed drag's accidental link/image activation. Coordinate partial visibility, backdrop interaction, focus trapping, and the named modal gate; do not repeatedly mount or toggle modal state on every movement. [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture), [Existing modal integration](../src/components/MobileSheet/index.jsx), installed `ModalBaseContent.mjs`.

### System navigation and other platforms

Android Back can start at either screen edge. An app-level drawer cannot promise to receive gestures already claimed by the system; Android supports selective native exclusion, but claiming system edges is unnecessary for an interior-start drawer and is not recommended here. Literal "anywhere" therefore means eligible article content whose events reach the application, with system gestures and interactive controls retaining their own rules. [Android gesture navigation](https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav).

Do not implement this by reintroducing horizontal WheelEvent navigation or applying horizontal overscroll suppression globally. The repository deliberately preserves browser/trackpad navigation. Any new touch policy should be restricted to the intended mobile article surface and separately verified for browser and APK behavior. The Pointer Events candidate above is not a claim that desktop browser navigation remains unchanged. [Current wheel gate](../src/js/swipe_gesture.js), [Current article scroll styles](../src/css/main.css).

## Cost and performance judgment

The progress and release calculations are constant-size work. Transform-driven drawer/article surfaces and an opacity-driven backdrop, updated at most once per animation frame, are reasonable candidates. Article exit requires moving the article visually, but rebuilding or repeatedly measuring the accumulated article on every touch movement would add unnecessary work. Its long-page rendering and exit underlay need separate validation. No measured frame rate, memory improvement, or guaranteed device smoothness is claimed. The larger cost is regression coverage and tuning unintended activation, not the five menu rows.

Before shipping, real browser touch tests should cover slow threshold release in both directions, short fast flings, direction reversal, partial cancellation, vertical scroll, pinch, links/previews, selection mode, backdrop dismissal, system Back, viewport changes, and leaving the article mid-gesture. Follow with an Android device check for system-edge behavior and perceived responsiveness. These are future acceptance checks, not tests run for this research.

## Menu actions are a separate scope

The existing toolbar explicitly exposes same-thread previous (`[`), first (`=`), and next (`]`) navigation with article/prompt/mail gating. Same-title/same-board and same-author/same-board search shortcuts have not been located as equivalent article-view actions; the existing search availability gate is oriented around lists. Clarify and verify their navigation before estimating the complete five-action feature as simple UI relocation. This uncertainty does not block drawer feasibility. [Toolbar actions and gates](../src/js/mobile_toolbar.js), [Toolbar dispatch](../src/components/MobileToolbar/index.jsx), [Search availability](../src/js/article_search.js).

### Chained search return assessment

Repeated article -> search -> article navigation is a history-management problem, not inherently recursive execution. The repository already has an AID-jump history capped at eight origin anchors, storing identity and reading-position metadata rather than complete screens. Its current lifecycle deliberately clears history on unmanaged list navigation, so chained search return cannot be assumed to work merely by calling that history unchanged. Reuse its principles and verified navigation machinery; assess integration explicitly. [Anchor history](../src/js/nav_history.js), [Navigation lifecycle](../src/js/aid_navigation.js).

The owner approved at most eight recent search origins, with oldest-first eviction and lightweight anchors only. Return alternates through the result list and its source article, as described above, with best-effort reading-position restoration and a safe list fallback. Do not retain full article buffers, duplicate live screens, or run recursive callbacks for every previous search. Preserve history through disconnection/reload, scoped to the current board; clear it on board switches. Persistent lifetime and reactivation validation remain interview decisions. Integration with existing navigation ownership still requires implementation verification.

The existing reconnect/open-resume path already uses article identity and reading-position bookmarks. Open-resume stores a local snapshot with a 12-hour validity window; it does not sync that snapshot to the cloud. Assess shared anchors and restoration primitives first. The owner permits improving the existing resume path if the new work establishes a concrete better approach; this is not a requirement to rewrite it speculatively. [Reconnect/open resume](../src/js/reconnect_resume.js).

Recommendation: the drawer is a reasonable enhancement to pursue after resolving the remaining interaction exclusions and lifecycle decisions. Preserve the current menu as an alternate entry. Choose gesture constants through a small isolated prototype and real touch checks rather than committing to unmeasured thresholds now. No implementation is authorized or included by this note.
