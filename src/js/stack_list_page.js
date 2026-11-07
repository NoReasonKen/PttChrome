// The page a list's live layer keeps (#127, #140): the frame the reader left,
// what the list session knew of it, and the articles read above it since.
// The layer renders it; the real list takes it over again on Back
// (list_session.js#_resumeFromLayer). It is the one copy of that page.
import { hasServerCursorMark, rowToText, parseListArticleNumLoose, readListRow, subjectOfListRow } from './comment_parse';
import { listEntryOf } from './split_reader';
import { subjectKey, subjectMatches } from './long_push_anchor';

// The row of an article list frame's `lines` that lists `article` ({ author,
// title }; the list may cut the title short), or -1. Several rows can list the
// same author and subject, as in that author's search results; PTT then moved
// its selection from the row `from` to the nearest of them above it (`up`) or
// below it, or to the topmost one above it for the first article of the
// thread (`first`). Without a direction, only a single row other than `from`
// names it. Entries run from `bodyStart` to the footer.
export function articleRow(lines, bodyStart, article, { from = -1, up = null, first = false } = {}) {
  const author = String(article.author || '').toLowerCase();
  const subject = subjectKey(article.title);
  if (!author || !subject) return -1;
  const hits = [];
  for (let row = bodyStart; row < lines.length - 1; row++) {
    const entry = listEntryOf(rowToText(lines[row]));
    if (entry && !entry.deleted && entry.subject && String(entry.author).toLowerCase() === author &&
        subjectMatches(entry.subject, subject)) hits.push(row);
  }
  if (up != null) {
    const side = hits.filter(row => (up ? row < from : row > from));
    return side.length ? side[up && !first ? side.length - 1 : 0] : -1;
  }
  const others = hits.filter(row => row !== from);
  if (others.length === 1) return others[0];
  return hits.length === 1 ? hits[0] : -1;
}

// A header's post date ("Mon Sep  1 12:00:00 2025") as a list shows it
// ("9/01"), or null.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function listDate(time) {
  const m = /([A-Z][a-z]{2}) +(\d{1,2}) \d\d:\d\d:\d\d \d{4}/.exec(time || '');
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  return month ? `${month}/${m[2].padStart(2, '0')}` : null;
}

// The rows of a list frame's `lines` that may list `article` ({ author,
// title, time }) by what the article itself says, with no selection to go by:
// its author and subject, then whether it is a reply and its post date, as
// far as those tell the rows apart. One row is the article; several are
// rows it cannot be told from.
export function identityRows(lines, bodyStart, article) {
  const author = String(article.author || '').toLowerCase();
  const subject = subjectKey(article.title);
  if (!author || !subject) return [];
  let hits = [];
  for (let row = bodyStart; row < lines.length - 1; row++) {
    const entry = listEntryOf(rowToText(lines[row]));
    if (entry && !entry.deleted && entry.subject && String(entry.author).toLowerCase() === author &&
        subjectMatches(entry.subject, subject)) hits.push({ row, entry });
  }
  const reply = /^Re:/i.test(String(article.title || '').trim());
  const date = listDate(article.time);
  for (const keep of [hit => /^R:/.test(hit.entry.title) === reply, hit => hit.entry.date === date]) {
    if (hits.length < 2) break;
    const narrowed = hits.filter(keep);
    if (narrowed.length) hits = narrowed;
  }
  return hits.map(hit => hit.row);
}

export class KeptListPage {
  // `frame`: the list's last presented frame. `session`: the list session's
  // own page (list_session.js#listPage: its rows and what it knows of them),
  // or null for a list whose session keeps none, such as the board list.
  constructor(frame, session = null) {
    this.frame = frame;
    this.session = session;
    this.read = new Set();
    this.unsure = new Set();
    this.lastRead = null;
    this.followed = null;
  }

  get bodyStart() {
    return this.frame.enhance.listScroll.bodyStart;
  }

  // The page lists search results, not the board's full list.
  get selectMode() {
    return !!this.session?.selectMode;
  }

  // The search that found these results, or null.
  get search() {
    return this.session?.search || null;
  }

  // The frame row this page shows selected, or -1.
  selectedRow() {
    const lines = this.frame.lines;
    return lines.findIndex((line, r) => r >= this.bodyStart && r < lines.length - 1 && hasServerCursorMark(line, 0));
  }

  // The text of the entry this page shows selected, or null.
  selectedText() {
    const row = this.selectedRow();
    return row < 0 ? null : rowToText(this.frame.lines[row]);
  }

  // Follow PTT's selection to `article` (StackListLayer.follow). Returns the
  // row read, or -1 when the page does not hold it.
  follow(article, up, first) {
    const from = this.followed ?? this.selectedRow();
    const row = articleRow(this.frame.lines, this.bodyStart, article, { from, up, first });
    if (row < 0) return -1;
    this.followed = row;
    this.markRead(row, article);
    return row;
  }

  // `article` was read with PTT's selection no longer followed
  // (StackListLayer.noteRead). Returns whether a row now shows read.
  noteRead(article) {
    const rows = identityRows(this.frame.lines, this.bodyStart, article);
    if (rows.length === 1) return this.markRead(rows[0], article);
    rows.forEach(row => this.unsure.add(row));
    this.lastRead = { row: rows[0] ?? -1, title: article.title };
    return false;
  }

  // Show `row` read as PTT lists it once read, and remember it as the last
  // article read, `article` when known. Returns whether the row changed.
  markRead(row, article) {
    this.read.add(row);
    this.unsure.delete(row);
    this.lastRead = { row, title: article?.title ?? null };
    const read = readListRow(this.frame.lines[row]);
    if (!read) return false;
    const lines = this.frame.lines.slice();
    lines[row] = read;
    // The frame was the real screen's; it is replaced, never changed.
    this.frame = { ...this.frame, lines };
    return true;
  }

  // The subject PTT colours as last read (bbs.c currtitle), as this page
  // keys it: the subject of the last article read, or null when none was.
  lastReadSubject() {
    const last = this.lastRead;
    if (!last) return null;
    if (last.row >= 0) return subjectOfListRow(this.frame.lines[last.row]);
    return subjectKey(last.title);
  }

  // The newest article number this page shows, or null.
  newestNum() {
    const lines = this.frame.lines;
    let newest = null;
    for (let r = this.bodyStart; r < lines.length - 1; r++) {
      const num = parseListArticleNumLoose(rowToText(lines[r]));
      if (num != null && (newest == null || num > newest)) newest = num;
    }
    return newest;
  }

  // The rows (TermChar[]) of the articles read since the list was left, each
  // as this page now shows it: the one it shows selected, and each that PTT's
  // selection followed or that was found by its identity.
  readRows() {
    const rows = [this.selectedRow(), ...this.read].filter(row => row >= 0);
    return [...new Set(rows)].map(row => this.frame.lines[row]);
  }

  // The rows (TermChar[]) an article read may be, which none tells apart.
  unsureRows() {
    return [...this.unsure].map(row => this.frame.lines[row]);
  }
}
