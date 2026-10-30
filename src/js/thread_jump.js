// Far same-thread jumps from an article (#65). PTT's thread jump scans at most
// THREAD_SEARCH_RANGE (500) records from the article being read and treats a
// target beyond that as missing: `[` and `=` show the same article again, `]`
// returns to the article list. The same-thread search narrows the list to the
// thread, where the target is always in range.
import { articleContextFromScreen, pageArticleNums } from './comment_parse';
import { searchResultIdentity } from './search_result_anchor';
import { parseStatusRow } from './string_util';

const KEYS = { '[': '[', '-': '[', ']': ']', '+': ']', '=': '=' };

// The pager's same-thread key for `key`, its aliases included, or null.
export function threadJumpKey(key) {
  return KEYS[key] || null;
}

// The answer to a thread key followed by a redraw, read on its frame. `source`
// is the article the jump started from: { author, title, time }.
//   'landed': another article, so the jump landed;
//   'same':   the source again, so PTT found nothing within its range;
//   'list':   the article list, the same for a next-in-thread jump;
//   null:     not an answer yet.
export function threadAnswer(facts, source) {
  if (facts.kind === 'clean-list') return 'list';
  const rows = facts.rowTexts;
  const status = parseStatusRow(rows[facts.rows - 1] || '');
  if (facts.kind !== 'article' && !status) return null;
  const shown = articleContextFromScreen(rows[0], rows[1], status, rows.slice(2, 4));
  if (!shown?.title) return 'landed';
  return shown.author === source.author && shown.title === source.title && shown.time === source.time
    ? 'same' : 'landed';
}

const rowNums = facts => pageArticleNums(facts.rowTexts, facts.curY).slice(3, facts.rows - 1);

// The result number of the row whose identity is `key` (see
// searchResultIdentity), or null when it is not on the page or not unique.
export function findResultRow(facts, key) {
  const nums = rowNums(facts);
  let found = null;
  facts.rowTexts.slice(3, facts.rows - 1).forEach((text, i) => {
    const id = nums[i] != null && searchResultIdentity(text);
    if (!id || id.author !== key.author || id.title !== key.title || id.date !== key.date) return;
    found = found == null ? nums[i] : -1;
  });
  return found > 0 ? found : null;
}

// The first result number on the page, or null.
export function resultsTopNum(facts) {
  return rowNums(facts).find(num => num != null) ?? null;
}
