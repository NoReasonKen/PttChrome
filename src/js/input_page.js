// The page over easy reading that takes the keys and the typed text now, or
// null: the user query page (#199, user_query.js) or a page of PTT's own
// screen (screen_page.js: the board entry screen, #292; an article's
// animation, #300). Each answers ownsInput(), takeKey(e, synthetic) and
// refuseText(text, what). The terminal's input entrances (term_view) and the
// soft keyboard button (App.toggleSoftKeyboard) ask here.
export function inputPage(core) {
  if (!core) return null;
  for (const page of [core.userQuery, ...screenPages(core)]) {
    if (page && page.ownsInput()) return page;
  }
  return null;
}

// The pages of PTT's own screen on the core, one per kind (screen_page.js).
// Those that ask them all (term_view, the toolbar, the list session, the
// serialized-operation gate) go through here.
const SCREEN_PAGES = ['boardNotes', 'articleMovie'];

export function screenPages(core) {
  return core ? SCREEN_PAGES.map((name) => core[name]).filter(Boolean) : [];
}

// Whether a page of PTT's own screen holds what is under it now: term_view
// draws none of PTT's frames, and the list does not take them for its own.
export function screenPageHolding(core) {
  return screenPages(core).some((p) => p.holding);
}
