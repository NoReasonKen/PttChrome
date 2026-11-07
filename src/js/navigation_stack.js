// The page stack of mobile easy reading (#25, #28, #31, #49). A page opened
// from the shown page is stacked on it, and that page stays alive underneath as
// a live layer: an article list under its article, the home dashboard or a
// board list under the board's article list, an article under the results of
// an article shortcut search started from it. Back reveals the layer, PTT's
// real Back is sent through the usual path, and once the owning session has
// presented the real page and the reader is idle, the real page takes over at
// the layer's reading position. A Back made meanwhile reveals the next lower
// page at once, and PTT follows the Backs in order (#125).
//
// ArticleGestures owns the surfaces that slide away; this module owns the
// stack and the layers; a handoff is its own object (stack_handoff.js), and a
// deleted source kept shown is another (stack_kept_source.js).
import { readEffectivePrefs } from './pref_storage';
import { sameBoard } from './screen_titles';
import {
  createPageStack, pushPage, popPage, revealTarget, withLayer, backPastRevealed, spendsLayer, boundLayers, pageShown, PAGE
} from './page_stack';
import { StackListLayer } from './stack_list_layer';
import { StackHomeLayer } from './stack_home_layer';
import { StackArticleLayer } from './stack_article_layer';
import { EMPTY_TOOLBAR_CONTEXT } from './mobile_toolbar';
import { commentBarEnabled } from './comment_bar';
import { i18n } from './i18n';
import { STACK_NOTICE_MS } from './stack_layer';
import { searchGateFacts } from './article_search';
import { Handoff, listBoard, openArticleKey } from './stack_handoff';
import { KeptSource } from './stack_kept_source';
import { isSearchResultsFrame, isFullBoardListFrame } from './search_results_screen';
import { readSearchResultsContext } from './search_results_context';

function countNodes(root) {
  let n = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  while (walker.nextNode()) n++;
  return n;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A header's post time ("Mon Sep  1 12:00:00 2025") as a comparable number,
// or null.
function postedAt(time) {
  const m = /([A-Z][a-z]{2}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})/.exec(time || '');
  const month = m ? MONTHS.indexOf(m[1]) : -1;
  return month < 0 ? null : Date.UTC(+m[6], month, +m[2], +m[3], +m[4], +m[5]);
}

// Whether the article posted at `time` was posted before the one posted at
// `than`, or null when that is unknown. A list lists articles as posted.
export function postedBefore(time, than) {
  const a = postedAt(time);
  const b = postedAt(than);
  return a == null || b == null || a === b ? null : a < b;
}

export class NavigationStack {
  constructor(core) {
    this.core = core;
    this.stack = createPageStack();
    // The live layer of each page that has one, with what the reveal shows of
    // it (title, App Bar), by depth in the stack.
    this.captured = [];
    this.pending = null;
    // The Handoff while Back is answered, or null.
    this.handoff = null;
    // A deleted source article kept shown over its board list (#121): a
    // KeptSource, or null.
    this.gone = null;
    // Set by the same-thread jump that sends `=`: the next move in place lands
    // on the first article of the thread, not on the nearest one.
    this.firstInThread = false;
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
    const toolbar = this.core._screenContext;
    this.pending = { kind, board, id, layer, appBar: toolbar?.appBar, toolbar, title };
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

  // What became of an action made with no handoff, for debug recordings: run
  // at once, or dropped and why. A handoff logs its own (Handoff.diagAction).
  _diagAction(outcome, info) {
    const rec = this.core.debugRecorder;
    if (!rec?.isRecording) return;
    rec.log('stack.action', { outcome, ms: null, presented: false, ...info });
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
  // results included (#33). `fullList`: PTT's caption proves it the board's
  // full list (#86); a list that cannot prove it, such as one with the legacy
  // caption every list shares, is not.
  captureList() {
    const core = this.core;
    const board = listBoard(core);
    if (!core.mobile || !board) return this.dropPending();
    const fullList = isFullBoardListFrame(searchGateFacts(core), board);
    this._capture(PAGE.ARTICLE_LIST, board, () => StackListLayer.capture(core.view, 'article'));
    if (!this.pending) return;
    this.pending.fullList = fullList;
    // The list page the real list takes over again on Back (#127).
    this.pending.layer.listPage = core.listSession?.listPage?.() || null;
  }

  // An article shortcut search is about to start from the shown article
  // (#49): the article stays alive under its results. Returns the captured
  // page, or null. Its post (board and AID) is kept when the article shows
  // its URL, so Share on the revealed article needs nothing of PTT.
  captureArticle() {
    const page = this._articlePage();
    if (!this.core.mobile || !page.id) {
      this.dropPending();
      return null;
    }
    this._capture(PAGE.ARTICLE, page.board, () => StackArticleLayer.capture(this.core.view), page.id);
    if (!this.pending) return null;
    this.notePost(this.pending, this.core.aidNavigation?.findLocalPostAid?.());
    return this.pending;
  }

  // The post `captured` (a page captureArticle returned) shows, once known.
  notePost(captured, post) {
    if (captured && post?.aid && post.board) captured.post = { board: post.board, aid: post.aid };
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
    // PTT's selection in an article list starts on the article opened from it.
    pending.follows = page.id;
    pending.time = null;
    if (pending.kind === PAGE.ARTICLE_LIST && page.kind === PAGE.ARTICLE) pending.layer?.opened?.();
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
    if (this.core.articleResize?.active || this.core.listResize?.active) return;
    // An article being opened is entered once its open is bound.
    if (this.pending?.kind === PAGE.ARTICLE_LIST) return;
    const page = this._articlePage();
    if (this.core.buf.pageState !== 3 || !page.id) return;
    this._shown(page);
    const view = this.core.view;
    if (view._articleAuthor) {
      this.article = { id: page.id, author: view._articleAuthor, title: view._articleTitle, time: view._articleTime };
      this._follow();
    }
  }

  // PTT's selection in the article list below moves to each article that
  // replaces the open one in place (#74), one move at a time. The list keeps
  // its own selection as the reader left it (#123) and only tracks PTT's, to
  // show the articles read and move PTT back on Back. Once it loses PTT's
  // selection (an article off its rows) it stops following, and is still
  // revealed: the list is the one left (#127). Each article read after that
  // still shows read where the list names it by its own identity (#128).
  _follow() {
    // A same-thread jump has moved PTT's selection once it is over.
    if (this.core.threadJump?.active) return;
    const first = this.firstInThread;
    this.firstInThread = false;
    const top = this._top();
    const lower = this.captured[this.stack.pages.length - 2];
    if (!lower || lower.kind !== PAGE.ARTICLE_LIST || top?.kind !== PAGE.ARTICLE || this.article.id !== top.id) return;
    const { time } = this.article;
    if (lower.follows !== top.id) {
      lower.shows = lower.shows !== false && lower.layer.follow(this.article, postedBefore(time, lower.time), first);
      if (!lower.shows) lower.layer.noteRead(this.article);
      lower.follows = top.id;
    }
    lower.time = time;
  }

  // The connection closed: PTT's route behind every stacked page is gone, and
  // so is what was captured on the way to a page.
  disconnected() {
    this._end('disconnected');
    this.clear();
  }

  clear() {
    if (this.handoff) return;
    this.leaveGone();
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
    // backtracking, not the page below (#33).
    const top = this._top();
    if (top?.kind === PAGE.ARTICLE_LIST && !top.results && this._showsSearchResults()) return null;
    return this._revealIn(this.stack);
  }

  // The live lower page Back from the top of `stack` reveals, or null.
  _revealIn(stack) {
    const target = revealTarget(stack);
    const n = stack.pages.length;
    const lower = target && this.captured[n - 2];
    // Fitting a list layer to a changed width renders it again. Where PTT's
    // selection is does not matter: the real list takes over from the layer
    // and moves it back (#127).
    return lower?.layer.fitViewport() ? { page: target, ...lower } : null;
  }

  // Whether a lower article list holds PTT's selection: the article now open,
  // followed through every replacement in place (#74). Only fullListBelow
  // asks; a reveal does not need it (#127).
  _selects(lower) {
    return lower.kind !== PAGE.ARTICLE_LIST || (lower.follows === this._top().id && lower.shows !== false);
  }

  // What PTT's Back from the shown article returns to, when the stack knows
  // it is its board's full list (#86): { selected } tells whether PTT's
  // selection there is still this article. Null when that is not known.
  fullListBelow() {
    const n = this.stack.pages.length;
    const top = this._top();
    const below = this.stack.pages[n - 2];
    const lower = this.captured[n - 2];
    const page = this._articlePage();
    if (this.handoff || this.core.buf.pageState !== 3 || top?.kind !== PAGE.ARTICLE || !page.id || top.id !== page.id) return null;
    if (below?.kind !== PAGE.ARTICLE_LIST || below.results || !lower?.fullList ||
        !sameBoard(below.board, top.board)) return null;
    return { selected: this._selects(lower) };
  }

  // The live page that Back from the current page may reveal, or null.
  revealable() {
    return this._revealed()?.layer || null;
  }

  // The revealed page's title, shown while the current page slides away.
  get title() {
    return this._revealed()?.title || '';
  }

  // The rest of the revealed page's App Bar, shown under its title.
  get appBar() {
    return this._revealed()?.appBar || null;
  }

  // A revealed page keeps the toolbar it had (#119): its panels open at once,
  // and what it sends PTT waits for the real page to take over. The dark
  // fallback and a deleted source kept shown have no actions; such an
  // article keeps its comment action (#121).
  toolbarContext() {
    const shown = this.gone || this.handoff;
    if (!shown) return null;
    const appBar = shown.appBar || EMPTY_TOOLBAR_CONTEXT.appBar;
    const h = this.handoff;
    if (h?.layer && h.toolbar) return { ...h.toolbar, appBar, locked: false };
    const push = this.showsArticleLayer() && commentBarEnabled(readEffectivePrefs());
    const refresh = this.refreshesRevealed();
    return { ...EMPTY_TOOLBAR_CONTEXT, appBar, push, refresh, locked: true };
  }

  // The post (board and AID) of the article shown before it is usable as a
  // real page, when known: Share needs nothing of PTT then (#119).
  revealedPost() {
    const shown = this.gone || this.handoff;
    return shown && this.showsArticleLayer() ? shown.post || null : null;
  }

  // The shown page is an article not usable as a real page yet: revealed while
  // search backtracking reopens it, or a deleted source kept shown (#121).
  showsArticleLayer() {
    const h = this.handoff;
    return !!this.gone || (!!h && h.shownTarget() === PAGE.ARTICLE && !!h.layer);
  }

  // A comment made on such an article: 'refused' when it could not be reopened,
  // 'held' when it is remembered until PTT is ready, or null to send it now.
  // `run` sends it.
  holdComment(run) {
    if (this.refusesComment()) return 'refused';
    if (!this.showsArticleLayer()) return null;
    this.remember({ run, drop: () => this.core.view.flashListHint?.(i18n('stack_commentNotSent'), STACK_NOTICE_MS) });
    return 'held';
  }

  // A comment on a source that could not be reopened is refused with a notice.
  refusesComment() {
    if (!this.gone) return false;
    this.core.view.flashListHint?.(i18n('stack_commentSourceUnverified'), STACK_NOTICE_MS);
    return true;
  }

  // An action made on a revealed page before PTT has caught up ({ run, drop }):
  // see Handoff.remember. Returns whether it was remembered.
  remember(action) {
    return !!this.handoff?.remember(action);
  }

  // An action on the revealed page (#124): remembered until PTT has caught
  // up, or run at once when the real page is already shown.
  whenReady(run) {
    if (this.handoff?.whenReady(run)) return;
    this._diagAction('runNow', {});
    run();
  }

  // A refresh (pull, toolbar or F5) can refresh a page revealed before PTT
  // has caught up (#124).
  refreshesRevealed() {
    return !!this.handoff?.layer;
  }

  // A key for PTT made on the revealed page (`send` sends it): see
  // Handoff.holdKey. Returns whether it was held.
  holdKey(send) {
    return !!this.handoff?.holdKey(send);
  }

  // Such a refresh replaces any remembered action and runs once PTT shows the
  // real page. A real list then keeps PTT's position: the refresh replaces
  // what the layer showed.
  refreshWhenReady(run) {
    const h = this.handoff;
    if (h?.layer) return h.remember({ run, drop: () => h.notRun(), refresh: true });
    this._diagAction('dropped', { reason: 'refreshWithoutLayer' });
    return false;
  }

  // The entry of the revealed list under `target` while PTT has not caught
  // up, or null: see StackListLayer.entryAt.
  layerEntryAt(target) {
    return this.handoff?.layerEntryAt(target) || null;
  }

  // Search backtracking could not reopen the revealed source article, deleted
  // or not verifiable: it stays shown when the handoff ends (#121).
  sourceGone() {
    const h = this.handoff;
    if (h?.target !== PAGE.ARTICLE || !h.layer) return;
    // A later Back already left the source (#125): PTT's board list takes over
    // the page shown.
    if (h.legs.length) return this._end('unexpected');
    this._end('gone');
  }

  // Back from a deleted source kept shown: PTT already shows the board list,
  // so the article only goes away. Returns whether one was shown.
  leaveGone() {
    const gone = this.gone;
    if (!gone) return false;
    this.gone = null;
    gone.leave();
    this.core._refreshScreenContext?.();
    this.core.commentBar?.refresh();
    return true;
  }

  get handingOff() {
    return !!this.handoff;
  }

  // The live layer of `board`'s article list a Back has revealed and whose
  // real page PTT has not presented yet, or null. The real page carries the
  // layer's rows (#120), so the swap shows nothing new.
  keptListLayer(board) {
    return this.handoff?.keptListLayer(board) || null;
  }

  // PTT's answer to Back shows content newer than the list a live layer shows
  // again (#128): see Handoff.noticeNewContent.
  noticeNewContent() {
    return !!this.handoff?.noticeNewContent();
  }

  // Whether Back is showing the page of `kind` again from its live layer, and
  // PTT is answering the Back to that page.
  showsLayerOf(kind) {
    return !!this.handoff?.showsLayerOf(kind);
  }

  // The live layer shown while PTT answers Back, or null.
  shownLayer() {
    return this.handoff?.layer || null;
  }

  // What a Back made now during the handoff shows: the next lower page's
  // live layer (null for the dark fallback) under its title and App Bar, or
  // null when it shows nothing more.
  nextReveal() {
    const h = this.handoff;
    if (!h) return null;
    const next = h.lastLeg().target && backPastRevealed(this.stack);
    if (!next) return null;
    const revealed = next.revealed && this._revealIn(next.stack);
    return { layer: revealed?.layer || null, title: revealed?.title || '', appBar: revealed?.appBar || null };
  }

  // The page shown is being swiped away: the real page does not take over
  // until the returned release, as while a finger is down.
  holdSwap() {
    return this.handoff?.holdSwap() || (() => {});
  }

  // A Back made during the handoff (#125): the revealed page is left too, and
  // the page below it shows at once, its live layer or the dark fallback. PTT
  // follows this Back once it has answered the earlier ones; nothing waits for
  // a swap. It replaces a remembered action: the reader's last choice wins.
  backDuringHandoff() {
    const h = this.handoff;
    if (!h) return false;
    h.forget('back');
    // The dark fallback waits for whatever PTT shows; nothing is known below.
    const next = h.lastLeg().target && backPastRevealed(this.stack);
    if (!next) return true;
    const left = this.stack.pages[this.stack.pages.length - 2];
    h.leaveLayer();
    this.stack = next.stack;
    this.captured.length = Math.min(this.captured.length, this.stack.pages.length - 1);
    h.backTo(left, next.revealed && this._revealIn(this.stack));
    return true;
  }

  // The reader acted on the page shown (#125). An action that asks PTT for the
  // page's data anew spends the live layer the page was shown from: what the
  // layer still had to do, such as a remembered action, no longer affects the
  // page, and the rows of `list` ('article' or 'board') no longer stay as the
  // reader left them.
  spend(action, list = 'article') {
    if (!spendsLayer(action)) return;
    const h = this.handoff;
    if (h) h.forget('spent:' + action);
    this.core.view.releaseListRows?.(list);
    h?.mark('spent', { action, list });
  }

  // The current page has slid away. `send` sends PTT's Back and returns
  // whether it was sent; `finish` restores the surfaces once the real page
  // takes over; `cancel` brings the current page back when Back was not sent.
  // `level` is the kind of page left: an article, an article list or a board
  // list. A list with nothing revealed below waits for whatever page PTT shows
  // next (#32, #53). `follow(level)` sends PTT the Back from the page of kind
  // `level` that a later Back revealed past, and `reveal(layer, title, appBar)`
  // shows that Back's lower page under its own App Bar (#125).
  begin({ level = PAGE.ARTICLE, send, follow, reveal, finish, cancel, hint }) {
    const revealed = this._revealed();
    const h = this.handoff = new Handoff(this.core, revealed, {
      level, board: this._top()?.board || this.core.view._articleBoard,
      end: how => this.handoff === h && this._end(how), follow, reveal, finish, hint
    });
    let sent = false;
    try {
      sent = h.start(send);
    } finally {
      if (!sent) {
        if (this.handoff === h) this.handoff = null;
        cancel();
      }
    }
    if (sent) this.core.commentBar?.refresh();
    return sent;
  }

  // The owning session presented a real page of `kind`: an article list
  // (rebuilt, scrolled and positioned), a board list, the home dashboard, or an
  // article reopened by search backtracking.
  pagePresented(kind) {
    const h = this.handoff;
    const core = this.core;
    if (h) return h.pagePresented(kind);
    if (kind === PAGE.ARTICLE_LIST && listBoard(core)) this._enterList(listBoard(core));
    // Back on the dashboard or a board list some other way: what was stacked
    // above it, or captured on the way to a board, no longer holds.
    else if (kind === PAGE.HOME || kind === PAGE.BOARD_LIST) this.clear();
    // The search returned to its source without results.
    else if (kind === PAGE.ARTICLE) this.dropPending();
  }

  // The handoff ends `how`: 'presented' (the real page takes over), 'gone' (a
  // deleted source stays shown), 'unexpected', 'timeout' or 'disconnected'.
  _end(how) {
    const h = this.handoff;
    if (!h) return;
    const core = this.core;
    // A deleted source stays shown over the board list PTT stopped on.
    const gone = how === 'gone';
    h.close(how);
    this.handoff = null;
    this.captured.length = Math.max(0, this.stack.pages.length - 2);
    this.stack = popPage(this.stack).stack;
    // PTT left the route the stack describes, or never confirmed it: nothing
    // below is known to be the way back.
    if (how === 'unexpected' || how === 'timeout' || gone) this._discard();
    h.finish();
    if (gone) this.gone = new KeptSource(h);
    core._refreshScreenContext?.();
    core.commentBar?.refresh();
    if (how === 'timeout' && h.hint) h.hint();
    // A remembered action runs from its own task, once the real page is shown.
    if (gone && h.action) this.refusesComment();
    else h.settleAction(how);
    if (!gone) h.layer?.destroy();
    // Prepare the next list outside a new contact, after the spent layer is
    // removed. Only that list remains connected below the real page.
    if (how === 'presented') this._revealed()?.layer.prepare?.();
    // A size change made during Back waits until the revealed page has
    // handed over its reading position.
    core.listResize?.pump();
    // The swipes follow the page now shown: a swap held by the reader's finger
    // can come after the last screen settles (#83).
    core.articleGestures?.update();
  }
}
