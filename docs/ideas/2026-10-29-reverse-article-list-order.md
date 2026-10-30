# Reverse Article List Order

- Date: 2026-10-29 (Asia/Taipei)
- Status: Researched 2026-10-30 (code reading only), not implemented

## Problem

The article list currently shows the newest articles at the bottom and older ones above, following PTT's native order.

## Desired behavior

Add a preference that reverses the article list so the order is flipped (newest at the top). The preference is on by default.

## Open questions

- Which lists does it cover: only the easy-reading article list, or the native list as well?
- How do positioning, scrolling to the newest article, paging and pinned (置底) articles behave in the reversed order?

## Research (2026-10-30)

Code reading only: no prototype yet.

- **Only the easy-reading article list can be reversed.** PTT draws the native list, so its order cannot change.
- **The largest of the current ideas.** The easy-reading list (`src/js/list_session.js`, about 4,800 lines) assumes newest-at-the-bottom throughout:
  - entering a board positions at the bottom;
  - scrolling up prefetches older articles and compensates the scroll position;
  - the selection and the ↑/↓ keys;
  - pull-to-refresh;
  - where the pinned (置底) articles sit.
- **Suggested next step:** write a spec, or build a prototype for the owner to try the feel, before committing to an implementation.
