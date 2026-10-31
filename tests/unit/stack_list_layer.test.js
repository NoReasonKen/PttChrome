import { articleRow } from '../../src/js/stack_list_layer';

// An article list frame as the list layer keeps it: three header rows, the
// entries (bbs.c readdoent columns) and the footer.
const row = text => [...text].map(ch => ({ ch, isLeadByte: false }));
const entry = (num, author, title) =>
  row(`${String(num).padStart(7)} +  11/20 ${author.padEnd(13)}${title.startsWith('Re: ') ? 'R: ' + title.slice(4) : '□ ' + title}`);
const frame = entries => [row('header'), row('keys'), row('columns'), ...entries, row(' 文章選讀 ')];
const BODY = 3;

test('the row that lists the article by its author and title', () => {
  const lines = frame([entry(1101, 'alice', '[Talk] Far topic'), entry(1102, 'filler', '[Talk] Filler'), entry(1110, 'bob', 'Re: [Talk] Far topic')]);
  expect(articleRow(lines, BODY, { author: 'bob', title: 'Re: [Talk] Far topic' })).toBe(BODY + 2);
  expect(articleRow(lines, BODY, { author: 'Alice', title: '[Talk] Far topic' })).toBe(BODY);
});

test('a title the list cuts short still names its article', () => {
  const lines = frame([entry(7, 'carol', '[Talk] A very long title cut …')]);
  expect(articleRow(lines, BODY, { author: 'carol', title: '[Talk] A very long title cut short by the list' })).toBe(BODY);
});

test('no row when the list lacks the article, or when two rows might be it', () => {
  const lines = frame([entry(1, 'dave', 'Re: [Talk] Far topic'), entry(2, 'dave', 'Re: [Talk] Far topic')]);
  expect(articleRow(lines, BODY, { author: 'erin', title: 'Re: [Talk] Far topic' })).toBe(-1);
  expect(articleRow(lines, BODY, { author: 'dave', title: 'Re: [Talk] Far topic' })).toBe(-1);
});

// An author's search results: three replies of his to one thread.
const DAVE = { author: 'dave', title: 'Re: [Talk] Far topic' };
const replies = frame([entry(1, 'dave', 'Re: [Talk] Far topic'), entry(2, 'dave', 'Re: [Talk] Far topic'),
  entry(3, 'dave', 'Re: [Talk] Far topic'), entry(4, 'dave', '[Talk] Other topic')]);

test('of two rows naming the article, the one the selection moved to', () => {
  const pair = frame([entry(1, 'dave', 'Re: [Talk] Far topic'), entry(2, 'dave', 'Re: [Talk] Far topic')]);
  expect(articleRow(pair, BODY, DAVE, { from: BODY + 1 })).toBe(BODY);
  expect(articleRow(pair, BODY, DAVE, { from: BODY })).toBe(BODY + 1);
});

test('among rows naming the article, the nearest in the direction the selection moved', () => {
  expect(articleRow(replies, BODY, DAVE, { from: BODY + 2, up: true })).toBe(BODY + 1);
  expect(articleRow(replies, BODY, DAVE, { from: BODY, up: false })).toBe(BODY + 1);
  expect(articleRow(replies, BODY, DAVE, { from: BODY, up: true })).toBe(-1);
});

test('the topmost row above for the first article of the thread', () => {
  expect(articleRow(replies, BODY, DAVE, { from: BODY + 2, up: true, first: true })).toBe(BODY);
});
