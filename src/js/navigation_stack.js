// The page stack of mobile easy reading (#25, #28, #31, #49). A page opened
// from the shown page is stacked on it, and that page stays alive underneath as
// a live layer: an article list under its article, the home dashboard or a
// board list under the board's article list, an article under the results of
// an article shortcut search started from it. Back reveals the layer, PTT's
// real Back is sent through the usual path, and once the owning session has
// presented the real page and the reader is idle, the real page takes over at
// the layer's reading position.
//
// ArticleGestures owns the surfaces that slide away; this module owns the
// stack, the layers and the handoff.
import { readEffectivePrefs } from './pref_storage';
import { OWNER_ARTICLE_LIST } from './list_render_owner';
import { sameBoard } from './screen_titles';
import {
  createPageStack, pushPage, popPage, revealTarget, withLayer, handoffStep, queueBack, takeQueuedBack, dropQueuedBacks, boundLayers,
  pageShown, PAGE
} from './page_stack';
import { StackListLayer } from './stack_list_layer';
import { StackHomeLayer } from './stack_home_layer';
import { StackArticleLayer } from './stack_article_layer';
import { EMPTY_TOOLBAR_CONTEXT } from './mobile_toolbar';
import { searchGateFacts } from './article_search';
import { isSearchResultsFrame } from './search_results_screen';
import { readSearchResultsContext } from './search_results_context';

// Input on a usable layer stays on the layer; nothing reaches the terminal.
const LOCAL_INPUT = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'contextmenu', 'dblclick'];

function countNodes(root) {
  let n = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  while (walker.nextNode()) n++;
  return n;
}

// The board the article list session reads, or null before it has read one.
const listBoard = core => core.listSession?._boardName || null;

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
    this.captured = [];
    this.pending = null;
    this.handoff = null;
  }

  _top() {
    return this.stack.pages[this.stack.pages.length - 1] || null;
  }

  // An entry is about to be opened from the shown page of `kind`, the page
  // that a Back from it may reveal. `ms`: how long the layer took to render.
  // `render` makes the live layer, timed for the debug recording; `id`: an
  // article's identity.
  _capture(kind, board, render, id) {
    this.dropPending();
    const t = performance.now();
    const layer = render();
    const ms = performance.now() - t;
    if (!layer) return;
    const title = document.querySelector('#mobileAppBar .mobileAppBarTitle')?.textContent || board;
    this.pending = { kind, board, id, layer, appBar: this.core._screenContext?.appBar, title };
    this._diagCost(kind, layer.el, ms, this.pending);
  }

  // A debug recording keeps what each live layer costs on the device (#48):
  // its nodes and render time, the nodes of every live layer, the page's own
  // nodes and the JS heap where the browser reports it. Nodes are counted in a
  // later task, once the home dashboard's React render has run; `renderMs`
  // is the synchronous part.
  _diagCost(kind, el, ms, holder) {
    const rec = this.core.debugRecorder;
    if (!rec?.isRecording) return;
    setTimeout(() => {
      const nodes = countNodes(el);
      if (holder) holder.nodes = nodes;
      const memory = performance.memory;
      rec.log('stack.layerCost', {
        kind, nodes, renderMs: Math.round(ms * 10) / 10, depth: this.stack.pages.length,
        liveLayers: this.captured.filter(Boolean).length,
        liveLayerNodes: this.captured.reduce((n, lower) => n + (lower?.nodes || 0), 0),
        pageNodes: countNodes(document.body), heapKB: memory ? Math.round(memory.usedJSHeapSize / 1024) : null
      });
    }, 100);
  }

  // A debug recording keeps each handoff's timeline (#24): the send, each
  // redraw and settle, the presentation and the end, in ms since the send.
  _mark(mark, info) {
    const rec = this.core.debugRecorder;
    const h = this.handoff;
    if (!rec?.isRecording || !h) return;
    rec.log('stack.handoff', { mark, ms: Math.round(performance.now() - h.sentAt), ...info });
  }

  // The legacy caption is also an ordinary list's; it means results only after
  // a verified search on this board.
  _showsSearchResults() {
    const core = this.core;
    const board = listBoard(core);
    const facts = searchGateFacts(core);
    return !!board && !!facts && isSearchResultsFrame(facts, board, !!readSearchResultsContext(core, board));
  }

  // An article is about to be opened from the shown article list, search
  // results included (#33).
  captureList() {
    const core = this.core;
    const board = listBoard(core);
    if (!core.mobile || !board) return this.dropPending();
    this._capture(PAGE.ARTICLE_LIST, board, () => StackListLayer.capture(core.view, 'article'));
  }

  // An article shortcut search is about to start from the shown article
  // (#49): the article stays alive under its results.
  captureArticle() {
    const page = this._articlePage();
    if (!this.core.mobile || !page.id) return this.dropPending();
    this._capture(PAGE.ARTICLE, page.board, () => StackArticleLayer.capture(this.core.view), page.id);
  }

  // `board` is about to be opened from the shown home dashboard. Its article
  // list stacks only under article-list easy reading.
  captureHome(board) {
    if (!this._stacksBoard(board)) return this.dropPending();
    this._capture(PAGE.HOME, board, () => StackHomeLayer.capture(this.core));
  }

  // `board` is about to be opened from the shown board list.
  captureBoardList(board) {
    if (!this._stacksBoard(board)) return this.dropPending();
    this._capture(PAGE.BOARD_LIST, board, () => StackListLayer.capture(this.core.view, 'board'));
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
    let top = this._top();
    // A board list's page names the row it opens, chosen just before.
    if (top?.kind === PAGE.BOARD_LIST && pending.kind === PAGE.BOARD_LIST) {
      top = { ...top, board: pending.board };
      this.stack = { ...this.stack, pages: [...this.stack.pages.slice(0, -1), top] };
    }
    if (!top || top.kind !== pending.kind || !sameBoard(top.board, pending.board) || top.id !== pending.id) {
      this._discard();
      this.stack = pushPage(createPageStack(), { kind: pending.kind, board: pending.board, id: pending.id });
    }
    const depth = this.stack.pages.length - 1;
    this.stack = withLayer(this.stack);
    this.captured[depth]?.layer?.destroy();
    this.captured[depth] = pending;
    this.stack = pushPage(this.stack, page, { fromBelow: true });
    const bounded = boundLayers(this.stack);
    for (const released of bounded.released) {
      this.captured[released]?.layer?.destroy();
      this.captured[released] = undefined;
    }
    this.stack = bounded.stack;
  }

  // The article opened from the article list was entered. Only the matching
  // article keeps the list as its lower page.
  enterArticle() {
    const page = this._articlePage();
    this._enter(page,
      pending => pending.kind === PAGE.ARTICLE_LIST && !!page.id && sameBoard(pending.board, page.board));
  }

  // A board list opened from a board list's row was entered: it keeps that
  // list as its lower page. `folder` is the row it was opened from.
  enterBoardList() {
    const folder = this.pending?.board;
    this._enter({ kind: PAGE.BOARD_LIST, board: folder, folder }, pending => pending.kind === PAGE.BOARD_LIST);
  }

  _articlePage() {
    return { kind: PAGE.ARTICLE, board: this.core.view._articleBoard, id: openArticleKey(this.core) };
  }

  // An article list is presented outside a handoff. A board opened from the
  // dashboard or a board list keeps that page as its lower page, and the
  // results of an article shortcut search keep their source article.
  _enterList(board) {
    // An article being opened from this list stays captured.
    if (this.pending?.kind === PAGE.ARTICLE_LIST) return;
    const shown = { kind: PAGE.ARTICLE_LIST, board, results: this._showsSearchResults() };
    // The search passes its board's list on the way to the results.
    if (this.pending?.kind === PAGE.ARTICLE) {
      if (shown.results) this._enter(shown, pending => sameBoard(pending.board, board));
      return;
    }
    if (this.pending) {
      return this._enter(shown,
        pending => (pending.kind === PAGE.HOME || pending.kind === PAGE.BOARD_LIST) && sameBoard(pending.board, board));
    }
    this._shown(shown);
  }

  // A page reached some other way than from the current page: the stack keeps
  // only what is still the way back from it (#35).
  _shown(page) {
    const { stack, kept } = pageShown(this.stack, page);
    if (stack === this.stack) return;
    this._releaseFrom(kept);
    this.stack = stack;
  }

  // The screen changed: an article reached without being opened from the
  // current page, or a closed connection, leaves the stack.
  update() {
    if (this.handoff) return;
    if (!this.core.conn?.isConnected) return this._discard();
    // An article being opened is entered once its open is bound.
    if (this.pending?.kind === PAGE.ARTICLE_LIST) return;
    const page = this._articlePage();
    if (this.core.buf.pageState !== 3 || !page.id) return;
    this._shown(page);
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

  // Release the captured layers from `depth` up.
  _releaseFrom(depth) {
    for (const lower of this.captured.slice(depth)) lower?.layer?.destroy();
    this.captured.length = Math.min(this.captured.length, depth);
  }

  _discard() {
    this._releaseFrom(0);
    this.stack = createPageStack();
  }

  _revealed() {
    this.update();
    // Search results the stack was not told of: their Back follows search
    // return history, not the page below (#33).
    const top = this._top();
    if (top?.kind === PAGE.ARTICLE_LIST && !top.results && this._showsSearchResults()) return null;
    const target = revealTarget(this.stack);
    const lower = target && this.captured[this.stack.pages.length - 2];
    // Fitting a list layer to a changed width renders it again.
    return lower?.layer.fitViewport() ? { page: target, ...lower } : null;
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

  // A Back made during the handoff runs after the swap (#34), when a page is
  // left to unwind. It replaces a remembered tap either way: the reader's last
  // choice wins.
  queueBack() {
    const h = this.handoff;
    if (!h) return false;
    this.stack = queueBack(this.stack);
    h.tap = null;
    return true;
  }

  // The current page has slid away. `send` sends PTT's Back and returns
  // whether it was sent; `finish` restores the surfaces once the real page
  // takes over; `cancel` brings the current page back when Back was not sent.
  // `level` is the kind of page left: an article, an article list or a board
  // list. An article list with nothing revealed below waits for whatever page
  // PTT shows next (#32).
  begin({ level = PAGE.ARTICLE, send, finish, cancel, hint }) {
    const core = this.core;
    const revealed = this._revealed();
    const layer = revealed?.layer || null;
    const h = this.handoff = {
      layer, target: revealed?.page.kind || (level === PAGE.ARTICLE_LIST ? null : PAGE.ARTICLE_LIST), id: revealed?.page.id,
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
        if (id) {
          h.tap = id;
          this.stack = dropQueuedBacks(this.stack);
        }
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
    listen(core.buf, 'viewUpdate', () => h.presentedAt == null && this._mark('view'));
    // A changed page state settles first, and a session may present its page
    // from it.
    listen(core.buf, 'pageStateSettled', () => this._mark('pageStateSettled', { pageState: core.buf.pageState }));
    listen(core.buf, 'screenSettled', () => {
      this._mark('settled', { pageState: core.buf.pageState });
      this._screenAnswered();
    });
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
    if (sent) {
      this._mark('sent', { level, target: h.target, layer: !!layer });
      this._step();
    }
    return sent;
  }

  // The owning session presented a real page of `kind`: an article list
  // (rebuilt, scrolled and positioned), a board list, the home dashboard, or an
  // article reopened by search return history.
  pagePresented(kind) {
    const h = this.handoff;
    const core = this.core;
    if (!h) {
      if (kind === PAGE.ARTICLE_LIST && listBoard(core)) this._enterList(listBoard(core));
      // Back on the dashboard or a board list some other way: what was stacked
      // above it, or captured on the way to a board, no longer holds.
      else if (kind === PAGE.HOME || kind === PAGE.BOARD_LIST) this.clear();
      // The search returned to its source without results.
      else if (kind === PAGE.ARTICLE) this.dropPending();
      return;
    }
    if (h.presentedAt != null) return;
    // Search return history stopped on the board list instead of the article.
    if (h.target === PAGE.ARTICLE && kind === PAGE.ARTICLE_LIST) return this._end('unexpected');
    if (h.target && kind !== h.target) {
      // An article list presents itself again while it is being left; any
      // other page is PTT leaving the route the stack describes.
      if (kind === PAGE.ARTICLE_LIST || kind === PAGE.ARTICLE) return;
      return this._end('unexpected');
    }
    if (kind === PAGE.ARTICLE && openArticleKey(core) !== h.id) return this._end('unexpected');
    if (kind === PAGE.ARTICLE_LIST && h.target) {
      if (core.buf.pageState !== 2 || core.listSession?.state !== 'active') return;
      // A list that has not read its board yet, as after rebuilt search
      // results, presents itself again once it has.
      const board = listBoard(core);
      if (!board) return;
      if (!sameBoard(board, h.board)) return this._end('unexpected');
    }
    h.presentedAt = performance.now();
    this._mark('presented', { kind });
    this._step();
  }

  // A screen settled during the handoff: it ends the handoff when it is PTT's
  // answer and something other than the page this Back expects.
  _screenAnswered() {
    const h = this.handoff;
    const core = this.core;
    if (!h || h.presentedAt != null) return;
    const pageState = core.buf.pageState;
    if (!h.target) {
      // An article list until a session presents its page; any other screen
      // is PTT's answer.
      if (pageState === 2 && core.buf.listRenderOwner === OWNER_ARTICLE_LIST) return;
      return this._end('presented');
    }
    if (h.target === PAGE.ARTICLE) {
      // Search return history reopens the article by its code, through screens
      // of its own, and presents it.
      if (core.articleShortcutSearch?.active) return;
      if (pageState === 3 && openArticleKey(core) === h.id) return;
    } else if (h.target === PAGE.ARTICLE_LIST) {
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
    this._mark('end', { how });
    if (how === 'presented' && h.layer) h.layer.alignReal(core);
    this._cleanup();
    // The revealed page is now PTT's real page; its layer is spent.
    h.layer?.hide();
    this.captured.length = Math.max(0, this.stack.pages.length - 2);
    this.stack = popPage(this.stack).stack;
    // PTT left the route the stack describes, or never confirmed it: nothing
    // below is known to be the way back.
    if (how === 'unexpected' || how === 'timeout') this._discard();
    // Backs queued for a page PTT did not show have nothing left to unwind.
    if (how !== 'presented') this.stack = dropQueuedBacks(this.stack);
    const queued = takeQueuedBack(this.stack);
    this.stack = queued.stack;
    h.finish();
    core._refreshScreenContext?.();
    if (how === 'timeout' && h.hint) h.hint();
    if (how === 'presented' && h.tap) h.layer.openTapped(core, h.tap);
    h.layer?.destroy();
    // Through the usual path: it reveals the next lower page, or waits for PTT.
    // Sent from its own task, since the swap can run inside the owning
    // session's presentation.
    if (queued.back) setTimeout(() => {
      core.sendNavKeyAsUser('ArrowLeft');
      // Without a live layer below, that Back waits for PTT outside any
      // handoff: the Backs still queued have no swap to run after.
      if (!this.handoff) this.stack = dropQueuedBacks(this.stack);
    });
  }
}
