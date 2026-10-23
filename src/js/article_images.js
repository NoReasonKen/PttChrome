import {
  requestPreview,
  supportsMediaPreview,
  cachedPreviewDescriptor,
  needsReferer,
  MAX_RETRIES_PER_CANDIDATE,
  RETRY_BASE_MS,
} from '../components/ImagePreviewer';
import { inlinePreviewHref } from '../render/inline_preview_slot';

const IMAGE_SELECTOR = 'img.hyperLinkPreview';
const LOADING_HTML = '<div class="imageViewerLoading" role="status">Loading image…</div>';

function abortError() {
  return new DOMException('Image loading was cancelled.', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function wait(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(abortError());
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function measureImage(src, signal, imageFactory) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const image = imageFactory();
    const referrerPolicy = needsReferer(src) ? '' : 'no-referrer';
    const cleanup = () => {
      image.onload = image.onerror = null;
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      image.removeAttribute('src');
      reject(abortError());
    };
    image.onload = () => {
      cleanup();
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ src: image.currentSrc || src, width: image.naturalWidth,
          height: image.naturalHeight, referrerPolicy });
      } else reject(new Error('The image has no dimensions.'));
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('The image could not be loaded.'));
    };
    image.referrerPolicy = referrerPolicy;
    signal?.addEventListener('abort', abort, { once: true });
    image.src = src;
  });
}

// Share the inline preview's candidate order, retry budget, and referer policy.
export async function loadArticleImage(descriptor, {
  signal, imageFactory = () => new Image(), delay = wait,
} = {}) {
  const candidates = descriptor.srcset?.length ? descriptor.srcset : [descriptor.src];
  let failure = new Error('The image has no source.');
  for (const src of candidates) {
    if (!src) continue;
    for (let retry = 0; retry <= MAX_RETRIES_PER_CANDIDATE; retry++) {
      throwIfAborted(signal);
      try {
        const measured = await measureImage(src, signal, imageFactory);
        return { ...measured, alt: descriptor.alt || '' };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        failure = error;
        if (retry < MAX_RETRIES_PER_CANDIDATE)
          await delay(RETRY_BASE_MS * 2 ** retry, signal);
      }
    }
  }
  throw failure;
}

function flattenImages(descriptor) {
  if (!descriptor) return [];
  if (descriptor.type === 'album') return (descriptor.images || []).flatMap(flattenImages);
  return !descriptor.type || descriptor.type === 'image' ? [descriptor] : [];
}

function loadedImage(image, anchor) {
  if (!(image?.naturalWidth > 0 && image.naturalHeight > 0)) return null;
  return { src: image.currentSrc || image.src, width: image.naturalWidth,
    height: image.naturalHeight, alt: image.alt, referrerPolicy: image.referrerPolicy,
    trigger: image, anchor };
}

function normalizedSource(src) {
  try { return new URL(src, location.href).href; }
  catch { return src; }
}

function matchesDescriptor(image, descriptor) {
  const src = normalizedSource(image.currentSrc || image.src);
  return [descriptor.src, ...(descriptor.srcset || [])]
    .some((candidate) => candidate && normalizedSource(candidate) === src);
}

// Failed previews replace their image with an error control. Preserve that ordinal
// when available, then match source candidates for partially mounted media.
function albumImages(slot, descriptors) {
  const result = new Map();
  if (!slot) return result;
  const media = [...slot.querySelectorAll(`${IMAGE_SELECTOR}, .previewError`)];
  if (media.length === descriptors.length && media.every((node, ordinal) =>
    !node.matches(IMAGE_SELECTOR) || matchesDescriptor(node, descriptors[ordinal]))) {
    media.forEach((node, ordinal) => {
      if (node.matches(IMAGE_SELECTOR)) result.set(ordinal, node);
    });
  } else {
    for (const image of media.filter((node) => node.matches(IMAGE_SELECTOR))) {
      const ordinal = descriptors.findIndex((descriptor, index) =>
        !result.has(index) && matchesDescriptor(image, descriptor));
      if (ordinal >= 0) result.set(ordinal, image);
    }
  }
  return result;
}

// Slot metadata includes unmounted previews; collecting the gallery performs no requests.
export function collectArticleImages(container, selectedImage, {
  resolvePreview = requestPreview, loadImage = loadArticleImage,
  slotHref = inlinePreviewHref, canPreview = supportsMediaPreview,
  cachedPreview = cachedPreviewDescriptor,
} = {}) {
  const items = [];
  let index = -1;
  const occurrences = new Map();
  const slots = () => [...container.querySelectorAll('.inlinePreviewSlot')];
  const pending = (anchor, resolve) => ({ type: 'html', html: LOADING_HTML, anchor, resolve });
  const imageEntry = (descriptor, anchor) => ({ type: 'html', html: LOADING_HTML,
    anchor, load: (options) => loadImage(descriptor, options) });

  for (const node of container.querySelectorAll(`.inlinePreviewSlot, ${IMAGE_SELECTOR}`)) {
    if (node.matches(IMAGE_SELECTOR)) {
      if (node.closest('.inlinePreviewSlot')) continue;
      const src = node.currentSrc || node.src;
      const ordinal = occurrences.get(src) || 0;
      occurrences.set(src, ordinal + 1);
      const anchor = () => [...container.querySelectorAll(IMAGE_SELECTOR)]
        .filter((image) => !image.closest('.inlinePreviewSlot') &&
          (image.currentSrc || image.src) === src)[ordinal] || null;
      const entry = loadedImage(node, anchor);
      if (entry) {
        if (node === selectedImage) index = items.length;
        items.push(entry);
      }
      continue;
    }
    const href = slotHref(node);
    if (!href) continue;
    const images = [...node.querySelectorAll(IMAGE_SELECTOR)];
    const key = `slot:${href}`;
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    if (!images.length && !canPreview(href)) continue;
    const currentSlot = () => slots().filter((slot) => slotHref(slot) === href)[occurrence];
    const anchorFor = (ordinal, descriptors) => () => {
      const slot = currentSlot();
      if (descriptors) return albumImages(slot, descriptors).get(ordinal) || slot || null;
      return slot?.querySelectorAll(IMAGE_SELECTOR)[ordinal] || slot || null;
    };
    const resolve = async ({ signal } = {}, ordinal) => {
      throwIfAborted(signal);
      const descriptor = await withAbort(resolvePreview(href), signal);
      throwIfAborted(signal);
      const descriptors = flattenImages(descriptor);
      return descriptors.flatMap((image, imageIndex) => {
        if (ordinal !== undefined && ordinal !== imageIndex) return [];
        const anchor = anchorFor(imageIndex, descriptors);
        return loadedImage(anchor(), anchor) || imageEntry(image, anchor);
      });
    };
    const cached = cachedPreview(href);
    if (cached) {
      const descriptors = flattenImages(cached);
      const matched = albumImages(node, descriptors);
      descriptors.forEach((descriptor, ordinal) => {
        const image = matched.get(ordinal);
        if (image && image === selectedImage) index = items.length;
        const anchor = anchorFor(ordinal, descriptors);
        items.push(loadedImage(image, anchor) || imageEntry(descriptor, anchor));
      });
      // A mounted image remains usable even if stale resolver metadata omits it.
      for (const image of images.filter((candidate) =>
        ![...matched.values()].includes(candidate))) {
        const ordinal = images.indexOf(image);
        if (image === selectedImage) index = items.length;
        const entry = loadedImage(image, anchorFor(ordinal));
        if (entry) items.push(entry);
      }
    } else if (!images.length) {
      items.push(pending(anchorFor(0), (options) => resolve(options)));
    } else images.forEach((image, ordinal) => {
      if (image === selectedImage) index = items.length;
      const anchor = anchorFor(ordinal);
      items.push(loadedImage(image, anchor) ||
        pending(anchor, (options) => resolve(options, ordinal)));
    });
  }
  return { items, index };
}
