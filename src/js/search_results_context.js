import { BOARD_RE, isAidc } from './aid_codec';
import { sameBoard } from './screen_titles';

// Query metadata belongs to the live connection, not to the search-history MRU.
// Its owner records only verified results and clears it on unrelated navigation.
const contexts = new WeakMap();
export const MAX_SEARCH_RESULTS_FILTERS = 8;
const MAX_QUERY_BYTES = { title: 63, author: 12, push: 6, price: 6, exclude: 59 };
// Filters that carry no text of their own (article_search.FILTER_KINDS): the
// letter PTT's m/s prompt is answered with, or nothing for a bare key.
// Native S reads the cursor row, so it cannot be replayed from this description:
// it counts toward the live context (the limit, a second S is refused locally)
// but never survives into a resume plan, a repeat or a layer's stored search.
const LIVE_ONLY_KINDS = ['sameTitle'];
const FIXED_VALUES = { mark: 'm', solved: 's', newPost: '', digest: '' };
// The digest (Tab) is the context's first filter when the results are inside it:
// the conditions are PTT's search inside the digest list. It takes no condition
// slot (select_read's cap counts predicates, and the digest is not one).
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isCore = value => value !== null && (typeof value === 'object' || typeof value === 'function');

function queryFilter(filter, live = false) {
  if (!isObject(filter)) return null;
  if (Object.prototype.hasOwnProperty.call(FIXED_VALUES, filter.kind))
    return filter.value === FIXED_VALUES[filter.kind] ? { kind: filter.kind, value: filter.value } : null;
  if (filter.kind === 'thread') {
    if (!isAidc(filter.aid) || typeof filter.title !== 'string' || !filter.title.trim() ||
        filter.title.length > 200 || CONTROL.test(filter.title)) return null;
    return { kind: 'thread', aid: filter.aid, title: filter.title };
  }
  if (LIVE_ONLY_KINDS.includes(filter.kind)) return live ? { kind: filter.kind, value: '' } : null;
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
  if (filter.kind === 'price') {
    if (!/^\d+$/.test(value) || parseInt(value, 10) <= 0) return null;
    return { kind: 'price', value: String(parseInt(value, 10)) };
  }
  return { kind: filter.kind, value };
}

const sameOrdinaryFilter = (a, b) => a.kind !== 'thread' && b.kind !== 'thread' &&
  a.kind === b.kind && a.value === b.value;

// Return an independent, bounded JSON descriptor safe to put in a resume plan.
// A matching board name is necessary; verified result-screen ownership remains
// the caller's responsibility, because captions alone cannot prove the query.
export function validateSearchResultsContext(value, board, live = false) {
  if (!isObject(value) || typeof value.board !== 'string' || !BOARD_RE.test(value.board) ||
      (board !== undefined && !sameBoard(value.board, board)) ||
      !Array.isArray(value.filters) || !value.filters.length ||
      value.filters.filter(filter => filter?.kind !== 'digest').length > MAX_SEARCH_RESULTS_FILTERS) return null;
  const filters = Array.from(value.filters, filter => queryFilter(filter, live));
  if (filters.some(filter => !filter)) return null;
  // Native S starts a whole-board subject search; it cannot be an added filter.
  if (filters.some((filter, index) => filter.kind === 'thread' && index !== 0)) return null;
  if (filters.some((filter, index) => filter.kind === 'digest' && index !== 0)) return null;
  // A digest cannot be searched from a thread's source article.
  if (filters[0].kind === 'digest' && filters.some(filter => filter.kind === 'thread')) return null;
  return { board: value.board, filters: filters.filter((filter, index) =>
    !filters.slice(0, index).some(previous => sameOrdinaryFilter(previous, filter))) };
}

// The live context of this connection's results. Its filters may include ones
// that cannot be replayed; persisting and replaying callers validate it again
// without `live`, which rejects them.
export function readSearchResultsContext(core, board) {
  return isCore(core) ? validateSearchResultsContext(contexts.get(core), board, true) : null;
}

export function clearSearchResultsContext(core) {
  if (isCore(core)) contexts.delete(core);
}

export function recordSearchResults(core, context) {
  const validated = validateSearchResultsContext(context, undefined, true);
  if (!isCore(core)) return null;
  if (validated) contexts.set(core, validated);
  else contexts.delete(core);
  return validateSearchResultsContext(validated, undefined, true);
}

// Construct before submission, commit only after the expected results land.
// Missing prior metadata or overflow makes the entire query unreconstructable;
// retaining only its newest filters would silently change the search.
// `inDigest`: the search is made inside the digest, so the digest leads the
// conditions even when PTT's prompt starts a fresh search (no MODE_SELECT yet).
export function candidateSearchResults(core, board, filter, append = false, inDigest = false) {
  const stored = readSearchResultsContext(core, board);
  const previous = append ? stored : inDigest && stored?.filters[0].kind === 'digest'
    ? { board, filters: [stored.filters[0]] } : null;
  if (append && !previous) return null;
  const lead = !previous && inDigest ? [{ kind: 'digest', value: '' }] : [];
  const next = queryFilter(filter, true);
  if (previous && next && previous.filters.some(prior => sameOrdinaryFilter(prior, next))) {
    return validateSearchResultsContext({ board, filters: previous.filters }, board, true);
  }
  return validateSearchResultsContext({
    board,
    filters: [...(previous ? previous.filters : lead), filter]
  }, board, true);
}
