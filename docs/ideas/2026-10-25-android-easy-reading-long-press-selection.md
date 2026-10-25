# Android article easy reading: long press for one-shot text selection

Date: 2026-10-25 (Asia/Taipei)
Status: Idea with source research; implementation has not started.

## Goal and requested behavior

The reader does not need the current long-press Context action menu, including Paste, Copy article link, and Send long comment. In the installed Android app's article easy reading, a long press should instead start text selection. After one Copy or Cut action, selection mode should exit automatically so ordinary reading interactions resume.

Keep the browser version's existing context menus, including desktop right click and mobile web. Other reading modes should retain their existing behavior. The examples establish article easy reading as the initial scope; whether article-list easy reading should also participate remains an open decision.

This record captures the request and feasibility research only. No application, native, configuration, or test code was changed, and no development issue was created.

## Current implementation evidence

- The existing More menu already offers a runtime selection mode, `App.mobileSelectMode`, off by default. `setMobileSelectMode(false)` removes the document selection and updates the body class. It is not an Android-only feature. See [`App.setMobileSelectMode`](../../src/js/pttchrome.jsx) and [mobile selection behavior](../mobile.md#長按選單與選取模式觸控-contextmenu).
- [`ContextMenu`](../../src/components/ContextMenu/index.jsx) delegates to [`contextMenuDisposition`](../../src/js/context_menu_items.js). It preserves the native menu when mobile selection mode is active, while the ordinary touch path clears selection and opens the custom Context action menu. Automatic entry must happen before that clearing step, while retaining existing event-swallow and native-image priorities.
- Keep native context menus throughout an active selection session, regardless of the later event's pointer type. Releasing Android selection handles can generate a context-menu event reported as mouse input; checking for touch on every event would reopen the custom menu. The initial long press can use the existing `isTouchContextMenu` classification. See [mobile selection behavior](../mobile.md#長按選單與選取模式觸控-contextmenu).
- [`isAndroidApp`](../../src/js/android_bridge.js) recognizes the injected Android bridge configuration and distinguishes the installed app from a mobile browser. [`article_gestures.js`](../../src/js/article_gestures.js) already demonstrates eligibility checks combining mobile layout, connection state, active article easy reading, `startedEasyReading`, and absence of `easyReadingFunctionMode`; reuse the same concepts rather than relying only on screen width or a possibly stale page-state number.
- Article content is rendered into a plain `div#mainContainer` by [`screen.js`](../../src/render/screen.js), not an editable article field. [`MainActivity.kt`](../../android/app/src/main/java/io/github/abccbaandy/pttchrome/MainActivity.kt) creates an ordinary WebView with no custom selection ActionMode interception.
- [`App.doCopy`](../../src/js/pttchrome.jsx) returns an asynchronous success/failure result from `navigator.clipboard.writeText`. The keyboard-copy path in [`term_view.js`](../../src/js/term_view.js) invokes it directly. `App.mouse_up` can also invoke it for the existing `copyOnSelect` preference. A global “every doCopy ends selection” rule would also catch unrelated article-link, sharing, and long-comment operations.
- Existing [`select_mode.android.spec.js`](../../tests/e2e/android/select_mode.android.spec.js) exercises selection handles and native Copy-menu availability in Android Chrome. It does not prove installed-APK delivery of DOM copy events, actual Copy completion, or automatic mode exit.

## Platform findings

### Copy and Cut are observable, with a timing caveat

The Clipboard specification defines bubbling `copy` and `cut` events when a user initiates those actions. A document listener can observe them without reading clipboard contents. They are operation-start events, not clipboard-write success notifications. Critically, modifying selection inside the listener changes the selection used by the default action. Synchronous cleanup could therefore copy empty or different text. Read-only content has no successful default Cut operation; an attempted Cut may still fire its event. See [Clipboard events](https://www.w3.org/TR/clipboard-apis/#clipboard-events), [selection changes during handlers](https://www.w3.org/TR/clipboard-apis/#event-listeners-that-modify-selection-or-focus), and [the Cut algorithm](https://www.w3.org/TR/clipboard-apis/#cut-action).

Inference: observing native Copy through DOM events is a plausible frontend-only mechanism, but actual Android System WebView delivery and cleanup timing need an installed-app test. A deferred task is a candidate for cleanup after the default action; neither a microtask nor the event itself should be treated as proof of successful writing. Where the app owns an asynchronous clipboard call, `App.doCopy` resolving to `true` provides a stronger completion boundary.

### Article text normally supports Copy, not Cut

Chromium's Android selection controller enables Cut only for an editable focused node. Its native Copy action calls `WebContents.copy()`, and its action-mode callback finishes the native toolbar for actions other than Select all. This supports using native selection rather than creating a replacement toolbar, but it does not establish the behavior of the installed WebView version. See [`SelectionPopupControllerImpl`: `canCut`, `copy`, and `onActionItemClicked`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/android/java/src/org/chromium/content/browser/selection/SelectionPopupControllerImpl.java).

Article content should stay read-only. Copy is the practical completion action for this idea. Preserve the user's Cut request as a conditional behavior if an eligible editable target is later included; do not make articles editable or clear the mode merely because an ineffective Cut was attempted.

### Native integration is a fallback

Android's [`ActionMode.Callback`](https://developer.android.com/reference/android/view/ActionMode.Callback) reports action-button clicks and mode destruction. Those callbacks describe action intent/lifecycle, not confirmed clipboard success. Native interception would need to delegate the WebView's existing handling, keep article/session scope synchronized with the page, and avoid assuming Chromium's menu items use the platform's Copy/Cut resource IDs. It would add an APK change and bridge lifecycle work. Investigate this only if installed-app tests show the DOM path is insufficient.

## Recommended direction if promoted

1. Introduce a temporary, article-scoped selection session for an eligible initial touch long press in the installed Android app. Let WebView keep its selection and native toolbar on that same gesture; do not clear and reconstruct the selected word. Verify that enabling the existing mode at the context-menu boundary is early enough on the actual APK. Keep image, link, and editable-control ownership intact; a link long press may offer link actions without selecting text.
2. Keep this temporary session distinct from a selection mode manually enabled through More. That manual mode currently spans mobile surfaces, so the automatic session must own and restore prior state rather than permanently enabling it or disabling a user-enabled manual mode. Preserve native handling for all context-menu events belonging to the session, including handle-release events reported as mouse input.
3. Bind completion to selection of article text in that session. Observe genuine DOM Copy where supported, and account separately for app-owned keyboard Copy. Exclude editable controls, modal content, unrelated clipboard writes, synthetic events, and stale callbacks from an earlier article/session.
4. Preserve the selected text until the native default operation has consumed it. Use a session identifier when scheduling cleanup so a delayed callback cannot close a newer selection or a different article. For app-owned writes, leave the selection available on failure.
5. Resolve interaction with `copyOnSelect` before implementation: automatic copying during handle adjustment could prematurely finish the session. Explicit Copy is the clearer completion signal for the requested flow.
6. Reconcile temporary state on article change, leaving article easy reading, disconnect, and page disposal. Decide how cancellation through Back or tapping elsewhere should end the temporary session while preserving the existing manual mode.

This direction adds no clipboard polling and needs no clipboard readback. Reusing native selection and the existing mode owner appears smaller than adding a custom text-selection toolbar or native bridge capability. Exact implementation cost and reliability remain unmeasured.

## Open decisions and validation before implementation

- Decide whether this is a configurable Android-app article-long-press action or a changed default, and whether article-list easy reading belongs in scope.
- Decide whether “after Copy” means after invoking native Copy or after a confirmed successful write. DOM observation alone does not supply a success acknowledgement for native Copy.
- Decide cancellation behavior and whether any editable context should participate in Cut handling. Recommend excluding inputs and editors from this initial article-reading feature.
- Test the actual installed APK with its current reading-page revision and System WebView: first long press, Chinese and mixed text, handle dragging, repeated Copy sessions, Copy text integrity, Back, tapping elsewhere, article transitions, and failed app-owned writes.
- Confirm that dragging handles and copy-on-selection do not close the session early, and that later handle context menus never open the custom panel.
- Cover Android native PTT view, browser article easy reading, mobile web, desktop right click, editable fields, image viewer, and unrelated menus as unaffected surfaces. Test external mouse behavior separately from the initial touch gesture.
- Add focused state/ownership tests and real-input Android coverage only when implementation is authorized. Desktop mobile emulation alone is insufficient evidence for WebView's native selection UI.

Research limit: conclusions come from repository source, the Clipboard specification, Android API documentation, and current Chromium source. No device experiment or live PTT login was performed.
