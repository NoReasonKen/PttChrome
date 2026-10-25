# Article Swipe Drawer Feasibility

## Conclusion and scope

A finger-following right drawer is feasible in the shared web application. The original drawer alone is moderate work; the agreed feature also includes article swipe-exit rendering and persistent chained-search return, which add navigation and lifecycle integration. No additional dependency or Android bridge has been established as necessary. This is a source-based assessment, not a prototype, device validation, or performance measurement.

The owner-approved [product specification](article-swipe-drawer-spec.md) records confirmed interaction decisions. The formal specification and its six implementation slices are published under [issue #11](https://github.com/NoReasonKen/PttChrome/issues/11). Publication does not start implementation.

## Reusable foundations

| Area | Existing foundation and additional work |
| --- | --- |
| Drawer placement and sizing | Mantine supports side placement and CSS dimensions. |
| Modal and Back ownership | Reuse named modal gates and sheet-dismissal registration. |
| Focus, Escape, backdrop | Drawer provides the building blocks; activation must match partial drag and settled states. |
| Continuous progress and flings | Add an application-owned gesture controller; an open/closed boolean is insufficient. |
| Article retraction and underlay | Add moving article surfaces and a bounded, inert list preview; no live list exists underneath the article. |
| Search shortcuts and return | Reuse serialized navigation and identity anchors; extend search-origin and recovery ownership deliberately. |

Mantine's official documentation confirms positioning, sizing, transitions, and compound components. Installed @mantine/core 9.7.3 interfaces expose no drawer-specific drag-progress/fling API. Installed DrawerRoot and ModalBaseContent show portal rendering, default keepMounted false, and transitions driven by open state. The library can supply the shell, but the application must own drag progress. [Official Drawer documentation](https://mantine.dev/core/drawer/).

The existing MobileSheet is specifically a bottom/floating sheet with downward handle dragging. Prefer a separate article-drawer adapter or deliberate shared-shell refactor over injecting article gestures into every sheet. Theme, modal, and dismissal conventions are reusable. [MobileSheet](../src/components/MobileSheet/index.jsx), [ContextSheet](../src/components/ContextMenu/ContextSheet.jsx).

## Gesture integration constraints

For Pointer Events, narrowly scoped touch-action: pan-y pinch-zoom is a candidate for preserving vertical scrolling and pinch while reserving horizontal input. It must be present before the gesture begins; changing it after recognition does not change the browser's current gesture decision. Handle pointercancel as cancellation. This candidate still needs real-input validation with the app's selection and media paths. [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action).

The opening contact starts outside a closed drawer. Keep a stable owner through release/cancellation; a newly mounted portal and focus trap do not automatically inherit the original event stream. Pointer capture can retain events, but capture, mounting, focus, click suppression, and modal activation need coordinated lifetimes. [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture), [Existing sheet lifecycle](../src/components/MobileSheet/index.jsx).

Existing pull gestures have passive touch listeners and independent direction decisions. Validate coexistence rather than assuming vertical/horizontal classification alone proves compatibility. [Pull refresh](../src/js/pull_refresh.js), [Pull next article](../src/js/pull_next_article.js), [Image viewer](../src/js/image_viewer.js).

Android claims inward Back gestures from either screen edge. Do not promise receipt of contacts owned by the system or introduce native edge exclusion merely for this drawer. Do not reintroduce wheel-based navigation simulation or global horizontal overscroll suppression: desktop browser/trackpad behavior must remain intact. A mobile touch-action candidate is not a guarantee about desktop navigation. [Android gesture navigation](https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav), [Current wheel gate](../src/js/swipe_gesture.js), [Scroll styles](../src/css/main.css).

## Article exit and return architecture

Use one owner for article horizontal gestures and separate state-dependent actions. Reuse existing user-navigation gates and easy-reading exit behavior rather than raw protocol bytes or simulated browser history. [Navigation entry](../src/js/pttchrome.jsx), [Navigation gates](../src/js/nav_key_gate.js), [Back routing](../src/js/history_back_guard.js).

ListSession retains list data and a reading anchor while suspended, but article handoff changes the rendered surface. ScreenController detaches the list view and disposes unused rows. The old list is not a supported live background screen; reading records are bookmarks, not screenshots. A static viewport preview needs its own bounded capture and lifetime, with inert content, no duplicated main-container writer, no new media loads, and context invalidation. This is a design inference, not a tested implementation. [List lifecycle](../src/js/list_session.js), [Screen ownership](../src/render/screen.js), [Reading records](../src/js/reading_record.js).

The toolbar already exposes previous/first/next same-thread commands. Equivalent direct article-view same-thread/author search entries were not located: current search availability is list-oriented. Verify PTT protocol and navigation before implementing those two shortcuts. [Toolbar actions](../src/js/mobile_toolbar.js), [Toolbar dispatch](../src/components/MobileToolbar/index.jsx), [Search controller](../src/js/article_search.js).

AID-jump history already stores bounded lightweight anchors, but its lifecycle clears history on unmanaged navigation. It cannot be reused unchanged for result-list return and persisted search chains. Existing reconnect/open-resume uses identity and reading-position bookmarks, making shared restoration primitives worth assessing. Inspect transaction ownership and recovery validation before extending them. [Anchor history](../src/js/nav_history.js), [AID navigation](../src/js/aid_navigation.js), [Reconnect/open resume](../src/js/reconnect_resume.js).

## Performance and implementation recommendation

Progress/release calculations are constant-size work. Transform-driven panel/article surfaces and an opacity-driven backdrop updated at most once per frame are reasonable candidates. Do not rebuild or repeatedly measure the accumulated article on every move. Long-page compositing and preview capture still need measurement; no frame-rate or memory guarantee is established.

The dominant cost is input arbitration, article/search navigation, persistent recovery, and regression coverage. Keep those seams distinct while sharing gesture and identity primitives. Calibrate gesture constants through a small prototype and real touch feedback. The specification lists future acceptance coverage; none was executed for this research.
