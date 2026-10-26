// The page stack of mobile easy reading (#25, #28, #31). A page opened from
// the shown page is stacked on it, and that page stays alive underneath as a
// live layer: an article list under its article, the home dashboard or a board
// list under the board's article list. Back reveals the layer, PTT's real Back
// is sent through the usual path, and once the owning session has presented the
// real page and the reader is idle, the real page takes over at the layer's
// reading position.
//
// ArticleGestures owns the surfaces that slide away; this module owns the
// stack, the layers and the handoff.
import { readEffectivePrefs } from './pref_storage';
import { sameBoard } from './screen_titles';
import { createPageStack, pushPage, popPage, revealTarget, withLayer, handoffStep } from './page_stack';
import { StackListLayer } from './stack_list_layer';
import { StackHomeLayer } from './stack_home_layer';
import { EMPTY_TOOLBAR_CONTEXT } from './mobile_toolbar';
import { searchGateFacts } from './article_search';
import { isSearchResultsFrame } from './search_results_screen';
import { readSearchResultsContext } from './search_results_context';

// Input on a usable layer stays on the layer; nothing reaches the terminal.
const LOCAL_INPUT = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'contextmenu', 'dblclick'];

function openArticleKey(core) {
  const key = core.easyReading?._articleKey;
  const board = core.view._articleBoard;
  return key && board ? board + '\n' + key : null;
}

export class NavigationStack {
  constructor(core) {
    this.core = core;
    this.stack = createPageStack();
    // The live layer of each page that has one, with what the reveal shows of
    // it (title, App Bar), by depth in the stack.
    this.lower = [];
    this.pending = null;
    this.identity = null;
    this.handoff = null;
  }

  _top() {
    return this.stack.pages[this.stack.pages.length - 1] || null;
  }

  // An entry is about to be opened from the shown page of `kind`, the page
  // that a Back from it may reveal.
  _capture(kind, board, layer) {
    this.dropPending();
    if (!layer) return;
    const title = document.querySelector('#mobileAppBar .mobileAppBarTitle')?.textContent || board;
    this.pending = { kind, board, layer, appBar: this.core._screenContext?.appBar, title };
  }

  // The legacy caption is also an ordinary list's; it means results only after
  // a verified search on this board.
  _showsSearchResults() {
    const core = this.core;
    const board = core.listSession?._boardName;
    const facts = searchGateFacts(core);
    return !!board && !!facts && isSearchResultsFrame(facts, board, !!readSearchResultsContext(core, board));
  }

  // An article is about to be opened from the shown article list, search
  // results included (#33).
  captureList() {
    const core = this.core;
    const board = core.listSession?._boardName;
    if (!core.mobile || !board) return this.dropPending();
    this._capture('articleList', board, StackListLayer.capture(core.view, 'article'));
  }

  // `board` is about to be opened from the shown home dashboard. Its article
  // list stacks only under article-list easy reading.
  captureHome(board) {
    if (!this._stacksBoard(board)) return this.dropPending();
    this._capture('home', board, StackHomeLayer.capture(this.core));
  }

  // `board` is about to be opened from the shown board list.
  captureBoardList(board) {
    if (!this._stacksBoard(board)) return this.dropPending();
    this._capture('boardList', board, StackListLayer.capture(this.core.view, 'board'));
  }

  _stacksBoard(board) {
    return !!(this.core.mobile && board && readEffectivePrefs().enableEasyReadingList);
  }

  // The open was abandoned: the captured page is no lower page of anything.
  dropPending() {
    this.takePending()?.destroy();
  }

  // The same, but the caller takes over the captured page's layer.
  takePending() {
    const layer = this.pending?.layer || null;
    this.pending = null;
    return layer;
  }

  // Stack the captured page under the page just entered when it is where that
  // page came from; otherwise the entry starts a new base.
  _enter(page, opensFrom) {
    const pending = this.pending;
    this.pending = null;
    if (!pending || !opensFrom(pending)) {
      pending?.layer?.destroy();
      this._discard();
      this.stack = pushPage(createPageStack(), page);
      return;
    }
    const top = this._top();
    if (!top || top.kind !== pending.kind || !sameBoard(top.board, pending.board)) {
      this._discard();
      this.stack = pushPage(createPageStack(), { kind: pending.kind, board: pending.board });
    }
    const depth = this.stack.pages.length - 1;
    this.stack = withLayer(this.stack);
    this.lower[depth]?.layer?.destroy();
    this.lower[depth] = pending;
    this.stack = pushPage(this.stack, page, { fromBelow: true });
  }

  // The article opened from the article list was entered. Only the matching
  // article keeps the list as its lower page.
  enterArticle() {
    const identity = openArticleKey(this.core);
    const board = this.core.view._articleBoard;
    this._enter({ kind: 'article', board },
      pending => pending.kind === 'articleList' && !!identity && sameBoard(pending.board, board));
    this.identity = identity;
  }

  // An article list is presented outside a handoff. A board opened from the
  // dashboard or a board list keeps that page as its lower page.
  _enterList(board) {
    const top = this._top();
    if (top?.kind === 'articleList' && sameBoard(top.board, board)) return;
    // Back to the list without a handoff: the article's page is gone.
    if (top?.kind === 'article' && sameBoard(top.board, board) && this.stack.pages.length > 1) {
      this._spend(this.stack.pages.length - 2);
      this.stack = popPage(this.stack).stack;
      return;
    }
    // An article being opened from this list stays captured.
    if (this.pending?.kind === 'articleList') return;
    this._enter({ kind: 'articleList', board },
      pending => (pending.kind === 'home' || pending.kind === 'boardList') && sameBoard(pending.board, board));
  }

  // The current article or the connection changed: the lower pages no longer
  // belong to what is on screen.
  update() {
    if (this.handoff || !this.lower.some(Boolean)) return;
    if (!this.core.conn?.isConnected) return this._discard();
    const top = this._top();
    if (top?.kind !== 'article' || openArticleKey(this.core) === this.identity) return;
    // Another article (the next one, a thread hop): the list's layer showed
    // where the first one was opened, but the pages below the list still hold.
    if (this.stack.pages.length < 2) return this._discard();
    this._spend(this.stack.pages.length - 2);
    this.stack = pushPage(popPage(this.stack).stack, top, { fromBelow: true });
    this.identity = null;
  }

  // The connection closed: PTT's route behind every stacked page is gone, and
  // so is what was captured on the way to a page.
  disconnected() {
    this._end('disconnected');
    this.clear();
  }

  clear() {
    if (this.handoff) return;
    this.dropPending();
    this._discard();
  }

  // Drop the layers from `depth` up.
  _spend(depth) {
    for (const lower of this.lower.slice(depth)) lower?.layer?.destroy();
    this.lower.length = Math.min(this.lower.length, depth);
  }

  _discard() {
    this._spend(0);
    this.identity = null;
    this.stack = createPageStack();
  }

  _revealed() {
    this.update();
    // Back from search results follows search return history, and they are not
    // the list the board was opened with: they reveal nothing (#33).
    if (this._top()?.kind === 'articleList' && this._showsSearchResults()) return null;
    const target = revealTarget(this.stack);
    const lower = target && this.lower[this.stack.pages.length - 2];
    return lower?.layer.matchesViewport() ? { page: target, ...lower } : null;
  }

  // The live page that Back from the current page may reveal, or null.
  revealable() {
    return this._revealed()?.layer || null;
  }

  // The revealed page's title, shown while the current page slides away.
  get title() {
    return this._revealed()?.title || '';
  }

  // While a layer is only revealed, the toolbar shows that page without its
  // actions; they return once the real page is usable.
  toolbarContext() {
    if (!this.handoff) return null;
    return { ...EMPTY_TOOLBAR_CONTEXT, appBar: this.handoff.appBar || EMPTY_TOOLBAR_CONTEXT.appBar, locked: true };
  }

  get handingOff() {
    return !!this.handoff;
  }

  // The current page has slid away. `send` sends PTT's Back and returns
  // whether it was sent; `finish` restores the surfaces once the real page
  // takes over; `cancel` brings the current page back when Back was not sent.
  begin({ send, finish, cancel, hint }) {
    const core = this.core;
    const revealed = this._revealed();
    const layer = revealed?.layer || null;
    const h = this.handoff = {
      layer, target: revealed?.page.kind || 'articleList',
      board: this._top()?.board || core.view._articleBoard,
      identity: openArticleKey(core), appBar: revealed?.appBar || null,
      sentAt: performance.now(), presentedAt: null, touches: 0, lastScrollAt: -Infinity,
      timer: null, listeners: [], finish, hint, tap: null
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
        // A tap on an entry is remembered by identity; the last tap wins.
        const id = layer.tapOf(event);
        if (id) h.tap = id;
      };
      for (const type of LOCAL_INPUT) listen(layer.el, type, local);
      const touches = event => {
        h.touches = event.touches.length;
        this._step();
      };
      // A finger's later events go to its first target, which a re-render may
      // have removed from the layer by then.
      listen(layer.el, 'touchstart', event => {
        touches(event);
        listen(event.target, 'touchend', touches);
        listen(event.target, 'touchcancel', touches);
      }, true);
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

  // The owning session presented a real page of `kind`: an article list
  // (rebuilt, scrolled and positioned), a board list, or the home dashboard.
  pagePresented(kind) {
    const h = this.handoff;
    const core = this.core;
    if (!h) {
      if (kind === 'articleList' && core.listSession?._boardName) this._enterList(core.listSession._boardName);
      // Back on the dashboard or a board list some other way: what was stacked
      // above it, or captured on the way to a board, no longer holds.
      else if (kind !== 'articleList') this.clear();
      return;
    }
    if (h.presentedAt != null || kind !== h.target) return;
    if (kind === 'articleList') {
      if (core.buf.pageState !== 2 || core.listSession?.state !== 'active') return;
      if (!sameBoard(core.listSession._boardName, h.board)) return this._end('unexpected');
    }
    h.presentedAt = performance.now();
    this._step();
  }

  // PTT answered with something other than the page this Back expects.
  _landed() {
    const h = this.handoff;
    const core = this.core;
    if (!h || h.presentedAt != null) return;
    const pageState = core.buf.pageState;
    if (h.target === 'articleList') {
      if (pageState === 3 && openArticleKey(core) === h.identity) return;
      if (pageState === 2 && readEffectivePrefs().enableEasyReadingList) return;
    } else if (pageState === 1 || pageState === 2) {
      // Leaving an article list: the list itself until PTT answers, then the
      // main menu or a board list.
      return;
    }
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
    if (how === 'presented' && h.layer) h.layer.alignReal(core);
    this._cleanup();
    // The revealed page is now PTT's real page; its layer is spent.
    h.layer?.hide();
    this.lower.length = Math.max(0, this.stack.pages.length - 2);
    this.identity = null;
    this.stack = popPage(this.stack).stack;
    h.finish();
    core._refreshScreenContext?.();
    if (how === 'timeout' && h.hint) h.hint();
    if (how === 'presented' && h.tap) h.layer.openTapped(core, h.tap);
    h.layer?.destroy();
  }
}
