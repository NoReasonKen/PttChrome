# Article Shortcut Drawer and Swipe Exit

Status: implemented and accepted on the installed Android app, tracked by [issue #11](https://github.com/NoReasonKen/PttChrome/issues/11) and its slices #12–#17. Rotation acceptance moved to [#18](https://github.com/NoReasonKen/PttChrome/issues/18). Source evidence and implementation constraints are in [the feasibility research](article-swipe-drawer-research.md); implementation notes follow the product rules below.

## Scope and actions

Enable an article horizontal-gesture preference by default, controlling both the shortcut drawer and swipe exit. Apply it only to mobile layout during article easy reading, and for swipe exit also on easy-reading article lists ([#32](https://github.com/NoReasonKen/PttChrome/issues/32)) and smooth-scrolling board lists ([#53](https://github.com/NoReasonKen/PttChrome/issues/53)), in the Android app and mobile browser. Keep existing menu access. Mail, desktop layout, and other reading surfaces retain their existing gesture behavior.

The drawer contains these five actions in order, using existing same-thread terminology and semantics:

1. Search the current board for the same thread.
2. Open the previous article in the same thread.
3. Open the first article in the same thread.
4. Open the next article in the same thread.
5. Search the current board for the same author.

Search directly from the current article without an editable query prompt. Search the entire current board, including when the source article came from filtered results. Same-thread actions must share the existing thread meaning rather than exact whole-title string equality. Verify the actual PTT protocol before implementation; the two direct search shortcuts require integration beyond relocating existing controls.

## Direction and input ownership

| Starting state | Up/down | Left | Right |
| --- | --- | --- | --- |
| Drawer closed | Browse the article | Reveal the drawer | Retract and exit the article |
| Drawer open | No action | No action | Retract the drawer |

Start from any eligible article-content position, including text, blank space, inline preview images, and links. System edge gestures, an open image viewer, editable fields, video controls, text selection, and another active modal retain their input ownership. Do not intercept desktop trackpad/browser navigation.

Wait for intentional movement before choosing direction. Horizontal displacement must exceed vertical displacement; exact diagonal ties count as vertical. Once an axis or a long press owns the contact, do not transfer it to another axis. Allow reversals within the horizontal axis.

Preserve taps and long presses. A recognized horizontal drag must not also activate its original image/link, a menu action, or a background control. One contact performs one operation: retracting a drawer cannot continue into article exit without releasing and starting another gesture. Reversal cancels progress within the selected operation rather than starting a different operation.

## Motion and release rules

Follow finger displacement one-to-one. Let W be the article viewport width:

| Operation | Distance required at release | Commit | Otherwise |
| --- | --- | --- | --- |
| Reveal a closed drawer | Reveal more than 0.5W | Settle open at 0.75W | Close |
| Retract an open drawer | Retract more than half its width, or 0.375W | Close | Restore fully open |
| Retract an article | Retract more than 0.5W | Exit the article | Restore the article |

Distance is net panel position at release, not total travel. Equality does not commit. The owner accepts that a slow opening drag starting in the left half may run out of screen space before crossing the opening threshold.

A deliberate fast fling overrides distance. Use the final recent direction and velocity before release, not a whole-gesture average. Left flings open a revealing drawer or cancel retraction; right flings retract a drawer/article or cancel drawer reveal. Require intentional movement so contact jitter is not a fling. Initial movement tolerance, velocity window, fling threshold, and settling timing are implementation-calibration parameters, to be proposed and evaluated with prototype/device feedback without changing these product rules.

## Visual surfaces and geometry

The drawer overlays a stationary article. Its width is 75% of the article viewport. Its height is 60% of the available web-page height after excluding the bottom toolbar. Align it to the right and center it vertically in that area. Divide height equally among the five actions. Initially use a 50%-transparent panel background and fully opaque text; allow label wrapping without truncating names. Detailed colors, typography, and small-screen fit remain visual calibration work within these proportions, not permission to replace them with a scrollable menu.

During article exit, move the article title and content together. The app-owned bottom toolbar stays fixed. The revealed underlay is the article list the article was opened from, kept alive as a live layer ([#28](https://github.com/NoReasonKen/PttChrome/issues/28)), with a dark fallback when no matching list exists. While dragging, the layer takes no input. A canceled drag sends no exit command; commit actual navigation only when release accepts the exit. After release the article stays off screen until the real list is presented: the revealed layer scrolls at once, and the real list takes over at the same reading position once the reader is idle. ←, system Back and the toolbar's ← reveal the layer the same way when it exists. When PTT answers with a different page than the revealed one, its page takes over at once; that answer, or no answer within 5 s, discards the lower layers, so the next Back waits for PTT.

The same stack continues one level up ([#31](https://github.com/NoReasonKen/PttChrome/issues/31)): a board opened from the home dashboard or from a board list (board-list smooth scrolling) keeps that page alive under its article list. The dashboard's layer is a second render of the dashboard view over the same controller state, and the real dashboard stays hidden until the swap; a board list's layer re-renders its last frame like an article list's. ←, system Back and the keypad ← on that article list slide it away over the revealed page with the same handoff, and the dashboard takes over at its own reading anchor. A board tapped on the revealed page opens after the swap, found by name; a board that is gone gives a notice. A board reached any other way, such as a search, reveals neither page. A board list opened from a board list's row, such as a class group or a 目錄 folder, stacks the same way: it slides in over that list, and Back from it reveals the list at once. The native class root (分類看板) is no stacked page, so Back from a list opened from it waits for PTT.

A right swipe on an easy-reading article list ([#32](https://github.com/NoReasonKen/PttChrome/issues/32)) or a smooth-scrolling board list ([#53](https://github.com/NoReasonKen/PttChrome/issues/53)) goes back the same way, with the article's recognition, one-to-one movement, 0.5W threshold, fling and cancellation. It reveals the page below the list, or the dark fallback when there is none; the fallback stays until PTT shows its next page, whichever it is. A list has no drawer, so a left swipe does nothing. The article horizontal-gesture preference controls the list swipe too.

Opening an article, or a board from the dashboard or a board list, is the same motion in reverse ([#36](https://github.com/NoReasonKen/PttChrome/issues/36)): the new page slides in from the right over the page it is opened from, which shows beside it as the same live layer, while the bottom toolbar stays fixed. Until PTT answers, the new page shows only the existing loading state. Its content appears with PTT's answer, whether that is the article, the board's article list, a board's entry screen or another page; an open that never reports an outcome shows what PTT shows after the handoff bound. A failed open, including PTT showing that page again, slides the new page back out over that page, with the existing notice. With article-list easy reading off, a board's article list is not stacked and opens as before. Back or a new contact on a page PTT has answered ends its slide in place. The entry uses the article settle duration, to be calibrated on the device.

Suspend background interaction once a panel drag is recognized and while the drawer is open. Enable menu activation only after it settles open; a fresh touch during the opening animation completes that animation immediately so the first intentional tap is accepted. The original drag release cannot activate a shortcut. Shortcut labels have a cyan underline to distinguish them from article text visible through the panel. Tapping any space outside the shorter panel, including above/below or to its left, closes it without passing the tap through. System Back and Escape also close the drawer. Closing without navigation preserves article reading position.

## Interruption and resizing

- Touch cancellation or a second contact restores the pre-drag state without applying ordinary release/fling rules.
- An already open drawer adapts to rotation or available-area changes.
- A size change during an active drawer drag cancels it and closes the drawer without exiting the article; a size change during an article exit drag or its settling cancels the exit without navigation.
- The kept list layer survives height-only changes, such as a mobile browser showing or hiding its address bar while the article scrolls. A width change (rotation) re-renders the kept layers from their stored frames at the new width, so the next exit still reveals them ([#35](https://github.com/NoReasonKen/PttChrome/issues/35)).
- Leaving the original article closes the drawer and invalidates any ongoing drag.
- Keep Android system bars and system edge navigation under platform ownership.

## Search return history

Retain at most eight recent search origins; discard the oldest on overflow. Store lightweight article identity, query/context, and reading-position metadata, never complete article buffers or a chain of recursive navigation callbacks.

For article list -> article A -> search results -> article B, exiting B first returns to its results, revealed at once like any article list ([#33](https://github.com/NoReasonKen/PttChrome/issues/33)). An article shortcut search keeps the page stack ([#49](https://github.com/NoReasonKen/PttChrome/issues/49)): A stays alive under its results, so the next Back reveals A at once at its reading position while search return history reopens it by its article code, and Back from A reveals the list it was opened from, at A's entry. Nested searches unwind the same way, one level per Back; results rebuilt by search return take over from their revealed layer. Levels beyond the live-layer bound ([#48](https://github.com/NoReasonKen/PttChrome/issues/48)) keep only their identity and position, and Back to them waits for PTT. A search that fails, finds nothing or returns to A without results keeps no layer of A, and a source that is gone stops on its verified board list with no layer left. Results reconstructed by recovery are a new base with no lower page ([#35](https://github.com/NoReasonKen/PttChrome/issues/35)). Reopening aims for the previous reading position without requiring identical pixel offsets.

If a source article is deleted or cannot be located reliably, stop on its verified board list and explain; never open a guessed replacement. Only that source's origin is consumed: the older origins remain, so the next Back from that list continues with the parent's results. Rebuilding a level's results needs its source only when the query does: an author search still rebuilds from the known author when its source is gone, while a same-thread search, which reads the source's own header, stops on the board list instead.

History is scoped to one board and compares board names case-insensitively, as PTT does. Clear it when the user switches boards, starts another list search (a search key on a list or a search-sheet submission), or returns to the main menu. Keys pressed inside an article, such as PTT's in-article text search `/`, are not list searches and keep it. Retain it through disconnection, reload, and app close/reopen on the same device, with a 12-hour validity window aligned with the existing open-resume mechanism. Do not sync it to the cloud. Temporary intermediate screens during automatic reconnection, including its main menu and board entry, are not user board switches.

After recovery, validate the restored board and article/search context before reactivating history. Matching a board name alone is insufficient. If validation cannot establish the context, keep the return path inactive and explain instead of applying it blindly. Recovery from known search results automatically reconstructs the saved query before reactivating the route; the next Back returns to its source directly. The query must match the one saved with that route, and reconstruction must land on verified results. Recovery from a result article whose identity is unknown retains the full-board fallback, where Back rebuilds the results. Search-result reconstruction follows the shared [search recovery contract](article-search.md#recovering-search-results), including local storage, supported filter chains, and safe failure behavior.

Reuse existing article identity, reading-position, serialized navigation, and resume machinery. The owner permits improving the existing resume implementation when a concrete benefit is established; a speculative rewrite is not required.

## Completion and failure

Permit one search/navigation operation at a time and reject duplicate starts. With no search results, return to the source article and show a notice. On failure, restore safely if possible; otherwise stop on the verified screen and explain, without repeated automatic retries.

## Acceptance coverage

The owner accepted these on the installed Android app through #12–#17, except rotation; exceptional paths such as eight-entry eviction rely on the automated coverage below.

Installed-Android rotation acceptance moved to [#18](https://github.com/NoReasonKen/PttChrome/issues/18): the owner reports that rotation exits article easy reading. Automated viewport checks do not establish that this underlying device behavior is fixed.

- Real touch input from different starting positions, links, and previews; ordinary tap, long press, vertical scrolling, selection, and pinch remain functional.
- Both sides and exact equality of all distance thresholds; deliberate fast flings, slow release after an earlier fast segment, and final reversals.
- No operation chaining, click-through, duplicate navigation, or input leakage while dragging/open/searching.
- Correct moving surfaces, panel proportions, opaque readable labels, fixed bottom toolbar, and static-list/dark exit underlays.
- Open-state resize adaptation, drag interruption, second contact, system Back, and article changes.
- All five actions, whole-board search from filtered origins, no results, failure, deleted origins, nested return, and eight-entry eviction.
- Persistence and context validation after disconnect/reload/reopen, expiry, user board switches, and no cloud-history synchronization.
- Related offline/adverse coverage and Android device checks for gesture conflicts and perceived responsiveness. Live PTT runs still require an explicit request for that run.

## Implementation notes

`article_gestures.js` owns each contact across the article and its separately mounted drawer, using the existing named modal source and sheet-dismissal registration for background gating, Escape and system Back. `article_horizontal_gesture.js` supplies direction locking, net displacement and release decisions independently of DOM mounting. The initial calibration is 10px movement tolerance, a 100ms velocity window, 0.65px/ms fling speed and 180ms settling; a stationary release contributes to the velocity window so a pause does not preserve an old fling. `navigation_stack.js` keeps the page stack (`page_stack.js`) for every level and runs the handoff after release. Each lower page is a live layer: `stack_list_layer.js` renders an article list's or a board list's last frame with a second instance of the screen renderer, and `stack_home_layer.js` renders the home dashboard a second time over its controller's state.

The list layer is rendered by the same renderer with the same declared sizes, so it keeps the original text size, including Android system font scaling.

After horizontal intent is recognized, a non-passive single-contact `touchmove` handler cancels native scrolling as well. It is bound only to the eligible mobile article surface and its drawer, rather than the whole application. Canceling `pointermove` alone does not cancel native panning ([Pointer Events specification](https://www.w3.org/TR/pointerevents/#the-touch-action-css-property)); a diagonal opening fling can otherwise leave native momentum that consumes the next tap. Undecided contacts, vertical scrolling and multiple contacts retain their native behavior. Real-touch coverage includes a diagonal fling released without the distance tests' stationary hold, followed by a single backdrop or shortcut tap. Native panning can still take over a slow opening drag before horizontal intent is recognized, since Android's touch slop is smaller than the gesture's; the next tap then only stops the leftover momentum and Android sends no click for it. Drawer shortcuts and the backdrop therefore act when a tap's finger lifts and suppress a click that still follows; keyboard activation keeps the click handlers. A debug recording traces each contact, click and settle on the drawer (`articleGestures.*`).

`article_shortcut_search.js` owns identity capture, the serialized search and Back routing; `search_return_history.js` holds the pure route transitions and `search_return_storage.js` the local storage. Author search reuses native `a` semantics (case-insensitive substring matching), sent only after the native author prompt is recognized. Same-thread search uses native uppercase `S`, which takes the selected header's normalized subject (`read.c` `read_cmd_search_title`, `ask_filter_predicate`; `common/bbs/search.c` compares subjects case-insensitively); no client-side title normalization is used. Both capture the source reading bookmark before entering native mode, resolve its AID through `AidNavigation.resolvePostAid` (dismissing the information box only after a Q response) and select it in the full board list with `AidNavigation.selectArticle`, leaving any previous subset first.

Rebuilding a query resets PTT's cursor to the newest result, so the route never reopens an article inside reconstructed results: a reopened source stays in the full board list, its next Back resubmits the parent query, and the Back after that reopens the parent by AID. Missing identities never fall back to an article number. Empty searches restore the source with a notice; unknown screens stop visibly without blind retries. While the easy-reading list shows cards, Back judges results versus the full list from the list session's own board and numbering space, because its background fill keeps rewriting the terminal behind the cards.

Recovery follows only reconnect resume (`reconnect_resume.js`), never a board name. When the connection closes after login, the route is suspended with the resume plan; when the page is hidden or closed, it is stored beside the resume snapshot under the local key `pttchrome.searchReturn.v1`, outside the preference document. Startup reads it once and deletes it; expired or damaged records are dropped silently. A suspended route ignores every screen until that plan's own resume transaction ends, and reactivates only on exactly its stored target (`search_return_history.recovered`): the same verified AID with the same author and title, reconstructed results for a saved query target, or the full board list for fallback targets. Articles reopened by AID are remembered by `aidNavigation.currentPostAid`, so a later interruption resumes the article itself. Anything else leaves the route inactive with `articleShortcutSearch_recoveryInactive`; logout clears it silently.

Coverage: `tests/unit/article_horizontal_gesture.test.js` (release boundaries), `tests/unit/search_return_history.test.js` (bound, transitions, expiry and validation), `tests/unit/search_return_storage.test.js` (local-only storage), and complete-app offline replay with real touch through `tests/e2e/helpers/article_gestures.js` and `tests/e2e/helpers/article_shortcut_search.js`: `mobile_article_gestures`, `mobile_article_exit`, `mobile_article_shortcut_search`, `mobile_article_thread_search`, `mobile_article_nested_search` and `mobile_article_search_recovery` offline specs. After a reload the browser's own Back can traverse an older back-guard entry, so reload cases use the keyboard Back. Platform edge gestures, perceived responsiveness and installed close/reopen require Android device acceptance.
