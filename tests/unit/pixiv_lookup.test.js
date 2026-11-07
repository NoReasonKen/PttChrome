// @unit-env browser
import { startPixivLookup, pixivLookupAvailable, pixivPageUrl } from '../../src/js/pixiv_lookup';
import { requestAndroid } from '../../src/js/android_bridge';

const query = '65964428';
const IMAGE = 'data:image/png;base64,aGVsbG8=';
let sent, listeners, cancel;
function install(capability = true) {
  sent = []; listeners = [];
  window.__PTT_ANDROID__ = { pixivLookup: capability };
  window.PttAndroid = {
    postMessage: json => sent.push(JSON.parse(json)),
    addEventListener: (_, fn) => listeners.push(fn),
  };
}
function respond(request, result, complete = true) {
  for (const fn of listeners) fn({ data: JSON.stringify({ id: request.id, ok: true, complete,
    result: { kind: request.kind, query, state: 'found', name: 'A name', ...result } }) });
}
function stop() {
  cancel?.(); cancel = null;
  const request = sent?.find(x => x.op === 'pixivCancel');
  if (request) for (const fn of listeners) fn({ data: JSON.stringify({ id: request.id, ok: true }) });
}
afterEach(() => {
  stop();
  delete window.__PTT_ANDROID__; delete window.PttAndroid;
  vi.useRealTimers();
});

test('unsupported hosts and invalid IDs never issue requests', () => {
  install(false);
  expect(pixivLookupAvailable()).toBe(false);
  const update = vi.fn();
  cancel = startPixivLookup(query, update);
  expect(sent).toEqual([]);
  expect(update.mock.calls.map(x => x[0].state)).toEqual(['unavailable', 'unavailable']);
  expect(pixivPageUrl('artwork', query)).toBe('https://www.pixiv.net/artworks/65964428');
  for (const value of ['../x', '0', '123\n', 123, null]) expect(pixivPageUrl('user', value)).toBeNull();
});

test('progressive replies keep metadata usable before each independent image', async () => {
  install(); const emit = vi.fn();
  cancel = startPixivLookup(query, emit);
  expect(sent.map(x => x.kind)).toEqual(['user', 'artwork']);
  const [user, artwork] = sent;
  expect(user.lookupId).toBe(artwork.lookupId);
  respond(user, { description: 'bio' }, false);
  expect(emit.mock.lastCall[0]).toMatchObject({ state: 'found', description: 'bio', imagePending: true });
  respond(artwork, { state: 'missing' });
  respond(user, { description: 'bio', imageData: IMAGE, imageDefault: true });
  await vi.waitFor(() => expect(emit.mock.calls.some(([x]) => x.kind === 'artwork' && x.state === 'missing')).toBe(true));
  expect(emit.mock.calls.findLast(([x]) => x.kind === 'user')[0]).toMatchObject({
    state: 'found', image: IMAGE, imageDefault: true, imagePending: false, imageError: false,
  });
});

test('image or malformed final reply cannot hide already found metadata', async () => {
  install(); const emit = vi.fn(); cancel = startPixivLookup(query, emit);
  const [user, artwork] = sent;
  respond(user, {}, false);
  respond(user, { query: 'another-query' });
  respond(artwork, { imageData: 'javascript:alert(1)' });
  await vi.waitFor(() => expect(emit.mock.calls.filter(([x]) => x.imageError)).toHaveLength(2));
  expect(emit.mock.calls.findLast(([x]) => x.kind === 'user')[0]).toMatchObject({ state: 'found', name: 'A name' });
  expect(emit.mock.calls.findLast(([x]) => x.kind === 'artwork')[0].image).toBeUndefined();
});

test('restriction reasons and bounded upstream messages survive the native boundary', async () => {
  install(); const emit = vi.fn(); cancel = startPixivLookup(query, emit);
  respond(sent[0], { state: 'unavailable', message: 'Site reason '.repeat(100), restriction: 'unknown' });
  respond(sent[1], { imageError: true, restriction: 'r18', message: { html: 'Not text' } });
  await vi.waitFor(() => expect(emit.mock.calls.some(([x]) => x.restriction === 'r18')).toBe(true));
  const user = emit.mock.calls.findLast(([x]) => x.kind === 'user')[0];
  expect(user.state).toBe('unavailable');
  expect(user.message).toHaveLength(500);
  expect(user.restriction).toBe('');
  const artwork = emit.mock.calls.findLast(([x]) => x.kind === 'artwork')[0];
  expect(artwork).toMatchObject({ state: 'found', restriction: 'r18', message: '', imageError: true });
});

test('closing a lookup cancels both native branches and ignores late replies', async () => {
  install(); const emit = vi.fn(); cancel = startPixivLookup(query, emit);
  const [user, artwork] = sent;
  const calls = emit.mock.calls.length;
  stop();
  expect(sent.filter(x => x.op === 'pixivCancel')).toHaveLength(1);
  expect(sent.at(-1).lookupId).toBe(user.lookupId);
  respond(user, { imageData: IMAGE }); respond(artwork, { imageData: IMAGE });
  await Promise.resolve();
  expect(emit).toHaveBeenCalledTimes(calls);
});

test('a silent native branch times out while preserving any received metadata', async () => {
  vi.useFakeTimers(); install(); const emit = vi.fn(); cancel = startPixivLookup(query, emit);
  respond(sent[0], {}, false);
  await vi.advanceTimersByTimeAsync(50001);
  expect(emit.mock.calls.findLast(([x]) => x.kind === 'user')[0]).toMatchObject({ state: 'found', imageError: true });
  expect(emit.mock.calls.findLast(([x]) => x.kind === 'artwork')[0].state).toBe('unavailable');
});

test('aborting a bridge request before posting does not send it', async () => {
  install(); const control = new AbortController(); control.abort();
  await expect(requestAndroid('pixivLookup', {}, { signal: control.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(sent).toEqual([]);
});
