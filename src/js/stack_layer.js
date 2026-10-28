// What the live page layers of the stack (#25) share: a layer is revealed
// inert while the page above slides away, and usable during the handoff.
import { renderScreen } from './term_ui';

// How long a stack notice stays, such as a tapped entry that is gone.
export const STACK_NOTICE_MS = 4000;

// Inert and hidden from assistive technology unless `usable`.
export function setUsable(el, usable) {
  el.inert = !usable;
  if (usable) el.removeAttribute('aria-hidden');
  else el.setAttribute('aria-hidden', 'true');
}

// A second instance of the shared screen renderer that re-renders a page's
// last presented frame over the real screen's box. It is rendered when the
// page is left, so the reveal only attaches it; until then it stays out of the
// document, so a page read has one screen surface.
export class ScreenCopyLayer {
  constructor(view, frame, kind) {
    const main = view.mainDisplay;
    this.view = view;
    this.frame = frame;
    this.el = document.createElement('div');
    // Same classes and inline geometry as the real surface, so its CSS applies.
    this.el.className = main.className;
    this.el.style.cssText = main.style.cssText;
    this.el.setAttribute('data-stack-layer', kind);
    setUsable(this.el, false);
    this.parent = main.parentNode;
  }

  // Render the stored frame over `rect`, the real screen's box.
  _renderOver(rect, forceWidth, enableLinkInlinePreview, enhance) {
    this.width = window.innerWidth;
    Object.assign(this.el.style, {
      position: 'absolute', left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', height: rect.height + 'px', margin: '0', translate: 'none', zIndex: '2'
    });
    this.screen = renderScreen(this.frame.lines, forceWidth, enableLinkInlinePreview, false, this.el, enhance);
  }

  hide() {
    this.el.remove();
    setUsable(this.el, false);
  }

  destroy() {
    this.hide();
    this.screen?.release();
    this.screen = null;
  }
}
