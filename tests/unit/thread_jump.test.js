// Far same-thread jumps from an article (#65): the pure decisions of
// src/js/thread_jump.js.
import { threadJumpKey, threadAnswer, findResultRow, resultsTopNum } from '../../src/js/thread_jump';

const ROWS = 24;
const blank = () => Array.from({ length: ROWS }, () => '');
const source = { author: 'doom109', title: 'Re: [活俠] 日本V或主播直播', time: 'Thu Oct  8 19:29:08 2026' };

function articleFrame({ author = 'doom109', title = source.title, time = source.time } = {}) {
  const rowTexts = blank();
  rowTexts[0] = ` 作者  ${author} (DOOM)                                        看板  C_Chat `;
  rowTexts[1] = ` 標題  ${title}`;
  rowTexts[2] = ` 時間  ${time}`;
  rowTexts[ROWS - 1] = '  瀏覽 第 1/2 頁 ( 40%)  目前顯示: 第 01~23 行                (y)回應(X%)推文(h)說明(←)離開 ';
  return { rowTexts, rows: ROWS, kind: 'article', curX: 79, curY: ROWS - 1 };
}

const row = (num, { author = 'doom109', title = 'R: [活俠] 日本V或主播直播', date = '10/08', mark = ' ', push = '  ' } = {}) =>
  `${String(num).padStart(7)} ${mark}${push}${date.padStart(5)} ${author.padEnd(13)}${title}`;

function listFrame(rows, cursorAt) {
  const rowTexts = blank();
  rowTexts[0] = '【板主:daniel0527】                    系列《C_Chat》';
  rows.forEach((text, i) => {
    rowTexts[3 + i] = i === cursorAt ? '>' + text.slice(1) : text;
  });
  rowTexts[ROWS - 1] = ' 系列文章  選擇看板  ';
  return { rowTexts, rows: ROWS, kind: 'clean-list', curX: 0, curY: 3 + cursorAt };
}

test('the pager keys of a same-thread jump, aliases included', () => {
  expect(threadJumpKey('[')).toBe('[');
  expect(threadJumpKey('-')).toBe('[');
  expect(threadJumpKey(']')).toBe(']');
  expect(threadJumpKey('+')).toBe(']');
  expect(threadJumpKey('=')).toBe('=');
  expect(threadJumpKey('a')).toBeNull();
});

test('the redrawn answer tells a landed jump from the same article shown again', () => {
  expect(threadAnswer(articleFrame(), source)).toBe('same');
  expect(threadAnswer(articleFrame({ time: 'Fri Oct  9 01:02:03 2026' }), source)).toBe('landed');
  expect(threadAnswer(articleFrame({ author: 'someone', title: '[活俠] 日本V或主播直播' }), source)).toBe('landed');
});

test('a first-in-thread jump that landed on a reply or forward has not reached the original', () => {
  const other = { author: 'someone', time: 'Fri Oct  9 01:02:03 2026' };
  expect(threadAnswer(articleFrame({ ...other, title: 'Re: [活俠] 日本V或主播直播' }), source, '=')).toBe('reply');
  expect(threadAnswer(articleFrame({ ...other, title: 'Fw: [活俠] 日本V或主播直播' }), source, '=')).toBe('reply');
  expect(threadAnswer(articleFrame({ ...other, title: '[活俠] 日本V或主播直播' }), source, '=')).toBe('landed');
  expect(threadAnswer(articleFrame({ ...other, title: 'Re: [活俠] 日本V或主播直播' }), source, '[')).toBe('landed');
});

test('the article list is the answer of a next-in-thread jump that found nothing', () => {
  expect(threadAnswer(listFrame([row(1)], 0), source)).toBe('list');
});

test('a frame that is neither an article page nor a list is no answer yet', () => {
  const partial = { rowTexts: blank(), rows: ROWS, kind: 'other', curX: 0, curY: 0 };
  expect(threadAnswer(partial, source)).toBeNull();
});

test('a later article page without the header is no proof of the same article', () => {
  const later = articleFrame();
  later.rowTexts[0] = '推 someone: 內文';
  later.rowTexts[1] = '';
  later.rowTexts[2] = '';
  expect(threadAnswer(later, source)).toBe('landed');
});

test('the source row is found among the results by date, author and title', () => {
  const key = { author: 'doom109', title: 'r: [活俠] 日本v或主播直播', date: '10/08' };
  const frame = listFrame([
    row(1, { title: '□ [活俠] 日本V或主播直播', author: 'first', date: ' 9/30' }),
    row(2, { date: '10/08' }),
    row(3, { author: 'later', date: '10/09' })
  ], 2);
  expect(findResultRow(frame, key)).toBe(2);
  expect(findResultRow(frame, { ...key, date: '10/07' })).toBeNull();
});

test('two rows with the same identity on one page are not a match', () => {
  const key = { author: 'doom109', title: 'r: [活俠] 日本v或主播直播', date: '10/08' };
  expect(findResultRow(listFrame([row(4), row(5)], 1), key)).toBeNull();
});

test('the first result number on the page decides whether there is a page above', () => {
  expect(resultsTopNum(listFrame([row(41), row(42), row(43)], 2))).toBe(41);
  expect(resultsTopNum(listFrame([], 0))).toBeNull();
});
