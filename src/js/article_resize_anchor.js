import { recordFor } from './reading_record';

const viewport = () => typeof window === 'undefined' ? '' : `${window.innerWidth}:${window.innerHeight}`;

// Retain the reading position from BEFORE viewport wrapping and dvh image
// changes. Measuring only when the debounced terminal resize starts is late.
export class ArticleResizeAnchor {
  constructor(core) {
    this.core = core;
    this.size = viewport();
    this.last = null;
    this.pending = null;
    this.owned = null;
    this.listeners = [];
  }

  attach(capture) {
    const listen = (target, type, fn, options) => {
      target?.addEventListener(type, fn, options);
      this.listeners.push(() => target?.removeEventListener(type, fn, options));
    };
    listen(window, 'resize', capture);
    listen(window.visualViewport, 'resize', capture);
    listen(this.core.view.mainDisplay, 'scroll', () => this.remember(), { passive: true });
    for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
      listen(window, type, () => {
        if (this.pending) this.pending.restore = false;
        if (this.owned) this.owned.restore = false;
      }, { passive: true, capture: true });
    }
  }

  remember() {
    if (this.pending || this.owned || (this.last && this.size !== viewport())) return;
    const article = recordFor(this.core).current?.().article;
    if (!article?.easy) return;
    this.last = { ...article };
    this.size = viewport();
  }

  capture() {
    if (this.pending || this.owned || this.size === viewport()) return;
    const bookmark = recordFor(this.core).begin('article-resize');
    if (this.last) bookmark.article = { ...this.last };
    this.pending = { bookmark, restore: true };
  }

  take() {
    this.owned = this.pending || {
      bookmark: recordFor(this.core).begin('article-resize'), restore: true,
    };
    this.pending = null;
    return this.owned;
  }

  finish(item, outcome) {
    if (!item) return;
    recordFor(this.core).end(item.bookmark, item.restore ? outcome : 'cancel');
    this.pending = null;
    this.owned = null;
    this.size = viewport();
    this.last = outcome === 'done' && item.restore ? item.bookmark.article : null;
    if (outcome === 'done' && item.restore) this.core.easyReading._advanceScrollRestore();
  }

  finishLocal() { if (this.pending && !this.owned) this.finish(this.pending, 'done'); }

  cancel() {
    this.finish(this.owned || this.pending, 'cancel');
    this.last = null;
    this.size = viewport();
  }

  destroy() { this.listeners.splice(0).forEach(remove => remove()); }
}
