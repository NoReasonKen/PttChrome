# Article rotation and terminal resizing

Mobile rotation changes both the local reading viewport and the terminal size
negotiated with PTT. Columns remain fixed at 80; rows continue to follow the
available height and mobile font preference.

PTT's NAWS handler repaints its stored terminal screen without asking the article
reader to relocate its footer. The new bottom row can therefore be blank or
contain article text. Treating that screen as a departure discards the accumulated
easy-reading article.

## Ownership

`ArticleResize` coordinates mobile board-article easy-reading size changes.
`App.setTermSize` delegates eligible changes; `_setTermSizeNow` performs the actual
buffer/NAWS write. Other surfaces keep their existing behavior.

- Pending sizes are coalesced. An existing automatic PageDown must arrive and be
  accumulated before resizing. Other command owners, native input prompts and
  reverse reading finish before this operation acquires the wire.
- The `article-resize` owner applies the new dimensions, returns to a verified
  same-board list, reopens its selected article and checks its author/title/time
  header against the retained first page. Only then does it seek to the known
  accumulation frontier. An unexpected article fails visibly without seeking.
- Reopening is necessary: `pmore` initializes its last-page boundary at attachment
  and can retain that old boundary after NAWS. A goto alone can be clamped before
  the end of a resized article. The verified public source documents
  [attachment](https://github.com/ptt/pttbbs/blob/975b27130ab3d35ac04a3fc168f3d909f8ed53a3/mbbsd/pmore.c#L941-L960)
  and [forward clamping](https://github.com/ptt/pttbbs/blob/975b27130ab3d35ac04a3fc168f3d909f8ed53a3/mbbsd/pmore.c#L1140-L1157).
- Each phase uses CommandQueue. Automatic paging is paused, and list sessions,
  search-return observation and reconnect checkpoints ignore these owned
  intermediate screens. The rendered article and existing return history remain
  in place; this is not a user-requested departure or a new search.
- `easyReadingResizeInFlight` preserves article rendering through the stale
  screen and goto prompt. Completion requires written-row coverage for the new
  size, a valid footer covering the requested line, and the cursor at the new
  bottom-right corner. Coverage survives split response windows; an unchanged
  short-article status signature is allowed.
- A sent operation uses the existing input guard and a six-second total deadline
  measured with a monotonic clock. Failure or cancellation releases its protection and bookmark. There
  is no polling or unbounded retry loop. Timeout exposes the current terminal
  screen with a visible explanation.

## Position and controls

Reading-record bookmarks use an article row and within-row proportion, not the
old scroll distance. Completion restores the bookmark through the existing
renderer-aware path, including lazy image height changes. During a resize,
reading-record consumers use that bookmark instead of interpreting a temporary
footer mismatch as an absent article.

`ArticleResizeAnchor` remembers the last stable reading position before the
viewport changes. Capturing only after the resize debounce would measure an
already reflowed image or paragraph. Real reader input cancels restoration from
the moment the bookmark is captured, including while the wire is still busy.
A viewport change that leaves terminal rows unchanged restores locally without
reopening the article.

The local article viewport fits the available area while terminal resizing waits.
An open shortcut drawer retains its state and adapts its geometry; a viewport
change cancels an active drag. Temporary terminal classification changes do not
remove the article's controls or dismiss an open drawer.

## Verification

- `app_mobile_rotation.test.js`: both row-count transitions through the real
  buffer/parser and easy-reading teardown path.
- `article_resize.test.js`: ownership, response recognition, coalescing, split
  output, deadlines, article identity and cancellation.
- `article_resize_anchor.test.js`: pre-layout snapshots and restoration ownership.
- `mobile_article_rotation.offline.spec.js`: actual NAWS/goto writes answered
  with stored-screen and article-level repaints, using the complete renderer,
  reading anchors, images, and shortcut drawer.

Automated checks do not establish installed-Android rotation acceptance. Verify
portrait/landscape transitions, an open drawer and an interrupted drawer drag on
the installed app before resolving the issue.
