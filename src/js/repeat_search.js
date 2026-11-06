import { buildSearchSteps } from './article_search';
import { SLOW_STEP_BUDGET, AID_NOT_FOUND_RE, aidSearchLanded } from './aid_navigation';
import { isBoardArticleList, searchResultsLanded, SEARCH_RESULT_NOTICE } from './search_results_screen';
import { validateSearchResultsContext } from './search_results_context';

// Search results that Back reveals may have lost their search in PTT. A
// board jump from an article opened from them lands on the board's full list,
// and so does every Back after it, where the result numbers name other
// articles. This runs the results' search again on that full list, the way the
// results were found, through the shared queue: `done(true)` once PTT shows
// the results again. When PTT turns a filter down, the turn-down is dismissed
// back to the full list and `done(false)` follows; a step that fails also
// gives `done(false)`.
// Returns false when `context` names no search to run again.
export function repeatSearch(core, context, done) {
  const search = validateSearchResultsContext(context);
  if (!search || !core.commandQueue) return false;
  let finished = false;
  const finish = ok => {
    if (finished) return;
    finished = true;
    done(ok);
  };
  const enqueue = step => {
    if (finished) return;
    core.commandQueue.enqueue({
      ...SLOW_STEP_BUDGET,
      ...step,
      onFail: () => finish(false),
      onFlushed: () => finish(false)
    });
  };
  const dismiss = () => enqueue({
    keys: ' ', kind: 'repeat-search-dismiss',
    expect: (snapshot, facts) => isBoardArticleList(facts, search.board),
    onDone: () => finish(false)
  });
  const run = index => {
    const filter = search.filters[index];
    const steps = filter.kind === 'thread' ? null : buildSearchSteps(filter.kind, filter.value);
    if (filter.kind !== 'thread' && !steps) return finish(false);
    const submit = () => enqueue({
      ...(steps ? steps[1] : { keys: 'S' }),
      kind: 'repeat-search-submit',
      expect: (snapshot, facts) => {
        const last = facts.rowTexts[facts.rows - 1] || '';
        if (facts.curY === facts.rows - 1 && SEARCH_RESULT_NOTICE.test(last)) return { notice: true };
        return searchResultsLanded(facts, search.board) ? { results: true } : false;
      },
      onDone: result => {
        if (result.notice) dismiss();
        else if (index + 1 < search.filters.length) run(index + 1);
        else finish(true);
      }
    });
    if (steps) enqueue({ ...steps[0], kind: 'repeat-search-open', fullRepaint: true, onDone: submit });
    else submit();
  };
  const first = search.filters[0];
  if (first.kind !== 'thread') {
    run(0);
    return true;
  }
  // Native S reads the selected article: select the thread's article by its
  // code first. A deleted one cannot be replaced by a guess.
  enqueue({
    keys: '#' + first.aid + '\r', kind: 'repeat-search-select', fullRepaint: true,
    expect: (snapshot, facts) => {
      if (AID_NOT_FOUND_RE.test(facts.rowTexts[facts.rows - 2] || '')) return { missing: true };
      return aidSearchLanded(facts) ? { selected: true } : false;
    },
    onDone: result => result.missing ? dismiss() : run(0)
  });
  return true;
}
