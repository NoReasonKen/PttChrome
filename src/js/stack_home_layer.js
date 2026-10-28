// The home dashboard kept underneath an article list entered from it (#31).
// The dashboard is a client view, so its layer is a second live render of the
// same view over the same controller state, forced visible. Its actions are not
// performed: a tapped board is only remembered for after the swap.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { HomeDashboard as HomeDashboardView } from '../components/HomeDashboard/index.jsx';
import { applyHomeAnchor, homeAnchorOf } from './home_dashboard';
import { i18n } from './i18n';
import { setUsable } from './stack_layer';

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
    this.parent = core.view.mainDisplay.parentNode;
    // Beside the terminal's surfaces, under the page that slides away from it.
    // The real dashboard sits above the terminal, so it is held hidden while
    // this copy is shown (`stackHoldHome`).
    this.el = document.createElement('div');
    setUsable(this.el, false);
    Object.assign(this.el.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '2' });
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

  // The dashboard is a live view laid out by CSS: it follows a width change by
  // itself, and its position is restored by entry when shown.
  fitViewport() {
    return true;
  }

  // Visible, and usable when `usable`: it scrolls, and its input stays local.
  show(usable) {
    if (!this.el.isConnected) {
      this.parent.appendChild(this.el);
      if (this.root) applyHomeAnchor(this.root, this.anchor);
    }
    document.body.classList.add('stackHoldHome');
    setUsable(this.el, usable);
  }

  hide() {
    if (this.el.isConnected) document.body.classList.remove('stackHoldHome');
    this.el.remove();
    setUsable(this.el, false);
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

  // The board must still be on the real dashboard. A refused open gives the
  // dashboard's own notice, or says why when it refuses silently.
  openTapped(core, id) {
    const home = core.homeDashboard;
    const shown = [...(home.rootElement()?.querySelectorAll(BOARD_ENTRY) || [])].some(entry => boardOf(entry) === id.board);
    if (!shown) return core.view.flashListHint?.(i18n('stack_boardGone'), 4000);
    if (!home.openBoard(id.board) && home.state.fetching) core.view.flashListHint?.(i18n('home_updating'), 4000);
  }

  destroy() {
    this.hide();
    this.reactRoot.unmount();
  }
}
