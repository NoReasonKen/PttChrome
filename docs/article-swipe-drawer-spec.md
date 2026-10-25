# Article Shortcut Drawer and Swipe Exit

Status: design interview decisions recorded; awaiting final owner review. This document does not authorize implementation. Source evidence and implementation constraints are in [the feasibility research](article-swipe-drawer-research.md).

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

Suspend background interaction once a panel drag is recognized and while the drawer is open. Enable menu activation only after it settles open. Tapping any space outside the shorter panel, including above/below or to its left, closes it without passing the tap through. System Back and Escape also close the drawer. Closing without navigation preserves article reading position.

## Interruption and resizing

- Touch cancellation or a second contact restores the pre-drag state without applying ordinary release/fling rules.
- An already open drawer adapts to rotation or available-area changes.
- A size change during an active drawer drag cancels it and closes the drawer without exiting the article.
- Leaving the original article closes the drawer and invalidates any ongoing drag.
- Keep Android system bars and system edge navigation under platform ownership.

## Search return history

Retain at most eight recent search origins; discard the oldest on overflow. Store lightweight article identity, query/context, and reading-position metadata, never complete article buffers or a chain of recursive navigation callbacks.

For article A -> search results -> article B, exiting B first returns to its results; the next Back reopens A. Nested searches unwind the same way, one step at a time. Reopening aims for the previous reading position without requiring identical pixel offsets. If the source article is deleted or cannot be located reliably, stop at its board list and explain; never open a guessed replacement.

History is scoped to one board. Clear it when the user switches boards. Retain it through disconnection, reload, and app close/reopen on the same device, with a 12-hour validity window aligned with the existing open-resume mechanism. Do not sync it to the cloud. Temporary intermediate screens during automatic reconnection are not user board switches.

After recovery, validate the restored board and article/search context before reactivating history. Matching a board name alone is insufficient. If validation cannot establish the context, keep the return path inactive and explain instead of applying it blindly.

Reuse existing article identity, reading-position, serialized navigation, and resume machinery. The owner permits improving the existing resume implementation when a concrete benefit is established; a speculative rewrite is not required.

## Completion and failure

Permit one search/navigation operation at a time and reject duplicate starts. With no search results, return to the source article and show a notice. On failure, restore safely if possible; otherwise stop on the verified screen and explain, without repeated automatic retries.

## Acceptance coverage

These are required future checks, not claims of completed verification:

- Real touch input from different starting positions, links, and previews; ordinary tap, long press, vertical scrolling, selection, and pinch remain functional.
- Both sides and exact equality of all distance thresholds; deliberate fast flings, slow release after an earlier fast segment, and final reversals.
- No operation chaining, click-through, duplicate navigation, or input leakage while dragging/open/searching.
- Correct moving surfaces, panel proportions, opaque readable labels, fixed bottom toolbar, and static-list/dark exit underlays.
- Open-state resize adaptation, drag interruption, second contact, system Back, and article changes.
- All five actions, whole-board search from filtered origins, no results, failure, deleted origins, nested return, and eight-entry eviction.
- Persistence and context validation after disconnect/reload/reopen, expiry, user board switches, and no cloud-history synchronization.
- Related offline/adverse coverage and Android device checks for gesture conflicts and perceived responsiveness. Live PTT runs still require an explicit request for that run.
