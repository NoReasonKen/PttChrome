// The page stack under an article opened from an easy-reading article list
// (#25, #28). The list stays alive underneath as a StackListLayer. Leaving the
// article reveals it, PTT's real leave is sent through the usual Back path, and
// once the list session has presented the real list and the reader is idle,
// the real list takes over at the layer's reading position.
//
// ArticleGestures owns the surfaces that slide away; this module owns the
// stack, the layer and the handoff.
import { readEffectivePrefs } from './pref_storage';
import { sameBoard } from './screen_titles';
import { createPageStack, pushPage, popPage, revealTarget, handoffStep } from './page_stack';
import { StackListLayer, cardIdentity, findCard } from './stack_list_layer';
import { EMPTY_TOOLBAR_CONTEXT } from './mobile_toolbar';
import { searchGateFacts } from './article_search';
import { isSearchResultsFrame } from './search_results_screen';
import { readSearchResultsContext } from './search_results_context';

// Input on a usable layer stays on the layer; nothing reaches the terminal.
const LOCAL_INPUT = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'contextmenu', 'dblclick'];

function articleIdentity(core) {
  const key = core.easyReading?._articleKey;
  const board = core.view._articleBoard;
  return key && board ? board + '\n' + key : null;
}

export class ArticleStack {
  constructor(core) {
    this.core = core;
    this.stack = createPageStack();
    this.pending = null;
    this.layer = null;
    this.identity = null;
    this.handoff = null;
  }

  // An article is about to be opened from the shown article list.
  captureList() {
    this.clear();
    const core = this.core;
    const board = core.listSession?._boardName;
    if (!core.mobile || !board) return;
    // Search results stack with their own return route later (#33). The legacy
    // caption is also an ordinary list's; it means results only after a
    // verified search on this board.
    const facts = searchGateFacts(core);
    if (facts && isSearchResultsFrame(facts, board, !!readSearchResultsContext(core, board))) return;
    const layer = StackListLayer.capture(core.view);
    if (!layer) return;
    // The list's own toolbar, shown without actions while it is only revealed.
    const appBar = core._screenContext?.appBar;
    this.pending = { board, layer, appBar, title: document.querySelector('#mobileAppBar .mobileAppBarTitle')?.textContent || board };
  }

  // The article opened from that list was entered. Only a matching article
  // keeps the list as its lower page; anything else starts a new base.
  enterArticle() {
    const pending = this.pending;
    this.pending = null;
    const identity = articleIdentity(this.core);
    const board = this.core.view._articleBoard;
    if (!pending || !identity || !sameBoard(pending.board, board)) {
      pending?.layer.hide();
      this._discard();
      this.stack = pushPage(createPageStack(), { kind: 'article', board });
      return;
    }
    this._discard();
    this.layer = pending.layer;
    this.title = pending.title;
    this.appBar = pending.appBar;
    this.identity = identity;
    this.stack = pushPage(pushPage(createPageStack(), { kind: 'articleList', board: pending.board, layer: true }),
      { kind: 'article', board }, { fromBelow: true });
  }

  // The current article or the connection changed: the lower page no longer
  // belongs to what is on screen.
  update() {
    if (this.handoff || !this.layer) return;
    if (!this.core.conn?.isConnected || articleIdentity(this.core) !== this.identity) this._discard();
  }

  clear() {
    if (this.handoff) return;
    this.pending?.layer.hide();
    this.pending = null;
    this._discard();
  }

  _discard() {
    this.layer?.hide();
    this.layer = null;
    this.identity = null;
    this.stack = createPageStack();
  }

  // The live list that Back from this article may reveal, or null.
  revealable() {
    this.update();
    const layer = this.layer;
    return layer && revealTarget(this.stack) && layer.matchesViewport() ? layer : null;
  }

  // While a layer is only revealed, the toolbar shows the list without its
  // actions; they return once the real list is usable.
  toolbarContext() {
    if (!this.handoff) return null;
    return { ...EMPTY_TOOLBAR_CONTEXT, appBar: this.handoff.appBar || EMPTY_TOOLBAR_CONTEXT.appBar };
  }

  get handingOff() {
    return !!this.handoff;
  }

  // The article has slid away. `send` sends PTT's leave and returns whether it
  // was sent; `finish` restores the surfaces once the real page takes over;
  // `cancel` brings the article back when the leave was not sent.
  begin({ send, finish, cancel, hint }) {
    const core = this.core;
    const layer = this.revealable();
    const h = this.handoff = {
      layer, board: this.stack.pages[this.stack.pages.length - 1]?.board || core.view._articleBoard,
      identity: articleIdentity(core), appBar: layer ? this.appBar : null,
      sentAt: performance.now(), presentedAt: null, touches: 0, lastScrollAt: -Infinity,
      timer: null, listeners: [], finish, hint
    };
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      h.listeners.push(() => target.removeEventListener(type, fn, options));
    };
    if (layer) {
      layer.show(true);
      const local = event => {
        event.stopPropagation();
        if (event.type === 'click' || event.type === 'contextmenu') event.preventDefault();
        // A tap on an article is remembered by identity; the last tap wins.
        const card = event.type === 'click' && event.target.closest?.('.listCardBody') && event.target.closest('.listCard');
        if (card) h.tap = cardIdentity(card);
      };
      for (const type of LOCAL_INPUT) listen(layer.el, type, local);
      const touches = event => {
        h.touches = event.touches.length;
        this._step();
      };
      listen(layer.el, 'touchstart', touches, true);
      listen(layer.el, 'touchend', touches, true);
      listen(layer.el, 'touchcancel', touches, true);
      listen(layer.el, 'scroll', () => {
        h.lastScrollAt = performance.now();
        this._step();
      }, { capture: true, passive: true });
    }
    listen(core.conn, 'close', () => this._end('disconnected'));
    listen(core.buf, 'screenSettled', () => this._landed());
    core._refreshScreenContext?.();
    let sent = false;
    try {
      sent = send();
    } finally {
      if (!sent) {
        this._cleanup();
        layer?.show(false);
        cancel();
      }
    }
    if (sent) this._step();
    return sent;
  }

  // The list session presented a real article list (rebuilt, scrolled and
  // positioned).
  listPresented() {
    const h = this.handoff;
    const core = this.core;
    if (!h || h.presentedAt != null || core.buf.pageState !== 2 || core.listSession?.state !== 'active') return;
    if (!sameBoard(core.listSession._boardName, h.board)) return this._end('unexpected');
    h.presentedAt = performance.now();
    this._step();
  }

  // PTT answered with something other than the article list this leave expects.
  _landed() {
    const h = this.handoff;
    const core = this.core;
    if (!h || h.presentedAt != null) return;
    const pageState = core.buf.pageState;
    if (pageState === 3 && articleIdentity(core) === h.identity) return;
    if (pageState === 2 && readEffectivePrefs().enableEasyReadingList) return;
    this._end('unexpected');
  }

  _step() {
    const h = this.handoff;
    if (!h) return;
    clearTimeout(h.timer);
    const next = handoffStep({ ...h, now: performance.now() });
    if (next.action === 'swap') return this._end('presented');
    if (next.action === 'timeout') return this._end('timeout');
    h.timer = setTimeout(() => this._step(), next.ms);
  }

  _cleanup() {
    const h = this.handoff;
    if (!h) return;
    clearTimeout(h.timer);
    h.listeners.forEach(remove => remove());
    this.handoff = null;
  }

  _end(how) {
    const h = this.handoff;
    if (!h) return;
    const core = this.core;
    if (how === 'presented' && h.layer) h.layer.alignReal(core.view.componentScreen, core.view.mainDisplay);
    this._cleanup();
    // The revealed page is now PTT's real page; its layer is spent.
    this.layer?.hide();
    this.layer = this.identity = null;
    this.stack = popPage(this.stack).stack;
    h.finish();
    core._refreshScreenContext?.();
    if (how === 'timeout' && h.hint) h.hint();
    if (how === 'presented' && h.tap) this._openTapped(h.tap);
  }

  // Open the remembered article on the refreshed list, found by identity (its
  // number may have moved), through the list's own verified open path.
  _openTapped(id) {
    const core = this.core;
    const card = findCard(core.view.mainDisplay, id);
    const body = card?.querySelector('.listCardBody');
    if (!body) {
      core.view.flashListHint?.('這篇文章已經不在列表中', 4000);
      return;
    }
    body.scrollIntoView({ block: 'nearest' });
    const r = body.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const type of ['mousedown', 'mouseup', 'click']) body.dispatchEvent(new MouseEvent(type, at));
  }
}
