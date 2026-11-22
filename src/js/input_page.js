// The page over the easy-reading list that takes the keys and the typed text
// now, or null: the user query page (#199, user_query.js) or the board entry
// screen page (#292, board_notes.js). Each answers ownsInput(), takeKey(e,
// synthetic) and refuseText(text, what). The terminal's input entrances
// (term_view) and the soft keyboard button (App.toggleSoftKeyboard) ask here.
export function inputPage(core) {
  if (!core) return null;
  for (const page of [core.userQuery, core.boardNotes]) {
    if (page && page.ownsInput()) return page;
  }
  return null;
}
