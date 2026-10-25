# Article Swipe Drawer Feasibility

## Conclusion and scope

A right-side drawer that follows a finger is feasible in the shared web application. The work is moderate rather than a configuration-only change: the repository already owns menu/modal integration, but neither its current sheet nor the installed Drawer exposes the required drag-progress and release policy. No additional dependency or Android bridge is established as necessary. This is a source-based assessment, not a prototype, device validation, or performance measurement. [Existing sheet](../src/components/MobileSheet/index.jsx), [Mantine Drawer](https://mantine.dev/core/drawer/).

The proposed interaction is an article-content left drag from any horizontal starting position, up to 75% viewport coverage. On release, coverage greater than 50% of the viewport opens it fully; otherwise it closes. A sufficiently fast left fling overrides the position threshold. An open drawer can be dragged right or dismissed by tapping the remaining 25% backdrop. Exact fling, direction-lock, cancellation, and input-exclusion rules remain design decisions.

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

This is a geometry consequence of the proposed percentages, not a framework limitation. A later specification should choose whether to accept this behavior, amplify movement, or revise the release-distance rule. The feasibility assessment does not silently change the agreed 50%-of-screen threshold.

### Gesture arbitration

The browser normally owns panning and pinch zoom. For a Pointer Events implementation, a narrowly scoped `touch-action: pan-y pinch-zoom` is a candidate for leaving vertical scrolling and pinch to the browser while reserving horizontal input. The policy must be present before the gesture starts; changing it after recognizing a drag does not change the current browser decision. Handle `pointercancel` as cancellation, not as a successful release. This candidate has not been validated against the app's media/selection paths. [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action).

Direction locking must occur after a short intentional movement, then remain stable for that contact. Vertical or diagonal reading scrolls should give up drawer tracking early. A second finger, native text selection, input editing, an open image viewer, embedded media controls, and another active modal need explicit arbitration rather than a blanket document-wide interception. Existing pull-to-refresh and pull-next-article use passive touch listeners and their own direction decisions; test combined behavior. [Refresh gesture](../src/js/pull_refresh.js), [Next-article gesture](../src/js/pull_next_article.js), [Image viewer](../src/js/image_viewer.js).

The full-area opening gesture starts outside a closed drawer. The controller must therefore live on a stable article/application owner, not only inside the drawer. Pointer capture can retain subsequent events, but mounting a portal or changing focus during the drag does not automatically transfer the original stream to its new content. Keep one owner through release/cancellation and suppress the completed drag's accidental link/image activation. Coordinate partial visibility, backdrop interaction, focus trapping, and the named modal gate; do not repeatedly mount or toggle modal state on every movement. [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture), [Existing modal integration](../src/components/MobileSheet/index.jsx), installed `ModalBaseContent.mjs`.

### System navigation and other platforms

Android Back can start at either screen edge. An app-level drawer cannot promise to receive gestures already claimed by the system; Android supports selective native exclusion, but claiming system edges is unnecessary for an interior-start drawer and is not recommended here. Literal "anywhere" therefore means eligible article content whose events reach the application, with system gestures and interactive controls retaining their own rules. [Android gesture navigation](https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav).

Do not implement this by reintroducing horizontal WheelEvent navigation or applying horizontal overscroll suppression globally. The repository deliberately preserves browser/trackpad navigation. Any new touch policy should be restricted to the intended mobile article surface and separately verified for browser and APK behavior. The Pointer Events candidate above is not a claim that desktop browser navigation remains unchanged. [Current wheel gate](../src/js/swipe_gesture.js), [Current article scroll styles](../src/css/main.css).

## Cost and performance judgment

The progress and release calculations are constant-size work. A transform-driven panel and opacity-driven backdrop, updated at most once per animation frame, are a reasonable low-cost design; moving or rebuilding the accumulated article during every touch movement would add unnecessary work. No measured frame rate, memory improvement, or guaranteed device smoothness is claimed. The larger cost is regression coverage and tuning unintended activation, not the five menu rows.

Before shipping, real browser touch tests should cover slow threshold release in both directions, short fast flings, direction reversal, partial cancellation, vertical scroll, pinch, links/previews, selection mode, backdrop dismissal, system Back, viewport changes, and leaving the article mid-gesture. Follow with an Android device check for system-edge behavior and perceived responsiveness. These are future acceptance checks, not tests run for this research.

## Menu actions are a separate scope

The existing toolbar explicitly exposes same-thread previous (`[`), first (`=`), and next (`]`) navigation with article/prompt/mail gating. Same-title/same-board and same-author/same-board search shortcuts have not been located as equivalent article-view actions; the existing search availability gate is oriented around lists. Clarify and verify their navigation before estimating the complete five-action feature as simple UI relocation. This uncertainty does not block drawer feasibility. [Toolbar actions and gates](../src/js/mobile_toolbar.js), [Toolbar dispatch](../src/components/MobileToolbar/index.jsx), [Search availability](../src/js/article_search.js).

Recommendation: the drawer is a reasonable enhancement to pursue after resolving the start-position geometry and interaction exclusions. Preserve the current menu as an alternate entry. Choose gesture constants through a small isolated prototype and real touch checks rather than committing to unmeasured thresholds now. No implementation is authorized or included by this note.
