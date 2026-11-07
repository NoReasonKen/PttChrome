import { androidBridgeAvailable, requestAndroid } from './android_bridge';
import { isPixivId } from './pixiv_parse';

const KINDS = ['user', 'artwork'];
let sequence = 0;

export function pixivLookupAvailable() {
  return androidBridgeAvailable() && window.__PTT_ANDROID__?.pixivLookup === true;
}

export function pixivPageUrl(kind, query) {
  if (!KINDS.includes(kind) || !isPixivId(query)) return null;
  return `https://www.pixiv.net/${kind === 'user' ? 'users' : 'artworks'}/${query}`;
}

function resultFor(reply, kind, query) {
  const result = reply?.result;
  if (!reply?.ok || result?.kind !== kind || result?.query !== query ||
      !['found', 'missing', 'unavailable'].includes(result.state)) return null;
  const image = typeof result.imageData === 'string' && result.imageData.length <= 710000 &&
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(result.imageData)
    ? result.imageData : undefined;
  return {
    kind, query, state: result.state,
    name: String(result.name || '').slice(0, 500),
    author: String(result.author || '').slice(0, 200),
    description: String(result.description || '').slice(0, 10000),
    message: typeof result.message === 'string' ? result.message.slice(0, 500) : '',
    restriction: ['r18', 'r18g', 'restricted'].includes(result.restriction) ? result.restriction : '',
    width: Math.max(1, Math.min(100000, Number(result.width) || 1)),
    height: Math.max(1, Math.min(100000, Number(result.height) || 1)),
    image, imageDefault: !!result.imageDefault,
    imagePending: result.state === 'found' && reply.complete === false,
    imageError: !!result.imageError || (reply.complete !== false && result.state === 'found' && !image),
  };
}

// An explicit chooser session owns its two requests. Rendering IDs never calls
// this function; closing the chooser aborts local listeners and native I/O.
export function startPixivLookup(query, onResult) {
  if (!isPixivId(query) || !pixivLookupAvailable()) {
    for (const kind of KINDS) onResult({ query, kind, state: 'unavailable' });
    return () => {};
  }
  const lookupId = `pixiv-${++sequence}`;
  const controller = new AbortController();
  let active = true;
  const latest = new Map();
  for (const kind of KINDS) {
    onResult({ query, kind, state: 'loading' });
    const update = reply => {
      if (!active) return;
      const result = resultFor(reply, kind, query);
      if (!result) return;
      latest.set(kind, result);
      onResult(result);
    };
    requestAndroid('pixivLookup', { lookupId, query, kind }, {
      onProgress: update, signal: controller.signal, timeoutMs: 50000,
    }).then(reply => {
      if (!active) return;
      if (resultFor(reply, kind, query)) update(reply);
      else throw new Error('Invalid Pixiv reply');
    }).catch(() => {
      if (!active) return;
      const prior = latest.get(kind);
      onResult(prior?.state === 'found'
        ? { ...prior, imagePending: false, imageError: true }
        : { query, kind, state: 'unavailable' });
    });
  }
  return () => {
    if (!active) return;
    active = false;
    controller.abort();
    requestAndroid('pixivCancel', { lookupId }, { timeoutMs: 5000 }).catch(() => {});
  };
}
