import { SLOW_STEP_BUDGET } from './aid_navigation';
import { beginInFlight } from './article_search';
import { pageArticleNums } from './comment_parse';
import { listModeOf } from './list_session';
import { parseBoardKey } from './screen_titles';
import { searchResultsLanded } from './search_results_screen';
import { matchesSearchResultAnchor, validateSearchResultAnchor } from './search_result_anchor';

// Old result numbers are hints, never identities. Probe at most the old page
// and its two neighbors; all wire ownership remains with the search restorer.
export function restoreSearchResultPosition(core, search, saved, done) {
  const anchor = validateSearchResultAnchor(saved);
  // Undefined is an older snapshot without position metadata; explicit null
  // means the current capture could not identify a unique visible row.
  if (!anchor) return done(saved === null ? { missing: true } : {});
  let finished = false;
  const candidates = new Map();
  const finish = result => {
    if (finished) return;
    finished = true;
    done(result);
  };
  const queue = (keys, kind, onDone) => {
    if (finished) return;
    beginInFlight(core);
    core.commandQueue.enqueue({
      ...SLOW_STEP_BUDGET, fullRepaint: true, keys, kind,
      expect: (snapshot, facts) => searchResultsLanded(facts, search.board) ? facts : false,
      onDone: facts => { if (!finished) onDone(facts); },
      onFail: () => finish({ interrupted: true }),
      onFlushed: () => finish({ interrupted: true })
    });
  };
  const newest = () => queue('\x1b[4~\f', 'search-position-fallback', () => finish({ missing: true }));
  const numsOf = facts => pageArticleNums(facts.rowTexts, facts.curY);
  const remember = facts => {
    const nums = numsOf(facts);
    for (let row = 3; row < facts.rows - 1; row++) {
      if (nums[row] > 0 && matchesSearchResultAnchor(facts.rowTexts[row], anchor))
        candidates.set(nums[row], true);
    }
  };
  const restored = (facts, num) => finish({ record: {
    kind: 'list', board: parseBoardKey(facts.rowTexts[0]), mode: listModeOf(facts),
    topNum: num, topPinnedKey: null, scrollFrac: anchor.scrollFrac, cursorNum: num
  } });
  const select = facts => {
    if (candidates.size !== 1) return newest();
    const num = candidates.keys().next().value;
    if (numsOf(facts)[facts.curY] === num && matchesSearchResultAnchor(facts.rowTexts[facts.curY], anchor))
      return restored(facts, num);
    queue(String(num) + '\r\f', 'search-position-select', landing => {
      if (numsOf(landing)[landing.curY] === num && matchesSearchResultAnchor(landing.rowTexts[landing.curY], anchor))
        restored(landing, num);
      else newest();
    });
  };
  queue(String(anchor.num) + '\r\f', 'search-position-probe', first => {
    remember(first);
    if (candidates.size) return select(first);
    const span = Math.max(1, first.rows - 4);
    const probes = [...new Set([Math.max(1, anchor.num - span), Math.min(2147483647, anchor.num + span)])]
      .filter(num => num !== anchor.num);
    const next = facts => {
      if (!probes.length) return select(facts);
      queue(String(probes.shift()) + '\r\f', 'search-position-probe', landing => {
        remember(landing);
        next(landing);
      });
    };
    next(first);
  });
}
