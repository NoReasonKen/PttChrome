# Article Header With Author and Time

- Date: 2026-10-29 (Asia/Taipei)
- Status: Researched 2026-10-30 (code reading only), not implemented

## Problem

The article header currently shows only the title and the board. The author and the post time are only visible in the article body's own 作者/標題/時間 header rows.

## Desired behavior

Show the author and the time in the article header as well.

## Open questions

- Once the header carries this information, can the easy-reading body drop its 作者/標題/時間 rows? Research whether that is feasible: the app currently uses those rows to identify the article on screen (`src/js/easy_reading.js`, article identity).
- How should a long author field (ID plus nickname) and the time fit in the header, especially on a phone?

## Research (2026-10-30)

Code reading only: no test run and no device check.

- **Feasible and smaller than expected.** The author is already parsed: `term_view.js` keeps `_articleAuthor` next to the title (from the first page). The time needs one more header row parsed the same way.
- **Article identity is not at risk.** `easy_reading.js#_readArticleKey` reads the terminal buffer, not the DOM. Hiding the 作者/標題/時間 rows in the easy-reading view, without removing them from the data, leaves identification as is.
- **What needs checking** is everything that assumes the body's first rows are on screen: scroll position restore, the read-history scroll offset, search jumps, long-comment anchors and copying the whole article.
- **Suggested order:**
  1. Add the author and the time to the header (low risk).
  2. Then try hiding the header rows in the body, possibly behind a preference.
