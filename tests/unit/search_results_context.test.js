import {
  MAX_SEARCH_RESULTS_FILTERS,
  candidateSearchResults,
  clearSearchResultsContext,
  readSearchResultsContext,
  recordSearchResults,
  validateSearchResultsContext
} from '../../src/js/search_results_context';

const title = value => ({ kind: 'title', value });
const context = filters => ({ board: 'Test', filters });

test('a query candidate stays inactive until its verified results are recorded', () => {
  const core = {};
  const candidate = candidateSearchResults(core, 'Test', title(' topic '));
  expect(readSearchResultsContext(core, 'Test')).toBeNull();
  expect(candidate).toEqual(context([title('topic')]));
  recordSearchResults(core, candidate);
  expect(readSearchResultsContext(core, 'test')).toEqual(candidate);
});

test('successive conditions retain their order while plain-list searches replace them', () => {
  const core = {};
  recordSearchResults(core, context([title('topic')]));
  const next = candidateSearchResults(core, 'test', { kind: 'author', value: 'reader' }, true);
  expect(next).toEqual({ board: 'test', filters: [title('topic'), { kind: 'author', value: 'reader' }] });
  recordSearchResults(core, next);
  expect(candidateSearchResults(core, 'Test', title('other'))).toEqual(context([title('other')]));
});

test('an added condition needs proven metadata for the same board', () => {
  const core = {};
  expect(candidateSearchResults(core, 'Test', title('topic'), true)).toBeNull();
  recordSearchResults(core, context([title('topic')]));
  expect(candidateSearchResults(core, 'Other', title('other'), true)).toBeNull();
  expect(readSearchResultsContext(core, 'Other')).toBeNull();
});

test('overflow invalidates recovery metadata instead of dropping earlier conditions', () => {
  const core = {};
  const full = context(Array.from({ length: MAX_SEARCH_RESULTS_FILTERS }, (_, i) => title(String(i))));
  recordSearchResults(core, full);
  expect(readSearchResultsContext(core, 'Test')).toEqual(full);
  const overflow = candidateSearchResults(core, 'Test', title('extra'), true);
  expect(overflow).toBeNull();
  recordSearchResults(core, overflow);
  expect(readSearchResultsContext(core, 'Test')).toBeNull();
});

test('recorded and returned descriptors cannot mutate the stored query', () => {
  const core = {};
  const original = context([title('topic')]);
  const recorded = recordSearchResults(core, original);
  original.filters[0].value = 'changed';
  recorded.filters.push(title('extra'));
  const read = readSearchResultsContext(core, 'Test');
  read.filters[0].value = 'changed again';
  expect(readSearchResultsContext(core, 'Test')).toEqual(context([title('topic')]));
});

test('metadata is scoped to its core and can be explicitly cleared', () => {
  const core = {};
  recordSearchResults(core, context([title('topic')]));
  expect(readSearchResultsContext({}, 'Test')).toBeNull();
  clearSearchResultsContext(core);
  expect(readSearchResultsContext(core, 'Test')).toBeNull();
});

test.each(['\r', '\n', '\x00', '\x1b', '\x7f', '\x85'])(
  'persisted queries reject control character %j rather than trimming it into a command', control => {
    expect(validateSearchResultsContext(context([title(`topic${control}`)]))).toBeNull();
    expect(validateSearchResultsContext(context([{ kind: 'thread', aid: '1gIeu-3B', title: `topic${control}` }]))).toBeNull();
  }
);

test.each([
  null,
  [],
  { board: 'Test\r', filters: [title('topic')] },
  { board: 'Test', filters: [] },
  { board: 'Test', filters: Array(1) },
  context([{ kind: 'board', value: 'Other' }]),
  context([{ kind: 'toString', value: 'topic' }]),
  context([{ kind: 'title', value: 123 }]),
  context([title(' ')]),
  context([{ kind: 'thread', aid: 'invalid', title: 'topic' }]),
  context([{ kind: 'thread', aid: '1gIeu-3B', title: 'x'.repeat(201) }])
])('invalid persisted metadata stays inactive: %j', value => {
  expect(validateSearchResultsContext(value)).toBeNull();
});

test('normalization obeys prompt byte limits and numeric push semantics', () => {
  expect(validateSearchResultsContext(context([title('x'.repeat(63))]))).not.toBeNull();
  expect(validateSearchResultsContext(context([title('x'.repeat(64))]))).toBeNull();
  expect(validateSearchResultsContext(context([title('中'.repeat(31) + 'x')]))).not.toBeNull();
  expect(validateSearchResultsContext(context([title('中'.repeat(32))]))).toBeNull();
  expect(validateSearchResultsContext(context([{ kind: 'author', value: 'x'.repeat(13) }]))).toBeNull();
  expect(validateSearchResultsContext(context([{ kind: 'push', value: '-00002' }]))).toEqual(context([{ kind: 'push', value: '-2' }]));
  for (const value of ['0', '-0', '2x', '1000000']) {
    expect(validateSearchResultsContext(context([{ kind: 'push', value }]))).toBeNull();
  }
});

test('a verified thread source can precede added ordinary filters but cannot replace one silently', () => {
  const thread = { kind: 'thread', aid: '1gIeu-3B', title: 'Re: topic' };
  expect(validateSearchResultsContext(context([thread, title('extra')]))).toEqual(context([thread, title('extra')]));
  expect(validateSearchResultsContext(context([title('topic'), thread]))).toBeNull();
  expect(validateSearchResultsContext(context([thread, thread]))).toBeNull();
});

test('unknown stored properties are omitted from sanitized descriptors', () => {
  const value = { ...context([{ ...title('topic'), keys: '\r' }]), extra: 'ignored' };
  expect(validateSearchResultsContext(value)).toEqual(context([title('topic')]));
});
