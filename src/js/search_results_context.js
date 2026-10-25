import { BOARD_RE, isAidc } from './aid_codec';
import { sameBoard } from './screen_titles';

// Query metadata belongs to the live connection, not to the search-history MRU.
// Its owner records only verified results and clears it on unrelated navigation.
const contexts = new WeakMap();
export const MAX_SEARCH_RESULTS_FILTERS = 8;
const MAX_QUERY_BYTES = { title: 63, author: 12, push: 6 };
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isCore = value => value !== null && (typeof value === 'object' || typeof value === 'function');

function queryFilter(filter) {
  if (!isObject(filter)) return null;
  if (filter.kind === 'thread') {
    if (!isAidc(filter.aid) || typeof filter.title !== 'string' || !filter.title.trim() ||
        filter.title.length > 200 || CONTROL.test(filter.title)) return null;
    return { kind: 'thread', aid: filter.aid, title: filter.title };
  }
  const max = MAX_QUERY_BYTES[filter.kind];
  if (!Object.prototype.hasOwnProperty.call(MAX_QUERY_BYTES, filter.kind) ||
      typeof filter.value !== 'string' || CONTROL.test(filter.value)) return null;
  const value = filter.value.trim();
  if (!value) return null;
  // Match article_search's input limits without importing its command owner.
  let bytes = 0;
  for (let i = 0; i < value.length; ++i) bytes += value.charCodeAt(i) > 0x7f ? 2 : 1;
  if (bytes > max) return null;
  if (filter.kind === 'push') {
    if (!/^-?\d+$/.test(value) || parseInt(value, 10) === 0) return null;
    return { kind: 'push', value: String(parseInt(value, 10)) };
  }
  return { kind: filter.kind, value };
}

// Return an independent, bounded JSON descriptor safe to put in a resume plan.
// A matching board name is necessary; verified result-screen ownership remains
// the caller's responsibility, because captions alone cannot prove the query.
export function validateSearchResultsContext(value, board) {
  if (!isObject(value) || typeof value.board !== 'string' || !BOARD_RE.test(value.board) ||
      (board !== undefined && !sameBoard(value.board, board)) ||
      !Array.isArray(value.filters) || !value.filters.length ||
      value.filters.length > MAX_SEARCH_RESULTS_FILTERS) return null;
  const filters = Array.from(value.filters, queryFilter);
  if (filters.some(filter => !filter)) return null;
  // Native S starts a whole-board subject search; it cannot be an added filter.
  if (filters.some((filter, index) => filter.kind === 'thread' && index !== 0)) return null;
  return { board: value.board, filters };
}

export function readSearchResultsContext(core, board) {
  return isCore(core) ? validateSearchResultsContext(contexts.get(core), board) : null;
}

export function clearSearchResultsContext(core) {
  if (isCore(core)) contexts.delete(core);
}

export function recordSearchResults(core, context) {
  const validated = validateSearchResultsContext(context);
  if (!isCore(core)) return null;
  if (validated) contexts.set(core, validated);
  else contexts.delete(core);
  return validateSearchResultsContext(validated);
}

// Construct before submission, commit only after the expected results land.
// Missing prior metadata or overflow makes the entire query unreconstructable;
// retaining only its newest filters would silently change the search.
export function candidateSearchResults(core, board, filter, append = false) {
  const previous = append ? readSearchResultsContext(core, board) : null;
  if (append && !previous) return null;
  return validateSearchResultsContext({
    board,
    filters: [...(previous ? previous.filters : []), filter]
  }, board);
}
