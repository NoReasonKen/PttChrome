// Where the board is (#293): reading PTT's 我在哪 screen, the Ctrl-W / Ctrl-Y of
// the article list (mbbsd/bbs.c#whereami). Pure: screen row texts in, plain data
// out.
//
// whereami clears from row 1 (row 0 keeps the list's title) and prints, from the
// board's class tree p[0] = the board, p[i + 1] = its parent, up to the root p[i]:
//   row 1      「我在哪?」
//   row 2      the root:   "%-40.40s %.13s"   description, moderators
//   rows 3..   each level under it, indented by two columns per level:
//              "%*s %-13.13s %-37.37s %.13s"  name, description, moderators
//              (the width is 2 per level, so the name starts at 2 * level + 1)
//              the last one is the board itself
//   b_lines-2  「位置: 」 and the path, "<category> > <name> > <name> ", the
//              category being the root's description up to its first space
//   last row   「請按任意鍵繼續」 (pressanykey)
// The rows hold text, one character per glyph: a full-width glyph is two screen
// cells, so the fields are cut by cells (the printf widths are columns), not by
// characters.

import { charCells } from './string_util';

export const WHEREAMI_TITLE = '我在哪?';
const PATH_LABEL = '位置:';
const PAUSE_TEXT = '請按任意鍵繼續';
// Cells of one field and the space that follows it.
const NAME_CELLS = 13;
const DESC_CELLS = 37;
const ROOT_DESC_CELLS = 40;

// `text` from cell `from` up to (not including) cell `to`; a glyph that starts
// before `to` is kept whole. `to` null = to the end.
function cellSlice(text, from, to) {
  let cell = 0;
  let out = '';
  for (const ch of text) {
    if (cell >= from && (to == null || cell < to)) out += ch;
    cell += charCells(ch);
    if (to != null && cell >= to && cell > from) break;
  }
  return out;
}

// Whether the screen is PTT's 我在哪 (its title on row 1, whatever else).
export function isWhereAmIScreen(rowTexts) {
  return !!rowTexts && String(rowTexts[1] || '').trim() === WHEREAMI_TITLE;
}

// Whether the screen waits on pressanykey (the last row's bar).
export function whereAmIPaused(rowTexts) {
  const rows = rowTexts || [];
  return String(rows[rows.length - 1] || '').indexOf(PAUSE_TEXT) >= 0;
}

// The path row's names, root first: the category word, then each board name.
function pathNames(text) {
  const after = text.slice(text.indexOf(PATH_LABEL) + PATH_LABEL.length);
  return after.split('>').map((s) => s.trim());
}

// The screen as { levels: [{ board, description, moderators }], path, names },
// or null when it is not 我在哪 or a row does not read as PTT prints it.
// `levels` runs from the root (its board is '': PTT does not print the root's
// name, only its description) down to the current board, the last one. `path`
// is the 位置 row as printed; `names` its names. A board that is itself the
// root of its tree has one level.
export function parseWhereAmI(rowTexts) {
  if (!isWhereAmIScreen(rowTexts)) return null;
  const rows = rowTexts.length;
  if (rows < 5) return null;
  let pathRow = -1;
  for (let r = rows - 2; r >= 2 && pathRow < 0; --r)
    if (String(rowTexts[r] || '').trimStart().startsWith(PATH_LABEL)) pathRow = r;
  if (pathRow < 0) return null;
  const levels = [];
  for (let r = 2; r < pathRow; ++r) {
    const text = String(rowTexts[r] || '').replace(/\s+$/, '');
    if (!text.trim()) continue;
    if (!levels.length) {
      levels.push({
        board: '',
        description: cellSlice(text, 0, ROOT_DESC_CELLS).trim(),
        moderators: cellSlice(text, ROOT_DESC_CELLS + 1, null).trim()
      });
      continue;
    }
    const indent = text.length - text.trimStart().length;
    // "%*s " puts two columns per level, and the space before the name.
    if (indent !== 2 * levels.length + 1) return null;
    const board = cellSlice(text, indent, indent + NAME_CELLS).trim();
    if (!board || /\s/.test(board)) return null;
    const descFrom = indent + NAME_CELLS + 1;
    levels.push({
      board,
      description: cellSlice(text, descFrom, descFrom + DESC_CELLS).trim(),
      moderators: cellSlice(text, descFrom + DESC_CELLS + 1, null).trim()
    });
  }
  if (!levels.length || !levels[0].description) return null;
  const path = String(rowTexts[pathRow]).trim();
  const names = pathNames(path);
  // The path names the category, then every level under the root.
  if (names.length !== levels.length || names.some((n) => !n)) return null;
  if (levels.slice(1).some((level, i) => level.board !== names[i + 1])) return null;
  return { levels, path, names };
}
