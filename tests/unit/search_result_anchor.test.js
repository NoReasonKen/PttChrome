import {
  searchResultIdentity,
  validateSearchResultAnchor,
  captureSearchResultAnchor,
  matchesSearchResultAnchor
} from '../../src/js/search_result_anchor';
import { parseListDate } from '../../src/js/comment_parse';

const row = (num, { author = 'Reader', title = 'R: [Talk] Topic', date = '6/14', push = 1, mark = '+' } = {}) =>
  `${String(num).padStart(7)} ${mark}${String(push).padStart(2)}${date.padStart(5)} ${author.padEnd(13)}${title}`;
const cells = text => [...text].map(ch => ({ ch, isLeadByte: false }));
const key = { author: 'reader', title: 'r: [talk] topic', date: '6/14' };
const anchor = { num: 42, ...key, scrollFrac: 12.5 };
const buffer = entries => ({ listLineNums: entries.map(([num]) => num), listLines: entries.map(([, text]) => cells(text)) });

test('extracts author, displayed title, and date without mutable score or read markers', () => {
  expect(searchResultIdentity(row(42))).toEqual(key);
  expect(searchResultIdentity(row(42, { push: 99, mark: 'm' }))).toEqual(key);
  expect(searchResultIdentity('>' + row(42).slice(1))).toEqual(key);
});

test('uses realigned date columns for the legacy full-width cursor', () => {
  const normal = ' 350039 + 1 6/14 JHENGKUNLIN  R: Topic';
  const legacy = '●50039 + 1 6/14 JHENGKUNLIN  R: Topic';
  expect(parseListDate(legacy)).toBe('6/14');
  expect(searchResultIdentity(legacy)).toEqual(searchResultIdentity(normal));
  expect(searchResultIdentity(row(42, { date: '     ', title: 'R: Topic 6/14' }))).toBeNull();
});

test('requires positive content matches including date and title', () => {
  expect(matchesSearchResultAnchor(row(99, { push: 20 }), anchor)).toBe(true);
  expect(matchesSearchResultAnchor(row(42, { date: '6/15' }), anchor)).toBe(false);
  expect(matchesSearchResultAnchor(row(42, { title: 'R: Other' }), anchor)).toBe(false);
  expect(matchesSearchResultAnchor(row(42, { author: 'Other' }), anchor)).toBe(false);
  expect(matchesSearchResultAnchor('', anchor)).toBe(false);
  expect(matchesSearchResultAnchor(row(42), null)).toBe(false);
});

test('captures the viewport top even when the PTT selection is elsewhere', () => {
  const buf = buffer([[42, row(42)], [43, row(43, { title: 'R: Next' })]]);
  expect(captureSearchResultAnchor(buf, { topNum: 42, cursorNum: 43, scrollFrac: 12.5 })).toEqual(anchor);
  expect(captureSearchResultAnchor(buf, { cursorNum: 43, scrollFrac: 0 })).toBeNull();
});

test('uses the native cursor only when there is no viewport anchor', () => {
  const buf = {
    rows: 24, cols: 80,
    getRowText: index => index === 3 ? row(42) : ''
  };
  expect(captureSearchResultAnchor(buf, { native: true, cursorNum: 42 })).toEqual({ ...anchor, scrollFrac: 0 });
});

test('refuses content identities shared by distinct available result numbers', () => {
  const buf = buffer([[42, row(42)], [43, row(43)]]);
  expect(captureSearchResultAnchor(buf, { topNum: 42, scrollFrac: 12.5 })).toBeNull();
});

test('does not treat the same row in the buffer and native frame as a duplicate', () => {
  const buf = buffer([[42, row(42)]]);
  Object.assign(buf, { rows: 24, cols: 80, getRowText: index => index === 3 ? row(42) : '' });
  expect(captureSearchResultAnchor(buf, { topNum: 42, scrollFrac: 12.5 })).toEqual(anchor);
});

test('does not mistake a legacy cursor number suffix for a separate result', () => {
  const buf = buffer([[350039, row(350039)]]);
  Object.assign(buf, {
    rows: 24, cols: 80, cur_y: 3,
    getRowText: index => index === 3 ? '●' + row(350039).slice(2) :
      index === 4 ? row(350040, { title: 'R: Next' }) : ''
  });
  expect(captureSearchResultAnchor(buf, { topNum: 350039, scrollFrac: 12.5 })).toEqual({ ...anchor, num: 350039 });
});

test('returns copied normalized metadata with no extra fields', () => {
  const value = { ...anchor, author: 'READER', title: ' R: [Talk] Topic ', date: '06/14', ignored: 'private' };
  const result = validateSearchResultAnchor(value);
  expect(result).toEqual(anchor);
  result.title = 'mutated';
  expect(value.title).toBe(' R: [Talk] Topic ');
});

test('preserves pixel offsets larger than one CSS pixel', () => {
  expect(validateSearchResultAnchor({ ...anchor, scrollFrac: 37.5 })).toEqual({ ...anchor, scrollFrac: 37.5 });
});

test.each([
  null, [], {}, { ...anchor, num: 0 }, { ...anchor, num: -1 },
  { ...anchor, num: 1.5 }, { ...anchor, num: 2147483648 },
  { ...anchor, scrollFrac: NaN }, { ...anchor, scrollFrac: Infinity },
  { ...anchor, scrollFrac: -0.01 }, { ...anchor, scrollFrac: 10000.01 },
  { ...anchor, author: 'bad_id' }, { ...anchor, author: 'a'.repeat(13) },
  { ...anchor, title: '' }, { ...anchor, title: 'x'.repeat(201) },
  { ...anchor, title: 'bad\ntext' }, { ...anchor, date: '0/01' },
  { ...anchor, date: '13/01' }, { ...anchor, date: '2/30' }
])('rejects invalid or unbounded saved anchor %#', value => {
  expect(validateSearchResultAnchor(value)).toBeNull();
});
