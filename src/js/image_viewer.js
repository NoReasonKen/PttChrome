import PhotoSwipe from 'photoswipe';
import { collectArticleImages } from './article_images';
import { renderChunksAround } from '../render/screen_chunk';
import { computeCenteredScrollTop, offsetTopWithin } from './scroll_anchor';

// PhotoSwipe owns gestures; this adapter owns the article gallery and modal lifetime.
export class ImageViewer {
  constructor(app) {
    this.app = app;
    this._viewer = null;
    this._onPreview = (event) => {
      if (!app.modalShown) this.open(event.detail);
    };
    this._onSettled = () => {
      if (this.isOpen && (app.view._articleInstanceId !== this._articleId ||
          app.buf.settledPageState !== 3)) this.close({ restore: false });
    };
    app.view.screenRoot.addEventListener('previewimage', this._onPreview);
    app.buf.addEventListener('screenSettled', this._onSettled);
  }

  get isOpen() {
    return this._viewer !== null;
  }

  open(image) {
    if (this.isOpen || !image?.src || !(image.width > 0 && image.height > 0)) return false;
    this._restoreController?.abort();
    const { app } = this;
    const { src, width, height, alt = '', referrerPolicy = '', trigger } = image;
    const container = trigger?.closest('#mainContainer') || app.view.mainContainer || app.view.screenRoot;
    let gallery = collectArticleImages(container, trigger);
    if (gallery.index < 0) gallery = { items: [{ ...image, anchor: () => trigger }], index: 0 };
    const initial = gallery.items[gallery.index];
    Object.assign(initial, { src, width, height, alt, referrerPolicy });
    this._initialEntry = initial;
    this._lastEntry = initial;
    this._previousIndex = gallery.index + 1;
    this._direction = 1;
    this._closing = false;
    this._refreshing = false;
    this._restoreOnClose = true;
    this._controller = new AbortController();
    this._tasks = new Map();
    this._updates = [];
    this._updateFrame = 0;
    const viewer = new PhotoSwipe({
      // Native slide navigation commits the outward swipe before closing.
      // Empty boundary slides also let a one-image article swipe out in either direction.
      dataSource: [{ type: 'html', html: '<div></div>', edge: true }, ...gallery.items,
        { type: 'html', html: '<div></div>', edge: true }],
      index: gallery.index + 1,
      preload: [0, 0],
      initialZoomLevel: 'fit',
      secondaryZoomLevel: (levels) => levels.fit * 2,
      // Even a tiny or very tall image can grow wider than the viewport.
      maxZoomLevel: (levels) => Math.max(levels.fit * 8,
        levels.panAreaSize.x / levels.elementSize.x * 2),
      doubleTapAction: 'zoom',
      imageClickAction: 'zoom',
      tapAction: false,
      pinchToClose: false,
      closeOnVerticalDrag: false,
      allowPanToNext: true,
      loop: false,
      counter: false,
      arrowPrev: false,
      arrowNext: false,
      returnFocus: false,
      showHideAnimationType: 'none',
      bgOpacity: 1,
      closeTitle: 'Close image viewer',
      zoomTitle: 'Zoom image',
      errorMsg: 'The image could not be loaded.',
      mainClass: 'imageViewer',
    });
    this._viewer = viewer;
    this._articleId = app.view._articleInstanceId;
    const background = new Map();
    const unregister = app.registerSheetDismiss(() => this.close());
    app.setModalOpen('imageViewer', true);

    viewer.on('firstUpdate', () => {
      viewer.element.setAttribute('aria-label', 'Image viewer');
      viewer.element.setAttribute('aria-modal', 'true');
      for (const child of document.body.children) {
        if (child === viewer.element) continue;
        background.set(child, child.inert);
        child.inert = true;
      }
    });
    viewer.on('contentLoadImage', ({ content }) => {
      content.element.referrerPolicy = content.data.referrerPolicy || '';
    });
    viewer.on('contentLoad', ({ content }) => this._loadEntry(content.data, viewer));
    viewer.on('contentAppend', ({ content }) => {
      content.element?.querySelector('.imageViewerRetry')?.addEventListener('click', () => {
        content.data.failed = false;
        this._loadEntry(content.data, viewer);
      }, { once: true });
    });
    viewer.on('change', () => this._onChange(viewer));
    viewer.on('close', () => this._cancelPending());
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this._cancelPending();
      for (const [child, inert] of background) child.inert = inert;
      unregister();
      this._viewer = null;
      app.setModalOpen('imageViewer', false);
      if (!app.modalShown && this._restoreOnClose && this._sameArticle()) {
        this._restorePosition(this._lastEntry, container);
      }
      window.dispatchEvent(new CustomEvent('imageviewerchange', { detail: { open: false } }));
    };
    viewer.on('destroy', release);
    try {
      viewer.init();
      window.dispatchEvent(new CustomEvent('imageviewerchange', { detail: { open: true } }));
      return true;
    } catch (error) {
      // Initialization failures must release terminal input and background focus.
      viewer.element?.remove();
      viewer.events.removeAll();
      release();
      throw error;
    }
  }

  _sameArticle() {
    return this.app.view._articleInstanceId === this._articleId &&
      this.app.buf.settledPageState === 3 &&
      (this.app.connectState === undefined || this.app.connectState === 1);
  }

  _active(viewer) {
    return this._viewer === viewer && !this._closing && this._sameArticle();
  }

  _onChange(viewer) {
    if (this._refreshing || !this._active(viewer)) return;
    const entry = viewer.options.dataSource[viewer.currIndex];
    if (entry.edge) {
      this.close();
      return;
    }
    if (viewer.currIndex !== this._previousIndex) {
      this._direction = viewer.currIndex < this._previousIndex ? -1 : 1;
      this._previousIndex = viewer.currIndex;
    }
    if (entry.width > 0 && entry.height > 0) this._lastEntry = entry;
    this._loadEntry(entry, viewer);
  }

  async _loadEntry(entry, viewer) {
    if (!this._active(viewer) || entry.failed || this._tasks.has(entry) ||
        (!entry.resolve && !entry.load)) return;
    this._tasks.set(entry, true);
    const signal = this._controller.signal;
    try {
      if (entry.resolve) {
        const images = await entry.resolve({ signal });
        await this._whenIdle(viewer, () => this._replaceEntry(viewer, entry, images));
      } else {
        const loaded = await entry.load({ signal });
        await this._whenIdle(viewer, () => {
          Object.assign(entry, loaded, { type: 'image' });
          delete entry.html;
          delete entry.load;
          this._refreshSlides(viewer, viewer.currIndex, [viewer.options.dataSource.indexOf(entry)]);
        });
      }
    } catch (error) {
      if (error.name === 'AbortError' || !this._active(viewer)) return;
      await this._whenIdle(viewer, () => {
        entry.failed = true;
        entry.html = '<div class="imageViewerError" role="status">The image could not be loaded. <button class="imageViewerRetry" type="button">Retry image</button></div>';
        this._refreshSlides(viewer, viewer.currIndex, [viewer.options.dataSource.indexOf(entry)]);
      });
    } finally {
      this._tasks.delete(entry);
    }
  }

  _whenIdle(viewer, update) {
    if (!this._active(viewer)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this._updates.push({ update, resolve, reject });
      const flush = () => {
        this._updateFrame = 0;
        if (!this._active(viewer)) return;
        // Await PhotoSwipe's native drag/pinch and committed slide transition.
        // Updating indices during its spring animation would cancel the swipe.
        if (viewer.gestures.isDragging || viewer.gestures.isZooming ||
            viewer.mainScroll.isShifted() || viewer.animations.isPanRunning()) {
          this._updateFrame = requestAnimationFrame(flush);
          return;
        }
        for (const pending of this._updates.splice(0)) {
          try {
            if (this._active(viewer)) pending.update();
            pending.resolve();
          } catch (error) { pending.reject(error); }
        }
      };
      if (!this._updateFrame) this._updateFrame = requestAnimationFrame(flush);
    });
  }

  _replaceEntry(viewer, entry, images) {
    const items = viewer.options.dataSource;
    const position = items.indexOf(entry);
    if (position < 0) return;
    let current = items[viewer.currIndex];
    const oldLength = items.length;
    items.splice(position, 1, ...images);
    if (current === entry) {
      current = images.length ? images[this._direction < 0 ? images.length - 1 : 0]
        : items[this._direction < 0 ? position - 1 : position];
    }
    // Inserting album images shifts cached indices; discard detached stale contents.
    // Refreshing the three visible holders below handles their own destruction.
    if (images.length !== 1) {
      for (let index = position; index < Math.max(oldLength, items.length); index++) {
        const content = viewer.contentLoader.getContentByIndex(index);
        if (content && !content.hasSlide) {
          content.destroy();
          viewer.contentLoader.removeByIndex(index);
        }
      }
    }
    const nextIndex = items.indexOf(current);
    const affected = images.length === 1 ? [position]
      : [nextIndex - 1, nextIndex, nextIndex + 1].filter(index => index >= position);
    this._refreshSlides(viewer, nextIndex, affected);
  }

  _refreshSlides(viewer, index, indices) {
    const slide = viewer.currSlide;
    const selected = slide?.data;
    // A loading or error placeholder sits at zoom 1; carrying that over would
    // open the loaded image at natural size instead of fitted.
    const zoom = slide?.isZoomable() ? slide.currZoomLevel : 0;
    const pan = slide ? { ...slide.pan } : null;
    this._refreshing = true;
    try {
      if (index !== viewer.currIndex) viewer.goTo(index);
      for (const neighbor of indices) {
        if (neighbor >= 0 && neighbor < viewer.getNumItems()) viewer.refreshSlideContent(neighbor);
      }
      if (selected === viewer.options.dataSource[index] && slide !== viewer.currSlide && zoom > 0) {
        viewer.currSlide.zoomTo(zoom, undefined, 0);
        viewer.currSlide.panTo(pan.x, pan.y);
      }
      this._previousIndex = index;
    } finally {
      this._refreshing = false;
    }
    this._onChange(viewer);
  }

  _restorePosition(entry, container) {
    const anchor = entry.anchor?.() || entry.trigger;
    if (!anchor?.isConnected) return;
    const focus = (node) => {
      const tabindex = node.getAttribute('tabindex');
      if (tabindex === null) node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
      if (tabindex === null) node.removeAttribute('tabindex');
    };
    if (entry === this._initialEntry) {
      focus(anchor);
      return;
    }
    const scroller = container.closest('.main');
    if (!scroller) return;
    const controller = new AbortController();
    this._restoreController = controller;
    let frame = 0;
    let focused = null;
    const update = () => {
      frame = 0;
      if (!this._sameArticle() || this.app.modalShown || !container.isConnected) {
        controller.abort();
        return;
      }
      let current = entry.anchor?.();
      if (!current?.isConnected) {
        controller.abort();
        return;
      }
      renderChunksAround(current);
      if (current.tagName === 'IMG' && !current.offsetHeight) current = current.closest('.inlinePreviewSlot');
      if (!current) return;
      scroller.scrollTop = computeCenteredScrollTop({
        top: offsetTopWithin(current, scroller),
        height: current.offsetHeight,
        viewportHeight: scroller.clientHeight,
        maxScroll: scroller.scrollHeight - scroller.clientHeight,
      });
      if (current.tagName === 'IMG' && current.offsetHeight && focused !== current) {
        focus(current);
        focused = current;
      }
    };
    const schedule = () => {
      if (!controller.signal.aborted && !frame) frame = requestAnimationFrame(update);
    };
    // Lazy images and closed chunks settle after the first scroll. Recenter only
    // until the user adopts the reading position, with a bounded cleanup deadline.
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
    const sizeObserver = new ResizeObserver(schedule);
    sizeObserver.observe(container);
    container.addEventListener('load', schedule, { capture: true, signal: controller.signal });
    for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
      window.addEventListener(event, () => controller.abort(), { capture: true, once: true, signal: controller.signal });
    }
    const timeout = setTimeout(() => controller.abort(), 10000);
    controller.signal.addEventListener('abort', () => {
      observer.disconnect();
      sizeObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(timeout);
    }, { once: true });
    schedule();
  }

  _cancelPending() {
    this._closing = true;
    this._controller?.abort();
    if (this._updateFrame) cancelAnimationFrame(this._updateFrame);
    this._updateFrame = 0;
    for (const pending of this._updates || []) pending.resolve();
    this._updates = [];
    this._tasks?.clear();
  }

  close({ restore = true } = {}) {
    this._restoreOnClose = this._restoreOnClose && restore;
    this._cancelPending();
    this._viewer?.close();
  }

  destroy() {
    this._restoreController?.abort();
    this.close({ restore: false });
    this.app.view.screenRoot.removeEventListener('previewimage', this._onPreview);
    this.app.buf.removeEventListener('screenSettled', this._onSettled);
  }
}
