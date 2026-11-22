// Drawing blocks in the phone's easy-reading article (#295, docs/mobile.md
// "Drawing blocks"). The article wraps its rows at the reading size
// (`term_view.reflow`); a drawing (colour art, box and block characters, a
// table laid out in columns) falls apart when its rows wrap. A drawing block
// is drawn instead on PTT's 80-column grid, its rows not wrapped, at a cell
// that fits 80 columns in the page width (`drawingGeometry`). Prose and
// comments keep wrapping.
//
// The rule is pure (rows in, blocks out) and errs towards leaving prose alone:
//   - A row reads as a drawing ("strong") when drawing cells (a cell with a
//     background colour, or a box, block or geometric-shape character) are at
//     least MIN_DRAWING_COLS columns and a quarter of the row's span (its
//     first to its last visible column); or when it is part of a table: at
//     least TABLE_MIN_ROWS consecutive rows whose gaps of two or more spaces
//     line up in two or more places.
//   - A row with any background colour or box/block character ("weak"), such
//     as a frame's inner row or a sparse row of colour art, joins a drawing
//     only when it touches a strong row; a run of weak rows alone is not one.
//   - Up to MAX_BLANK_GAP blank rows between two drawings join them (a
//     drawing's own empty rows); a drawing's blank rows at either end are not
//     part of it.
//   - Rows the article draws otherwise (comments, the header, merged rows;
//     the caller's `skip`) end a drawing.
//   - A drawing is drawn small only when one of its rows would wrap at the
//     reading size (is wider than `fitCols` columns); one that fits keeps the
//     reading size. All rows of a block share one cell, so its columns stay
//     aligned.
import { b2u } from './string_util';
import { cellText } from './unicode_cells';
import { gridCellPx } from './mobile_layout';

// PTT's screen width, the grid a drawing is laid out on.
export const DRAWING_COLS = 80;
// Drawing cells a strong row needs at least (a lone bullet ● is not a drawing).
export const MIN_DRAWING_COLS = 4;
// A strong row's drawing cells cover at least 1/DRAWING_SHARE of its span.
export const DRAWING_SHARE = 4;
// Blank rows that may separate two parts of one drawing.
export const MAX_BLANK_GAP = 2;
// Consecutive rows whose space gaps line up before they read as a table.
export const TABLE_MIN_ROWS = 3;

// The reading size and the drawing cell on a page `width` px wide, the reading
// cell being `readingPx` (term_view.chh in the article). `fitCols`: the
// half-width columns a row may have before it wraps at the reading size.
// `cellPx`: the cell 80 columns fit the page at (never above the reading cell,
// whole device pixels; mobile_layout.gridCellPx), as the board entry screen
// page draws PTT's screen (#292).
export function drawingGeometry({ width, readingPx, dpr }) {
  const w = Math.max(0, Number(width) || 0);
  const reading = Number(readingPx) || 0;
  if (!(w > 0 && reading > 0)) return { fitCols: 0, cellPx: 0 };
  return {
    fitCols: Math.floor(w / (reading / 2)),
    cellPx: gridCellPx({ width: w, height: Infinity, rows: 1, dpr, maxPx: reading })
  };
}

// Box drawing and block elements (─│┌┐└┘├┤┬┴┼═║ ▁…█ ▏…▐ ░▒▓): a weak sign alone.
const isBoxOrBlock = code => code >= 0x2500 && code <= 0x259f;
// Those and the geometric shapes (◢◣◤◥ ■□ ▲▼ ◆◇ ○●) count as drawing cells.
const isDrawingGlyph = code => code >= 0x2500 && code <= 0x25ff;
// U+3000 is the full-width space PTT text pads with.
const isSpace = code => code === 0x20 || code === 0x3000 || code === 0;

function bgOf(c) {
  if (c.getColor) return c.getColor().bg;
  return c.bg | 0;
}

// What one row shows: { width, span, drawing, weak, gaps } where
//   width   the columns up to its last visible cell (0: blank),
//   span    the columns from its first to its last visible cell,
//   drawing its drawing cells (columns),
//   weak    any background colour or box/block character,
//   gaps    interior runs of 2+ uncoloured spaces, [start, end) columns.
// A visible cell is not a space, or has a background colour.
export function drawingRowInfo(chars) {
  let first = -1;
  let last = -1;
  let drawing = 0;
  let weak = false;
  const gaps = [];
  let spaceRun = -1;
  const n = chars ? chars.length : 0;
  for (let i = 0; i < n; ) {
    const c = chars[i];
    let code = 0x20;
    let w = 1;
    if (c) {
      if (c.isLeadByte && i + 1 < n) {
        const next = chars[i + 1];
        const pair = c.ch + (next ? next.ch : '');
        const u = pair.length === 1 ? pair : b2u(pair);
        code = u ? u.codePointAt(0) : 0x20;
        w = 2;
      } else {
        const t = cellText(c.ch || ' ');
        code = t.codePointAt(0);
      }
    }
    const glyph = isDrawingGlyph(code);
    const box = isBoxOrBlock(code);
    const blank = isSpace(code);
    for (let k = 0; k < w; ++k) {
      const cell = chars[i + k];
      const bg = cell ? bgOf(cell) : 0;
      const visible = !blank || bg !== 0;
      if (bg !== 0 || glyph) ++drawing;
      if (bg !== 0 || box) weak = true;
      const col = i + k;
      if (visible) {
        if (spaceRun >= 0 && first >= 0 && col - spaceRun >= 2) gaps.push([spaceRun, col]);
        spaceRun = -1;
        if (first < 0) first = col;
        last = col;
      } else if (spaceRun < 0) {
        spaceRun = col;
      }
    }
    i += w;
  }
  return {
    width: last + 1,
    span: first < 0 ? 0 : last - first + 1,
    drawing,
    weak,
    gaps
  };
}

// Row kinds the block rule works on.
const OTHER = 0;
const BLANK = 1;
const WEAK = 2;
const STRONG = 3;

function isStrong(info) {
  return info.drawing >= MIN_DRAWING_COLS && info.drawing * DRAWING_SHARE >= info.span;
}

// Columns inside a row's gaps, as a set of column flags.
function gapMask(info) {
  const mask = new Uint8Array(DRAWING_COLS * 2);
  for (const [s, e] of info.gaps) for (let c = s; c < e && c < mask.length; ++c) mask[c] = 1;
  return mask;
}

function segments(mask) {
  let count = 0;
  for (let c = 0; c < mask.length; ++c) if (mask[c] && !(c > 0 && mask[c - 1])) ++count;
  return count;
}

// Rows of [from, to) that form tables: runs of TABLE_MIN_ROWS or more
// consecutive rows, each with two or more gaps, whose gaps share columns in
// two or more places. Marks them in `table`.
function markTables(gapped, infos, from, to, table) {
  for (let i = from; i < to; ) {
    if (!gapped(i)) {
      ++i;
      continue;
    }
    let shared = gapMask(infos[i]);
    let j = i + 1;
    while (j < to && gapped(j)) {
      const mask = gapMask(infos[j]);
      for (let c = 0; c < mask.length; ++c) mask[c] &= shared[c];
      if (segments(mask) < 2) break;
      shared = mask;
      ++j;
    }
    if (j - i >= TABLE_MIN_ROWS) {
      for (let r = i; r < j; ++r) table[r] = true;
      i = j;
    } else {
      ++i;
    }
  }
}

// The drawing blocks among rows [from, to) of `lines` (TermChar rows).
//   fitCols  columns a row may have before it wraps at the reading size.
//   skip     (row) → true for a row the article draws otherwise; it ends a block.
//   infos    optional cache: a WeakMap from a row to its drawingRowInfo. Only
//            for rows that are never written again (the accumulated page).
// Returns { blocks, open }:
//   blocks  [start, end) row ranges to draw on the 80-column grid;
//   open    the first row whose block can still change when rows are appended
//           after `to` (`to` when none): the annotation frontier.
export function drawingBlocks(lines, fitCols, { from = 0, to = lines.length, skip, infos } = {}) {
  const kinds = new Uint8Array(Math.max(0, to));
  const info = new Array(Math.max(0, to));
  for (let r = from; r < to; ++r) {
    if (skip && skip(r)) {
      kinds[r] = OTHER;
      continue;
    }
    let ri = infos ? infos.get(lines[r]) : undefined;
    if (!ri) {
      ri = drawingRowInfo(lines[r]);
      if (infos && lines[r]) infos.set(lines[r], ri);
    }
    info[r] = ri;
    kinds[r] = ri.width === 0 ? BLANK : isStrong(ri) ? STRONG : ri.weak ? WEAK : OTHER;
  }
  // Skipped rows have no info: they are never part of a table.
  const gapped = r => !!info[r] && info[r].gaps.length >= 2;
  const table = new Array(Math.max(0, to));
  markTables(gapped, info, from, to, table);
  for (let r = from; r < to; ++r) if (table[r]) kinds[r] = STRONG;
  // Gapped rows that are no table yet read as prose; the run of them at the
  // end may become one when the next rows come.
  let openGapped = to;
  while (openGapped > from && gapped(openGapped - 1)) --openGapped;
  const drawn = r => kinds[r] === STRONG || kinds[r] === WEAK;

  // Segments: maximal runs of strong and weak rows; anchored when one is strong.
  const segs = [];
  for (let r = from; r < to; ) {
    if (!drawn(r)) {
      ++r;
      continue;
    }
    const start = r;
    let anchored = false;
    while (r < to && drawn(r)) {
      if (kinds[r] === STRONG) anchored = true;
      ++r;
    }
    segs.push({ start, end: r, anchored });
  }
  // Groups: anchored segments joined across at most MAX_BLANK_GAP blank rows.
  const blocks = [];
  let group = null;
  const close = () => {
    if (!group) return;
    let wide = false;
    for (let r = group.start; r < group.end && !wide; ++r) wide = !!info[r] && info[r].width > fitCols;
    if (wide) blocks.push([group.start, group.end]);
    group = null;
  };
  const onlyBlanks = (a, b) => {
    if (b - a > MAX_BLANK_GAP) return false;
    for (let r = a; r < b; ++r) if (kinds[r] !== BLANK) return false;
    return true;
  };
  for (const s of segs) {
    if (!s.anchored) {
      close();
      continue;
    }
    if (group && onlyBlanks(group.end, s.start)) group.end = s.end;
    else {
      close();
      group = { start: s.start, end: s.end };
    }
  }
  close();

  // The frontier: walking back from `to` over at most MAX_BLANK_GAP blank rows,
  // a drawn row or a gapped row (a table to be) may still grow, and with it
  // every drawing it can join across short blank gaps.
  const maybeDrawn = r => drawn(r) || r >= openGapped;
  let open = to;
  let r = to - 1;
  for (;;) {
    let blanks = 0;
    while (r >= from && kinds[r] === BLANK) {
      --r;
      ++blanks;
    }
    if (blanks > MAX_BLANK_GAP || r < from || !maybeDrawn(r)) break;
    while (r >= from && maybeDrawn(r)) --r;
    open = r + 1;
  }
  return { blocks, open };
}
