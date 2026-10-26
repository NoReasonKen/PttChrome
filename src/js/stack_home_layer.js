// The home dashboard kept underneath an article list entered from it (#31).
// The dashboard is a client view, so its layer is a second live render of the
// same view over the same controller state, forced visible. Its actions are not
// performed: a tapped board is only remembered for after the swap.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { HomeDashboard as HomeDashboardView } from '../components/HomeDashboard/index.jsx';
import { applyHomeAnchor, homeAnchorOf } from './home_dashboard';

const BOARD_ENTRY = '[data-home-board], [data-home-recent]';

function boardOf(entry) {
  return entry.getAttribute('data-home-board') ?? entry.getAttribute('data-home-recent');
}

export class StackHomeLayer {
  // Render the shown dashboard as a layer, or null when it is not shown.
  static capture(core) {
    const home = core.homeDashboard;
    const real = home?.rootElement();
    if (!home?.state.visible || !real) return null;
    return new StackHomeLayer(core, home, real);
  }

  constructor(core, home, real) {
    this.width = window.innerWidth;
    this.parent = core.view.mainDisplay.parentNode;
    // A zero-size stacking context above the real dashboard (z-index 140), so
    // the real one can never cover this copy before the swap.
    this.el = document.createElement('div');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.inert = true;
    Object.assign(this.el.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '145' });
    const view = {
      get state() {
        return { ...home.state, visible: true };
      },
      onChange: fn => home.onChange(state => fn({ ...state, visible: true })),
      openBoard: () => false,
      openMail: () => false,
      dismiss: () => {},
      refresh: () => false
    };
    const host = { homeDashboard: view, mobile: core.mobile, onMobileChange: fn => core.onMobileChange(fn) };
    this.reactRoot = createRoot(this.el);
    flushSync(() => this.reactRoot.render(createElement(HomeDashboardView, { pttchrome: host, layer: true })));
    this.root = this.el.querySelector('.homeDashboard');
    this.root?.setAttribute('data-stack-layer', 'home');
    this.anchor = homeAnchorOf(real);
  }

  matchesViewport() {
    return this.width === window.innerWidth;
  }

  // Visible, and usable when `usable`: it scrolls, and its input stays local.
  show(usable) {
    if (!this.el.isConnected) {
      this.parent.appendChild(this.el);
      if (this.root) applyHomeAnchor(this.root, this.anchor);
    }
    this.el.inert = !usable;
    this.el.removeAttribute('aria-hidden');
    if (!usable) this.el.setAttribute('aria-hidden', 'true');
  }

  hide() {
    this.el.remove();
    this.el.inert = true;
    this.el.setAttribute('aria-hidden', 'true');
  }

  // The board a tap on this layer chose, or null.
  tapOf(event) {
    const entry = event.type === 'click' && event.target.closest?.(BOARD_ENTRY);
    return entry ? { board: boardOf(entry) } : null;
  }

  // Put the real dashboard at this layer's reading position. It is also the
  // position a pending restore of the dashboard returns to, since the reader
  // has used this layer since then.
  alignReal(core) {
    if (!this.root) return false;
    const record = homeAnchorOf(this.root);
    core.homeDashboard.requestViewportRestore(record);
    return applyHomeAnchor(core.homeDashboard.rootElement(), record);
  }

  // A refused open gives the dashboard's own notice.
  openTapped(core, id) {
    core.homeDashboard.openBoard(id.board);
  }

  destroy() {
    this.hide();
    this.reactRoot.unmount();
  }
}
