# Article Header With Author and Time

- Date: 2026-10-29 (Asia/Taipei)
- Status: Idea, needs research

## Problem

The article header currently shows only the title and the board. The author and the post time are only visible in the article body's own 作者/標題/時間 header rows.

## Desired behavior

Show the author and the time in the article header as well.

## Open questions

- Once the header carries this information, can the easy-reading body drop its 作者/標題/時間 rows? Research whether that is feasible: the app currently uses those rows to identify the article on screen (`src/js/easy_reading.js`, article identity).
- How should a long author field (ID plus nickname) and the time fit in the header, especially on a phone?
