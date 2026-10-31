# Far same-thread jumps

`[` (previous in thread), `]` (next in thread) and `=` (first in thread) in an easy-reading article land on their target however far away it is (#65). Every entry point uses them: the article drawer, the toolbar's More panel and the keyboard, aliases `-` and `+` included.

## Why PTT misses far targets

`mbbsd/read.c#thread` scans at most `THREAD_SEARCH_RANGE` records (500 by default, `include/config.h`) from the article being read and treats a target beyond that as missing. From inside an article, a miss reads the same article again from the top for `[` and `=`, and returns to the article list for `]`. `=` stops on the original (a title without `Re:` or `Fw:`); every reply it passes resets the range, and when the original lies beyond it, `=` lands on the earliest reply it passed instead. PTT only sends what changed on screen, so a short article read again sends nothing at all. Same-thread search results list only the thread, where the target is always in range.

## The transaction (`src/js/thread_jump.js`)

1. The key goes out with a redraw (`\f`). The answer is read by content (`threadAnswer`): another article means the jump landed and nothing more happens; the same article (same author, title and time) or the list means PTT found nothing in range. For `=`, a landing on a reply means the original was out of range, and the jump continues from that reply. A slow link only delays the answer.
   An article opened from verified search results (`readSearchResultsContext`) jumps within those results, where nothing lies out of range, so PTT's answer stands there; their caption can be an ordinary list's, so the results themselves cannot tell. The selection of the list below follows each landing (#74).
2. A miss continues out of sight: `←` to the list (the cursor is on the source), `S` lists the thread with the cursor on its last entry, and the source row is found by date, author and title (`findResultRow`), paging up from the end at most 10 pages.
3. One write moves to the source, sends the same key within the results and leaves them with `←`, which keeps the cursor on the target in the full list. `Enter` opens it.
4. When the target really does not exist, PTT's own answer stands: the same article again for `[` and `=`, the list for `]`. Under article-list easy reading, the source then slides away as on Back, over the live layer of the list it was opened from, selected at the source ([#74](https://github.com/NoReasonKen/PttChrome/issues/74)), or the dark fallback when that list keeps none (an article opened by AID) or its layer lacks the source's row (after a far jump). The page stack hands over to the list once its session presents it again (`_slideToList`), so the native list never shows. When PTT answered with the list itself, no screen follows the hold, so the article's easy reading leaves its native mirror on the list already shown (`settleFunctionMode`).

The landing is the state of a jump in range: the full article list underneath with the cursor on the target, so Back returns to the full list and the page stack treats it as another article in place of the current one.

## What the reader sees

A copy of the source article (`StackArticleLayer`) covers the screen from the key until the jump lands, the App Bar and toolbar keep the source's context (`toolbarContext`), and the progress bar is held for the whole transaction. Reader input waits (`serializedOpHint`). The list sessions are parked as for any external navigation, so the article list is rebuilt around the target when the reader goes back to it. The cover, the parked sessions, the step budget and the landing live in `src/js/hidden_article_route.js`, shared with the reopen that reads a headerless article's list row (#77, `docs/mobile.md`).

## Tests

- Unit: `tests/unit/thread_jump.test.js` (answers, source row), `tests/unit/mobile_busy.test.js` (hold).
- Offline: `tests/e2e/offline/mobile_thread_jump.offline.spec.js` and, for the list below the article (#74), `tests/e2e/offline/mobile_stack_in_place.offline.spec.js`, against a controlled PTT that models `thread()` with its 500-record range (`tests/e2e/helpers/thread_jump.js`).
