# Refresh (board list, article list, article, home dashboard)

Entry points: F5/⌘R on desktop (`term_view.onKeyDown` → `App.screenRefresh.refresh('key')`), the mobile toolbar's 「重整」 ("refresh") button
(`'toolbar'`), and pulling down on mobile (`pull_refresh.js`, `'pull'`). All three share one criterion and one cooldown:
`src/js/screen_refresh.js`.

## Does PTT have a native refresh? No (CONFIRMED by reading the code, `3rd_script/pttbbs` 2026-10-13 master)

| Screen | When the data is reread | Conclusion |
|---|---|---|
| `Ctrl-L` on any screen | `mbbsd/io.c#system_key_hook`: `redrawwin(); refresh();`, returning `KEY_INCOMPLETE` | Only resends the server's virtual screen as it is; **rereads no data** |
| Article list (`read.c` + `psb.c`) | `psb_sync_cache`: calls `read_loader` only on `cmd.reload` or when the base (top of page) changes | Staying on the same page, no key shows new articles; only a page change, or return values of the FULLUPDATE/NEWDIRECT/DIRCHANGED kind, reread |
| Board list (`board.c`) | The unread flag `NBRD_UNREAD` is computed only in `check_newpost` (when the list loads); popularity is read by `get_boardheader` on every render | Seeing new-article flags takes `brdnum = -1` plus a reload |
| Article (`pmore.c`) | The whole file is mmapped when the article opens, with no reload path afterwards | New comments need the article to be reopened |

So each screen gets a native path **with no side effects that leaves the cursor in place**:

| Screen | Sends | Why this one (from the code) |
|---|---|---|
| Article list | `s` → wait for the CompleteBoard prompt → `<this board>⏎` | `bbs.c#do_select` → `enter_board` → returns `NEWDIRECT`, so `read_apply_mode` reloads; `read_exec_noitem` saves `crs_ln/top_ln` first and `getkeep(currdirect)` restores them, so the cursor stays put; this path **does not go through `Read()`**, so no board entry screen appears |
| Board list | `/` → wait for 「請輸入看板中文關鍵字」 (the board keyword prompt) → `⏎` | `board.c#board_cmd_search_keyword`: `getdata_buf` defaults to the current keyword, and ⏎ sends it unchanged, so `brdnum = -1; reload` recomputes unread flags and popularity; `ctx->curr` is kept (in newflag mode the loader jumps to the first unread, as native does) |
| Article | `aid_navigation.refresh()`: (AID from the free URL line or from `Q`) → `s<this board>⏎` → `#<AID>⏎` → `⏎` | The same sequence as an AID jump, each step verified by screen content; after landing, the reading position is restored (see below) |
| Home dashboard (the panel drawn over the main menu) | `home_dashboard.fetchFavorites`: `Ctrl+Z f` → read the page → (jump by number to page on) → cursor back → `q` | The panel already fetches favorites this way; its 「更新」 ("update") button now goes through this entry point too (same cooldown), see `docs/home-dashboard.md` |
| Article (opened from search results or a digest) | The list behind it, recorded by article-list easy reading, has `mode:'select'`, so `←` (pager FULLUPDATE, cursor unmoved) → `⏎`; when `Q` drops us back to the sub-list (title row 「系列《」/「文摘《」), close the box plus `⏎` | Inside a sub-list `#` is refused and `s<board>` returns to the sub-list again (protocol §8.1); these two paths keep the search results behind the article. When neither applies, it takes the previous row's path, leaving the sub-list with ← before `#` |

**Why the article does not use `←→` (the Live article helper's way)**: after ← back to the list, the cursor stays on the original `crs_ln`, but once the list
is reread the same number may already be a different article. The pinned articles all shift down one number when a new article arrives, and when an article above is deleted every
number shrinks by one, so → would **silently open the wrong article**. The AID is the only identity that survives a reread (`docs/deep-link.md`, `nav_history.js`).

When the article has no AID (very old articles): `Q`'s info box has already dropped us back to the list, and that `FULLUPDATE` itself reloaded
the list, so closing the box plus ⏎ reopens the article under the cursor (`reopenAfterPostInfo`), with the notice 「依列表位置重開」 ("reopened by list position") saying so.

**When article-list easy reading or board-list smooth scrolling is in control**: refreshing either list is a frozen transaction that **resumes on landing** (`resumeOnLanding`,
`docs/easy-reading-list.md` "Resume on landing"). The last step is sent from a prompt (CompleteBoard or the keyword prompt),
and the frame of the redrawn list goes straight back to easy reading, without switching to native (the prompt is not drawn for the reader) and without waiting for the idle probe. The `s<this board>⏎` step enters a board,
so its budget is `aid_navigation.SLOW_STEP_BUDGET` (as the board entry of an AID jump).

### Reading position

- Easy reading: when the article had been read to its end (`easyReadingReachedPageEnd` and scrolled within 2 rows of the bottom), `requestScrollToBottom()`
  (stick to the end, so the new comments are right in view); otherwise `requestScrollRestore(lineIndex)` returns to the same row.
- Native pmore: with the status bar at 100%, the reopen is followed by a native End; otherwise it stays on the first page (pmore has no reliable "jump to line N" entry).
- When the easy-reading pref is on but the reader has switched to native at that moment, the reopen returns to easy reading (the same `ensureEnabledOnArticle` as an AID jump).

## Which screens it takes over (`refreshTargetFromFacts`; unrecognised means it does not)

- Article: the pager status bar plus footer prove READING (`parsePagerFooterContext`; when a very long article squeezes out the footer,
  an article that article-list easy reading opened itself counts) plus a known board. **Mail and the digest area are not taken over** (`more.c` blocks `s` and `#` by currstat).
- Article list: not an input field, and an ASCII board name readable on the title row; a caption of 「系列文章」 (search results, MODE_SELECT) or
  「文摘列表」 (digest list) means it is not taken over (`s` would leave that mode). **Known limitation**: old versions always show the caption 「文章選讀」, which cannot be told apart from
  search results, so refreshing such a screen returns to the full list.
- Board list: the screens `classifyBoardListScreen` recognises. The popular-boards screen and category sub-level screens are identical and cannot be told apart, and `/` on
  popular boards is refused by a vmsg, so the second step's ⏎ happens to close the message, with the notice 「熱門看板不支援重新整理」 ("popular boards do not support refresh").
- Home dashboard: `home_dashboard`'s `state.visible` (it recognises the main menu itself). It is checked first; while favorites are being fetched, a screen on the favorites list also counts as the home dashboard, so sending is blocked by the busy notice.
- Anything else (the native main menu once the panel is collapsed, the mailbox list, an open prompt, the editor…): not taken over. F5 goes back to the browser (while connected, beforeunload asks first),
  and the toolbar does not show 「重整」.
- A list, home dashboard or article shown first from its live layer on Back, before PTT has caught up (`NavigationStack.refreshesRevealed`, [#124](https://github.com/NoReasonKen/PttChrome/issues/124)):
  `target()` returns `{ kind: 'revealed' }`, and all three entry points work as usual (the handoff's modal gate does not block pulling down, and F5 is caught first by `term_view`'s
  keydown). This refresh is recorded as the handoff's pending action (`refreshWhenReady`, replacing any click or menu action remembered before), with the progress bar showing;
  once the real screen takes over, `refresh()` runs again (cooldown and busy checks as usual), and a real list is not aligned to the layer's reading position but stays where PTT is (an article keeps the layer's position).
  When the handoff times out, the action is dropped with the notice 「PTT 尚未就緒，操作未執行」 ("PTT is not ready; the action was not run").
- A list held after a failed check ([#158](https://github.com/NoReasonKen/PttChrome/issues/158), `docs/easy-reading-list.md` N8): `target()` returns `{ kind: 'list-retry' }` before
  reading the screen, and the session's `retry()` repaints PTT's screen (`\f`) and presents the list again from it; a retry that times out fails again with 「重新整理逾時」.
- Once a list refresh (article list or board list) is sent, it spends that list's live layer (`NavigationStack.spend('refresh', list)`,
  [#125](https://github.com/NoReasonKen/PttChrome/issues/125)): actions remembered during the handoff are void, the rows kept for that list (#120, #122) are released,
  and every row afterwards is PTT's current data. A refresh during a handoff takes the pending-action path above, and only the `refresh()` after the real screen takes over spends the layer.
  The home dashboard shares its state with its layer, so it does not count as spending it.

## Keyboard (F5 interception)

- Taken over: `F5`, `⌘R` (`isRefreshKeyEvent`). An easy-reading behaviour: taken over whenever easy reading is on.
- Deliberately not taken: `Shift/Ctrl+F5`, `⌘⇧R` (hard reload, left to the browser as an escape hatch); `Ctrl+R` has always been PTT's `^R`
  (reply to a waterball), which never reloads the web page anyway.
- **The page cannot intercept the refresh button beside the browser's address bar** (the Web platform has no API for it; only beforeunload can "ask").
- During the cooldown or while the line is busy, F5 is **still swallowed**, with a notice: the reader wants this screen refreshed, and it must not turn into a full page reload, which disconnects.

## Rate limit

The open-source pttbbs has no read-rate limit per article or per board (2026-10-13 master; searching the Big5 text for 「太快」, 「頻繁」, 「稍後再」,
「冷卻」 and similar words ("too fast", "frequent", "try later", "cooldown") only hits the chat room being tidied, registration error counts, the angel guild and system overload; the reading paths
`more.c`/`pmore.c`/`read.c`/`board.c` keep no read counts either). PTT's
private anti-abuse layer (`docs/pttbbs-screen-protocol.md` §11.2) is not in the open source and its behaviour is unknown, so a conservative cooldown applies:
pref `refreshMinIntervalSec` (5 seconds by default, 0 = no limit), counted only from a refresh **actually sent** (refused or unsupported ones do not count).

## Mobile

- The toolbar's 「重整」 ("refresh") and 「到底」 ("to bottom", End): `refresh`/`end` from `mobile_toolbar.toolbarContextFromFacts`, fixed in slots 3 and 4
  (`toolbarSlots`), greyed out rather than hidden when unavailable. During the refresh cooldown the button is greyed out with a seconds countdown (`ScreenRefresh.cooldownLeftMs`/`onCooldown`,
  whether the cooldown came from the toolbar, F5 or a pull). Share moved into 「更多」 ("More").
- **Pull-to-refresh** (`pull_refresh.js`): starts only on `core.mobile`, outside selection mode, with no modal, on a screen that can be refreshed, and when the scroll
  viewport under the touch point is already at the top; it listens passively and never calls `preventDefault`; offset damping 0.5, threshold 64px, maximum 96px; it takes effect on release,
  and pulling back or turning horizontal cancels it.
- **This is an exception to the "never simulate native system behaviour" principle (`docs/mouse.md` 「手勢與瀏覽器返回」, "Gestures and browser Back")**, justified point by point against that rule:
  1. There is no entry point to hook into: Chrome's pull-to-refresh can only reload the whole page, which disconnects and logs in again; the page learns nothing of "the user pulled",
     and cannot replace the result;
  2. Touch events have full phases (start/move/end), so "takes effect on release / pulling back cancels" can be done correctly; this is not input like WheelEvent, which lacks a phase;
  3. Android has no system setting for turning pull-to-refresh off that this could violate.
  The native one must be turned off, or both would run: in the mobile layout, `main.css` gives `html`/`body` **`overscroll-behavior-y: contain`**
  (y axis only; back navigation on the x axis still goes through, guarded by `native_gesture_css.test.js` plus `pull_refresh.test.js`).

## How the Live article helper watches for new comments (for comparison)

`App.incrementCountToUpdatePushthread`: counts each second, and once the configured number of seconds is reached with `pageState` at 2 or 3, it sends a bare
`←→End` (`\x1b[D\x1b[C\x1b[4~`): leave the article, reopen the one under the cursor, jump to the end. Turning it on first turns off easy reading
(`exitEasyReading`), and any key turns it off (`cancelsLiveHelper`). It verifies nothing: it carries every wrong-article risk from the "why not ←→" paragraph
above, and has no rate protection (1 second minimum). This feature leaves it unchanged.

## Guards

- Unit: `screen_refresh.test.js` (criteria, keys, cooldown, sent sequences, busy), `aid_navigation.test.js` "refresh"
  (sequence, free path, mail not taken over, position restore, no-AID fallback, failure messages), `mobile_toolbar.test.js(x)`, `pull_refresh.test.js`.
- Offline e2e: `screen_refresh.offline.spec.js` (real F5: default action blocked, cooldown notice, handed back with the pref off),
  `mobile_refresh.offline.spec.js` (toolbar button, CDP touch pull-down), `mobile_toolbar.offline.spec.js` (Share inside More),
  `home_dashboard.offline.spec.js` "F5", `mobile_home_dashboard.offline.spec.js` (pull-down and toolbar refresh on the home dashboard),
  `mobile_stack_layer_actions.offline.spec.js` (toolbar, F5 and pull-to-refresh on a revealed list before PTT catches up),
  `mobile_list_failures.offline.spec.js` (toolbar and pull-to-refresh retrying a failed article list or board list).
