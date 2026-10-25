import { buildSearchSteps, searchGateFacts, beginInFlight, endInFlight } from './article_search';
import { SLOW_STEP_BUDGET, AID_NOT_FOUND_RE } from './aid_navigation';
import { isBoardArticleList, searchResultsLanded, SEARCH_RESULT_NOTICE } from './search_results_screen';
import { validateSearchResultsContext, recordSearchResults, clearSearchResultsContext } from './search_results_context';
import { recordFor } from './reading_record';
import { i18n } from './i18n';
import { HINT_ERROR } from './status_hint';

// Continue the existing resume transaction after it reaches the verified full
// board list. All filters use the same queue and prompt proof as normal search;
// this never submits through the UI or adds a shortcut return-history origin.
export function resumeSearchResults(core, context, done) {
  const search = validateSearchResultsContext(context);
  if (!search || !isBoardArticleList(searchGateFacts(core), search.board)) {
    done({ ok: false });
    return;
  }
  const bookmark = recordFor(core).begin('article-search');
  let finished = false;
  const finish = ok => {
    if (finished) return;
    finished = true;
    endInFlight(core);
    recordFor(core).end(bookmark, ok ? 'done' : 'fail');
    if (ok) recordSearchResults(core, search);
    else clearSearchResultsContext(core);
    const notice = !ok ? { message: i18n('searchResults_resumeFailed'), duration: 6000, level: HINT_ERROR } : null;
    recordFor(core).releaseExternal({ listNotice: notice });
    if (notice && core.conn?.isConnected)
      core.view.flashListHint(notice.message, notice.duration, notice.level);
    done({ ok });
  };
  const hold = () => {
    beginInFlight(core);
    core.listSession?.beginExternalNavigation({ fromIdle: true });
    core.boardListSession?.beginExternalNavigation();
  };
  const enqueue = step => {
    if (finished) return;
    beginInFlight(core);
    core.commandQueue.enqueue({
      ...SLOW_STEP_BUDGET,
      fullRepaint: true,
      ...step,
      onFail: () => finish(false),
      onFlushed: () => finish(false)
    });
  };
  const dismissFailure = () => enqueue({
    keys: ' ', kind: 'search-resume-dismiss',
    expect: (snapshot, facts) => isBoardArticleList(facts, search.board),
    onDone: () => finish(false)
  });
  const run = index => {
    if (finished) return;
    const filter = search.filters[index];
    hold();
    const steps = filter.kind === 'thread' ? null : buildSearchSteps(filter.kind, filter.value);
    if (filter.kind !== 'thread' && !steps) return finish(false);
    const submit = () => enqueue({
      ...(steps ? steps[1] : { keys: 'S' }),
      kind: 'search-resume-submit',
      expect: (snapshot, facts) => {
        const last = facts.rowTexts[facts.rows - 1] || '';
        if (facts.curY === facts.rows - 1 && SEARCH_RESULT_NOTICE.test(last)) return { notice: true };
        return searchResultsLanded(facts, search.board) ? { results: true } : false;
      },
      onDone: result => {
        if (result.notice) return dismissFailure();
        if (index + 1 < search.filters.length) run(index + 1);
        else finish(true);
      }
    });
    if (steps) enqueue({ ...steps[0], kind: 'search-resume-open', onDone: submit });
    else submit();
  };
  const first = search.filters[0];
  hold();
  if (first.kind !== 'thread') return run(0);
  // Native S reads the selected source header. Select only by a verified AID;
  // a deleted source cannot be replaced with a result number or keyword guess.
  if (!core.aidNavigation.selectArticle(search.board, first.aid, result => {
    if (finished) return;
    // AID navigation releases its own hold before invoking the callback,
    // including failure. Reacquire it for dismissal and the final handoff.
    hold();
    if (result.ok) return run(0);
    const facts = searchGateFacts(core);
    const rows = facts?.rowTexts || [];
    if (AID_NOT_FOUND_RE.test(rows[facts?.rows - 2] || '')) dismissFailure();
    else finish(false);
  })) finish(false);
}
