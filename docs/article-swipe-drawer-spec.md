# Article Shortcut Drawer and Swipe Exit

Status: owner-approved specification and test approach, tracked by [issue #11](https://github.com/NoReasonKen/PttChrome/issues/11) and its slices #12–#17. Source evidence and implementation constraints are in [the feasibility research](article-swipe-drawer-research.md); implementation notes follow the product rules below.

## Scope and actions

Enable an article horizontal-gesture preference by default, controlling both the shortcut drawer and swipe exit. Apply it only to mobile layout during article easy reading, in the Android app and mobile browser. Keep existing menu access. Article lists, mail, desktop layout, and other reading surfaces retain their existing gesture behavior.

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

During article exit, move the article title and content together. The app-owned bottom toolbar stays fixed. The revealed underlay is a non-interactive static preview of the list before article entry, with a dark fallback when no matching preview exists. It is not a live server list. A canceled drag sends no exit command; commit actual navigation only when release accepts the exit.

Suspend background interaction once a panel drag is recognized and while the drawer is open. Enable menu activation only after it settles open; a fresh touch during the opening animation completes that animation immediately so the first intentional tap is accepted. The original drag release cannot activate a shortcut. Shortcut labels have a cyan underline to distinguish them from article text visible through the panel. Tapping any space outside the shorter panel, including above/below or to its left, closes it without passing the tap through. System Back and Escape also close the drawer. Closing without navigation preserves article reading position.

## Interruption and resizing

- Touch cancellation or a second contact restores the pre-drag state without applying ordinary release/fling rules.
- An already open drawer adapts to rotation or available-area changes.
- A size change during an active drawer drag cancels it and closes the drawer without exiting the article; a size change during an article exit drag or its settling cancels the exit without navigation.
- A captured list preview survives height-only changes, such as a mobile browser showing or hiding its address bar while the article scrolls, and is clipped to the current list area. A width change (rotation) re-lays out the list, so the next exit shows the dark fallback.
- Leaving the original article closes the drawer and invalidates any ongoing drag.
- Keep Android system bars and system edge navigation under platform ownership.

## Search return history

Retain at most eight recent search origins; discard the oldest on overflow. Store lightweight article identity, query/context, and reading-position metadata, never complete article buffers or a chain of recursive navigation callbacks.

For article A -> search results -> article B, exiting B first returns to its results; the next Back reopens A. Nested searches unwind the same way, one step at a time. Reopening aims for the previous reading position without requiring identical pixel offsets.

If a source article is deleted or cannot be located reliably, stop on its verified board list and explain; never open a guessed replacement. Only that source's origin is consumed: the older origins remain, so the next Back from that list continues with the parent's results. Rebuilding a level's results needs its source only when the query does: an author search still rebuilds from the known author when its source is gone, while a same-thread search, which reads the source's own header, stops on the board list instead.

History is scoped to one board and compares board names case-insensitively, as PTT does. Clear it when the user switches boards, starts another list search (a search key on a list or a search-sheet submission), or returns to the main menu. Keys pressed inside an article, such as PTT's in-article text search `/`, are not list searches and keep it. Retain it through disconnection, reload, and app close/reopen on the same device, with a 12-hour validity window aligned with the existing open-resume mechanism. Do not sync it to the cloud. Temporary intermediate screens during automatic reconnection, including its main menu and board entry, are not user board switches.

After recovery, validate the restored board and article/search context before reactivating history. Matching a board name alone is insufficient. If validation cannot establish the context, keep the return path inactive and explain instead of applying it blindly. Recovery from search results, or from a result article whose identity is unknown, lands on the full board list; Back there rebuilds the results, and the search is never resubmitted automatically. The route stays active only when that landing verifies its context; otherwise it stays inactive with the explanation.

Reuse existing article identity, reading-position, serialized navigation, and resume machinery. The owner permits improving the existing resume implementation when a concrete benefit is established; a speculative rewrite is not required.

## Completion and failure

Permit one search/navigation operation at a time and reject duplicate starts. With no search results, return to the source article and show a notice. On failure, restore safely if possible; otherwise stop on the verified screen and explain, without repeated automatic retries.

## Acceptance coverage

These are required future checks, not claims of completed verification:

Installed-Android rotation acceptance is deferred pending [#18](https://github.com/NoReasonKen/PttChrome/issues/18): the owner reports that rotation exits article easy reading. Automated viewport checks do not establish that this underlying device behavior is fixed.

- Real touch input from different starting positions, links, and previews; ordinary tap, long press, vertical scrolling, selection, and pinch remain functional.
- Both sides and exact equality of all distance thresholds; deliberate fast flings, slow release after an earlier fast segment, and final reversals.
- No operation chaining, click-through, duplicate navigation, or input leakage while dragging/open/searching.
- Correct moving surfaces, panel proportions, opaque readable labels, fixed bottom toolbar, and static-list/dark exit underlays.
- Open-state resize adaptation, drag interruption, second contact, system Back, and article changes.
- All five actions, whole-board search from filtered origins, no results, failure, deleted origins, nested return, and eight-entry eviction.
- Persistence and context validation after disconnect/reload/reopen, expiry, user board switches, and no cloud-history synchronization.
- Related offline/adverse coverage and Android device checks for gesture conflicts and perceived responsiveness. Live PTT runs still require an explicit request for that run.

## Implementation notes

`article_gestures.js` owns each contact across the article and its separately mounted drawer, using the existing named modal source and sheet-dismissal registration for background gating, Escape and system Back. `article_horizontal_gesture.js` supplies direction locking, net displacement and release decisions independently of DOM mounting. The initial calibration is 10px movement tolerance, a 100ms velocity window, 0.65px/ms fling speed and 180ms settling; a stationary release contributes to the velocity window so a pause does not preserve an old fling. `article_exit_preview.js` copies a bounded, inert presentation of the visible list rows when an article opens from a list.

The list preview preserves the original text size, including Android system font scaling. WebView computed font sizes and line heights already include text zoom. Before assigning those values to the copy, normalize them by the list's computed-to-declared pixel font ratio so WebView applies the scale once. Preserve measured row positions and box sizes. The post-animation navigation handoff is tracked separately in [#20](https://github.com/NoReasonKen/PttChrome/issues/20), scheduled after this specification's acceptance.

After horizontal intent is recognized, a non-passive single-contact `touchmove` handler cancels native scrolling as well. It is bound only to the eligible mobile article surface and its drawer, rather than the whole application. Canceling `pointermove` alone does not cancel native panning ([Pointer Events specification](https://www.w3.org/TR/pointerevents/#the-touch-action-css-property)); a diagonal opening fling can otherwise leave native momentum that consumes the next tap. Undecided contacts, vertical scrolling and multiple contacts retain their native behavior. Real-touch coverage includes a diagonal fling released without the distance tests' stationary hold, followed by a single backdrop or shortcut tap.

`article_shortcut_search.js` owns identity capture, the serialized search and Back routing; `search_return_history.js` holds the pure route transitions and `search_return_storage.js` the local storage. Author search reuses native `a` semantics (case-insensitive substring matching), sent only after the native author prompt is recognized. Same-thread search uses native uppercase `S`, which takes the selected header's normalized subject (`read.c` `read_cmd_search_title`, `ask_filter_predicate`; `common/bbs/search.c` compares subjects case-insensitively); no client-side title normalization is used. Both capture the source reading bookmark before entering native mode, resolve its AID through `AidNavigation.resolvePostAid` (dismissing the information box only after a Q response) and select it in the full board list with `AidNavigation.selectArticle`, leaving any previous subset first.

Rebuilding a query resets PTT's cursor to the newest result, so the route never reopens an article inside reconstructed results: a reopened source stays in the full board list, its next Back resubmits the parent query, and the Back after that reopens the parent by AID. Missing identities never fall back to an article number. Empty searches restore the source with a notice; unknown screens stop visibly without blind retries. While the easy-reading list shows cards, Back judges results versus the full list from the list session's own board and numbering space, because its background fill keeps rewriting the terminal behind the cards.

Recovery follows only reconnect resume (`reconnect_resume.js`), never a board name. When the connection closes after login, the route is suspended with the resume plan; when the page is hidden or closed, it is stored beside the resume snapshot under the local key `pttchrome.searchReturn.v1`, outside the preference document. Startup reads it once and deletes it; expired or damaged records are dropped silently. A suspended route ignores every screen until that plan's own resume transaction ends, and reactivates only on exactly its stored target (`search_return_history.recovered`): the same verified AID with the same author and title, or the full board list for list targets. Articles reopened by AID are remembered by `aidNavigation.currentPostAid`, so a later interruption resumes the article itself. Anything else leaves the route inactive with `articleShortcutSearch_recoveryInactive`; logout clears it silently.

Coverage: `tests/unit/article_horizontal_gesture.test.js` (release boundaries), `tests/unit/search_return_history.test.js` (bound, transitions, expiry and validation), `tests/unit/search_return_storage.test.js` (local-only storage), and complete-app offline replay with real touch through `tests/e2e/helpers/article_gestures.js` and `tests/e2e/helpers/article_shortcut_search.js`: `mobile_article_gestures`, `mobile_article_exit`, `mobile_article_shortcut_search`, `mobile_article_thread_search`, `mobile_article_nested_search` and `mobile_article_search_recovery` offline specs. After a reload the browser's own Back can traverse an older back-guard entry, so reload cases use the keyboard Back. Platform edge gestures, perceived responsiveness and installed close/reopen require Android device acceptance.
