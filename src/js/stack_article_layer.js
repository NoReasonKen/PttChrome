// A live article kept underneath the results of an article shortcut search
// (#49): a second instance of the shared screen renderer re-renders the
// article's whole last presented frame over the article's box, scrollable at
// its reading position, so revealing it shows the article at once.
import { ScreenCopyLayer, setUsable } from './stack_layer';
import { PAGE } from './page_stack';

// The article row at the top of `scroller` and its offset from that top.
function topRow(scroller) {
  const top = scroller.getBoundingClientRect().top;
  for (const row of scroller.querySelectorAll('[type="bbsrow"][srow]')) {
    const r = row.getBoundingClientRect();
    if (r.height && r.bottom > top + 1) return { srow: row.getAttribute('srow'), offset: r.top - top };
  }
  return null;
}

// Scroll `scroller` so that `anchor`'s row is back at its offset.
function scrollToRow(scroller, anchor) {
  const row = anchor && scroller.querySelector(`[type="bbsrow"][srow="${anchor.srow}"]`);
  if (!row) return false;
  scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
  return true;
}

export class StackArticleLayer extends ScreenCopyLayer {
  // Render `view`'s current article frame as a live copy over the article's
  // box. Returns null when the view shows no article frame.
  static capture(view) {
    const frame = view.componentScreen?.props;
    const main = view.mainDisplay;
    if (!frame?.lines || !main) return null;
    const rect = main.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return new StackArticleLayer(view, rect, frame);
  }

  constructor(view, rect, frame) {
    super(view, frame, PAGE.ARTICLE);
    const main = view.mainDisplay;
    this._hold = () => {
      this.held = true;
    };
    this._render(rect, frame.forceWidth);
    this.scrollTop = main.scrollTop;
    this.scrollHeight = main.scrollHeight;
    // The reading position by row, for a render at another width.
    this.anchor = topRow(main);
  }

  _render(rect, forceWidth) {
    this._renderOver(rect, forceWidth, this.frame.enableLinkInlinePreview, this.frame.enhance);
  }

  // Ready to be revealed at the current width; a width change renders the
  // stored frame again over the article's box.
  fitViewport() {
    if (this.width === window.innerWidth) return true;
    const rect = this.view.mainDisplay.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (this.el.isConnected) this.anchor = topRow(this.el);
    this._render(rect, this.view.chh);
    this.scrollTop = null;
    this.scrollHeight = 0;
    if (this.el.isConnected) scrollToRow(this.el, this.anchor);
    return true;
  }

  // Visible, and usable when `usable`: it scrolls, and its input stays local.
  show(usable) {
    if (!this.el.isConnected) {
      this.parent.appendChild(this.el);
      this._place();
      // The renderer's commit and layout settle once the layer is attached:
      // each change of its content puts it back at the reading position, until
      // the reader scrolls it.
      this.held = false;
      this.resizes = new ResizeObserver(() => !this.held && this._place());
      for (const child of this.el.children) if (child !== this.spacer) this.resizes.observe(child);
      this.el.addEventListener('pointerdown', this._hold);
      this.el.addEventListener('wheel', this._hold, { passive: true });
    }
    setUsable(this.el, usable);
  }

  _place() {
    this._fitEnd();
    if (this.scrollTop != null) this.el.scrollTop = this.scrollTop;
    else scrollToRow(this.el, this.anchor);
  }

  // The real article ends with rows of its own below the screen (the last row
  // bar): room for them keeps the reading position near the end reachable.
  _fitEnd() {
    if (!this.spacer) {
      this.spacer = document.createElement('div');
      this.spacer.setAttribute('aria-hidden', 'true');
    }
    this.spacer.style.height = '0';
    this.el.appendChild(this.spacer);
    this.spacer.style.height = Math.max(0, this.scrollHeight - this.el.scrollHeight) + 'px';
  }

  hide() {
    this.resizes?.disconnect();
    this.resizes = null;
    this.el.removeEventListener('pointerdown', this._hold);
    this.el.removeEventListener('wheel', this._hold);
    super.hide();
  }

  // Put the real article at this layer's reading position: the same row at
  // the same offset from the top of the view.
  alignReal(core) {
    return scrollToRow(core.view.mainDisplay, topRow(this.el));
  }

  // An article layer remembers no tap: nothing on it opens a page.
  tapOf() {
    return null;
  }
}
