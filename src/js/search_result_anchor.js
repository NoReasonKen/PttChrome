import {
  parseListAuthor,
  parseListTitle,
  parseListDate,
  pageArticleNums,
  rowToText
} from './comment_parse';

const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validNum = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

function normalizedDate(value) {
  if (typeof value !== 'string' || !/^\d{1,2}\/\d{2}$/.test(value)) return null;
  const [month, day] = value.split('/').map(Number);
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    ? month + '/' + String(day).padStart(2, '0') : null;
}

function identity(value) {
  if (!isObject(value) || typeof value.author !== 'string' ||
      !/^[0-9A-Za-z]{1,12}$/.test(value.author) || typeof value.title !== 'string' ||
      !value.title.trim() || value.title.length > 200 || CONTROL.test(value.title)) return null;
  const date = normalizedDate(value.date);
  return date ? { author: value.author.toLowerCase(), title: value.title.trim().toLowerCase(), date } : null;
}

// This is a visible-list identity, not an AID: truncated titles can collide.
// Mutable score/read-marker columns deliberately do not participate.
export function searchResultIdentity(text) {
  if (typeof text !== 'string') return null;
  return identity({ author: parseListAuthor(text), title: parseListTitle(text), date: parseListDate(text) });
}

export function validateSearchResultAnchor(value) {
  // ListSession stores the clipped portion of the top row in CSS pixels.
  if (!isObject(value) || !validNum(value.num) ||
      !Number.isFinite(value.scrollFrac) || value.scrollFrac < 0 || value.scrollFrac > 10000) return null;
  const key = identity(value);
  return key ? { num: value.num, ...key, scrollFrac: value.scrollFrac } : null;
}

export function matchesSearchResultAnchor(text, anchor) {
  const actual = searchResultIdentity(text);
  const wanted = identity(anchor);
  return !!(actual && wanted && actual.author === wanted.author &&
    actual.title === wanted.title && actual.date === wanted.date);
}

// Capture the reader's viewport anchor, not the independently moving PTT
// selection. Native lists have no viewport anchor, so use their cursor instead.
export function captureSearchResultAnchor(buf, record) {
  if (!buf || !record) return null;
  const num = record.topNum ?? (record.native ? record.cursorNum : null);
  if (!validNum(num)) return null;
  const rows = new Map();
  const nums = buf.listLineNums || [];
  const lines = buf.listLines || [];
  for (let i = 0; i < nums.length; i++) {
    if (validNum(nums[i]) && lines[i])
      rows.set(nums[i], typeof lines[i] === 'string' ? lines[i] : rowToText(lines[i]));
  }
  if (typeof buf.getRowText === 'function') {
    const textRows = Array.from({ length: buf.rows || 0 }, (_, row) => buf.getRowText(row, 0, buf.cols));
    const pageNums = pageArticleNums(textRows, buf.cur_y ?? -1);
    for (let row = 3; row < textRows.length - 1; row++) {
      const text = textRows[row];
      const candidate = pageNums[row];
      // Buffered rows have recovered cursor numbers and therefore take priority.
      if (validNum(candidate) && !rows.has(candidate)) rows.set(candidate, text);
    }
  }
  const key = searchResultIdentity(rows.get(num));
  if (!key) return null;
  const matches = [...rows.values()].filter(text => matchesSearchResultAnchor(text, key));
  if (matches.length !== 1) return null;
  return validateSearchResultAnchor({ num, ...key, scrollFrac: record.scrollFrac ?? 0 });
}
