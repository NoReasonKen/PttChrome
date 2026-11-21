import { findPageOverlap, rowToText } from './comment_parse';

// Saved pages are ordered by rendered offset, which is independent of PTT's file lines.
export function nearbyPageRange(pages, anchor) {
  if (!Array.isArray(pages) || !Number.isInteger(anchor) || anchor < 0) return null;
  let index = -1;
  for (let i = 0; i < pages.length; ++i) {
    if (pages[i].offset > anchor) break;
    index = i;
  }
  if (index < 0) return null;
  const first = pages[Math.max(0, index - 2)];
  const last = pages[Math.min(pages.length - 1, index + 2)];
  return { start: first.start, end: last.end, offset: first.offset };
}

const text = (row) => rowToText(row).replace(/\s+$/, '');
const unpaddedLength = rows => {
  let end = rows.length;
  while (end && rows[end - 1] === '') --end;
  return end;
};

function frameOverlap(previous, current) {
  if (current.start < previous.start || current.end <= previous.end ||
      current.start > previous.end + 1) return null;
  const fileLines = Math.max(0, previous.end - current.start + 1);
  const physicalRows = Math.min(previous.texts.length, current.texts.length);
  if (fileLines > physicalRows) return null;
  // One physical row per file line makes this alignment independent of the
  // text, including repeated or all-blank rows at the overlap.
  if (previous.texts.length === previous.end - previous.start + 1 &&
      current.texts.length === current.end - current.start + 1) return fileLines;
  if (!fileLines) return 0;
  // A wrapped overlap can contain several physical rows per file line.
  // Without a line-by-line map, only use the ordinary one-to-one case
  // corroborated by the observed rows.
  return findPageOverlap(previous.texts, current.texts) === fileLines ? fileLines : null;
}

// A comparison starts at a known rendered offset. Each append takes one confirmed
// forward frame: {start, end, rows, atEnd}. Results are 'match' (more frames
// may follow), 'mismatch' (a difference is proven), or 'uncertain' (alignment
// cannot be proved). A caller must stop on either non-match result. The shown
// rows are immutable. Extra rows are collected separately until the caller
// finishes comparing the kept content and can decide what to show.
export class ArticleComparisonRows {
  constructor(shownRows, offset = 0, { whole = false } = {}) {
    this.shown = shownRows;
    this.shownEnd = shownRows.length;
    if (whole) {
      while (this.shownEnd && text(shownRows[this.shownEnd - 1]) === '') --this.shownEnd;
    }
    this.offset = offset;
    this.previous = null;
    this.result = 'match';
    this.extra = [];
  }

  append({ start, end, rows, atEnd }) {
    if (this.result !== 'match') return this.result;
    if (!Number.isInteger(this.offset) || this.offset < 0 ||
        !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start ||
        !Array.isArray(rows) || !rows.length || (this.previous && this.previous.atEnd))
      return (this.result = 'uncertain');
    const texts = rows.map(text);
    const endOffset = atEnd ? Math.max(end - start + 1, unpaddedLength(texts)) : texts.length;
    if (endOffset > texts.length) return (this.result = 'uncertain');
    const current = { start, end, texts: texts.slice(0, endOffset), atEnd };
    const overlap = this.previous ? frameOverlap(this.previous, current) : 0;
    if (overlap == null) return (this.result = 'uncertain');
    if (overlap && this.previous.texts.slice(-overlap).some((line, i) => line !== texts[i]))
      return (this.result = 'uncertain');
    for (let i = overlap; i < endOffset; ++i) {
      const pos = this.offset + i - overlap;
      if (pos < this.shownEnd && text(this.shown[pos]) !== texts[i])
        return (this.result = 'mismatch');
      if (pos >= this.shownEnd) this.extra.push(rows[i]);
    }
    this.offset += endOffset - overlap;
    this.previous = current;
    if (atEnd && this.offset < this.shownEnd) return (this.result = 'mismatch');
    return this.result;
  }
}

// A verified stream first visits the kept rows around the reading position,
// then finishes the tail and comes back for the prefix. The caller holds wire
// ownership and can wait between any two steps. No step sends keys by itself.
export class ArticleComparison {
  constructor(shownRows, range, whole) {
    this.shownRows = shownRows;
    this.range = range;
    this.whole = whole;
    this.phase = 'near';
    this.rows = new ArticleComparisonRows(shownRows, range.offset, { whole });
    this.next = { seek: range.start };
    this.outcome = null;
    this.extra = [];
  }

  get nearReady() {
    return this.phase !== 'near';
  }

  accept(frame) {
    const step = this.next;
    if (!step) return;
    if (step.seek != null && frame.start !== step.seek) {
      // PTT clamps an out-of-range seek to its last page. If even that
      // page ends before a saved start, some saved content was removed.
      this.finish(frame.atEnd && frame.end < step.seek ? 'mismatch' : 'uncertain');
      return;
    }

    const result = this.rows.append(frame);
    if (result !== 'match') {
      this.finish(result);
      return;
    }
    if (this.phase === 'head') {
      if (frame.end >= this.range.start) this.finish('match');
      else this.next = { forward: true };
      return;
    }
    if (this.phase === 'near' && frame.end >= this.range.end) this.phase = 'tail';
    if (!frame.atEnd) {
      this.next = { forward: true };
      return;
    }
    this.extra = this.rows.extra.slice(0, unpaddedLength(this.rows.extra.map(text)));
    if (this.range.start === 1) {
      this.finish('match');
      return;
    }
    this.phase = 'head';
    this.rows = new ArticleComparisonRows(this.shownRows, 0, { whole: this.whole });
    this.next = { seek: 1 };
  }

  finish(outcome) {
    this.next = null;
    this.phase = 'finished';
    this.outcome = outcome;
    if (outcome !== 'match') this.extra = [];
  }
}
