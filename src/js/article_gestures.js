import { readEffectivePrefs } from './pref_storage';
import { mobileToolbarContext } from './mobile_toolbar';
import { i18n } from './i18n';
import { serializedOpHint } from './serialized_op_gate';
import { ArticleHorizontalGesture, ARTICLE_TAP_SLOP } from './article_horizontal_gesture';
import { PAGE } from './page_stack';
import { StackEntry } from './stack_entry';
import { createUnderlay, holdSurfaces, raiseSurfaces, releaseSurfaces, paintSurfaces, slideDuration, freezeScroll } from './stack_motion';
import { STACK_NOTICE_MS } from './stack_layer';
import { OWNER_ARTICLE_LIST, OWNER_BOARD_LIST } from './list_render_owner';
import { recordFor } from './reading_record';
import { isPlainBack } from './term_keyboard';
import { DrawerDiagnostics } from './article_gesture_diag';
import { articleIdentity } from './article_shortcut_search';
import '../css/article_gestures.css';

const MODAL_SOURCE = 'articleShortcutDrawer';
const ACTIONS = [
  { key: 'thread', label: 'articleShortcutSearch_thread' },
  { key: '[', label: 'mobileToolbar_threadPrev' },
  { key: '=', label: 'mobileToolbar_threadFirst' },
  { key: ']', label: 'mobileToolbar_threadNext' },
  { key: 'author', label: 'articleShortcutSearch_author' }
];
const EXCLUDED = 'input, textarea, select, button, [contenteditable="true"], video, audio, iframe, [role="slider"], .easyReadingVideo';
// Drawer geometry (docs/article-swipe-drawer-spec.md): a share of the viewport
// width, and of the usable height above the toolbar, centered in that height.
const DRAWER_WIDTH = 0.75;
const DRAWER_HEIGHT = 0.6;
const DRAWER_TOP = (1 - DRAWER_HEIGHT) / 2;

// Own the contact outside the portal so mounting/focus changes cannot lose it.
// Article exit and search shortcuts extend this owner rather than add listeners.
export class ArticleGestures {
  constructor(core) {
    this.core = core;
    this.opened = false;
    this.track = null;
    this.root = null;
    this.panel = null;
    this.frame = null;
    this.timer = null;
    this.suppressClickUntil = 0;
    this.tap = null;
    this.entry = null;
    // Backs made during a committed exit slide, before its handoff starts;
    // null while no exit is committing.
    this.backsDuringSlide = null;
    // The page revealed during a handoff, being swiped away over the page a
    // Back would show next, or null.
    this.layerExit = null;
    this.listeners = [];
    this.stack = core.navigationStack;
    this._listen(window, 'pointerdown', event => this._start(event), true);
    this._listen(window, 'pointermove', event => this._move(event), { capture: true, passive: false });
    this._nativeTouchMove = event => {
      // Cancel native scrolling only after horizontal intent is established.
      // Canceling pointermove alone can leave a native fling that eats the next tap.
      if (event.touches.length === 1 && this.track?.gesture.operation) this._consume(event);
    };
    this._listen(window, 'pointerup', event => this._end(event), true);
    this._listen(window, 'pointercancel', event => this._end(event, true), true);
    this._listen(window, 'click', event => {
      if (performance.now() >= this.suppressClickUntil) return;
      this._consume(event);
      this.diag.log('clickSuppressed', event);
    }, true);
    this._listen(window, 'contextmenu', event => {
      if (this.track?.gesture.operation || this.opened) this._consume(event);
    }, true);
    this._listen(window, 'keydown', event => this._key(event), true);
    this.diag = new DrawerDiagnostics(this);
    this.diag.listen((target, type, listener, options) => this._listen(target, type, listener, options));
    this._listen(window, 'resize', () => this._resize());
    if (window.visualViewport) this._listen(window.visualViewport, 'resize', () => this._resize());
    this._refresh = () => this.update();
    core.buf.addEventListener('viewUpdate', this._refresh);
    core.buf.addEventListener('screenSettled', this._refresh);
    this.unsubscribeMobile = core.onMobileChange(this._refresh);
    this.update();
  }

  _listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push(() => target.removeEventListener(type, listener, options));
  }

  available() {
    const core = this.core;
    return !!(core.mobile && readEffectivePrefs().articleHorizontalGestures &&
      !serializedOpHint(core) &&
      core.conn?.isConnected && core.view.useEasyReadingMode && core.buf.startedEasyReading &&
      !core.buf.easyReadingFunctionMode && mobileToolbarContext(core).threadNav);
  }

  // An easy-reading article list (#32) or a smooth-scrolling board list (#53)
  // swipes right to go back, under the same preference; neither has a drawer.
  // The kind of list, or null.
  listSwipeLevel() {
    if (!readEffectivePrefs().articleHorizontalGestures || this.core.buf.pageState !== 2) return null;
    return [PAGE.ARTICLE_LIST, PAGE.BOARD_LIST].find(level => this._leaveable(level)) || null;
  }

  // The kind of page a contact starting now would swipe, or null.
  _swipeLevel() {
    return this.available() ? PAGE.ARTICLE : this.listSwipeLevel();
  }

  update() {
    this.stack.update();
    // Resize events already adapt an open panel or cancel its active drag.
    // A temporary PTT footer mismatch must not dismiss that open panel.
    if (this.core.buf.easyReadingResizeInFlight && this.root && !this.track) return;
    const available = this.available();
    const swipeable = available || !!this.listSwipeLevel();
    this.core.view.mainDisplay.classList.toggle('articleHorizontalGestures', swipeable);
    this._setNativeTouchMove(swipeable);
    const { board, author, title } = articleIdentity(this.core);
    const identity = [board, author, title, this.core.easyReading?._articleKey].join('\n');
    // A list being swiped or left stays while it can be left: its own paging
    // redraws the screen meanwhile.
    // During a handoff the page shown is the revealed one, whatever PTT draws
    // meanwhile: a swipe or the drawer on it goes on (#119). The page that
    // takes over is checked afresh.
    if (this.stack.handingOff) {
      this.identity = null;
      return;
    }
    const leaving = this.track?.level || (this.exitUnderlay && this.exitLevel);
    const lost = leaving && leaving !== PAGE.ARTICLE ? !this._leaveable(leaving) :
      !available || (this.identity && identity !== this.identity);
    if (lost) this.close(true);
    this.identity = identity;
  }

  _setNativeTouchMove(enabled) {
    if (this.nativeTouchMoveEnabled === enabled) return;
    this.nativeTouchMoveEnabled = enabled;
    const surface = this.core.view.mainDisplay;
    if (enabled) surface.addEventListener('touchmove', this._nativeTouchMove, { capture: true, passive: false });
    else surface.removeEventListener('touchmove', this._nativeTouchMove, true);
  }

  _start(event) {
    if (event.isPrimary) this.suppressClickUntil = 0;
    if (event.pointerType !== 'touch') return;
    // A page sliding in is not there until PTT has answered.
    this.entry?.land();
    if (this.entry) return;
    if (this.stack.handingOff) return this._startOnLayer(event);
    if (this.track) {
      this._cancel();
      return;
    }
    const level = this._swipeLevel();
    if (!event.isPrimary || !level || this._otherModalOpen() || this.exitSettling) return;
    if (this.settling) {
      if (!this.opened || !this.root) return;
      // A fresh contact is intentional input, unlike the opening drag's release.
      this._finishDrawerSettle(true);
    }
    const target = event.target;
    if (!this.opened && (!this.core.view.mainDisplay.contains(target) || target.closest(EXCLUDED))) return;
    if (!this.opened && (this.core.mobileSelectMode || !window.getSelection().isCollapsed)) return;
    const width = window.innerWidth;
    this.track = {
      id: event.pointerId,
      level,
      gesture: new ArticleHorizontalGesture({
        width, opened: this.opened, allowExit: true, allowOpen: level === PAGE.ARTICLE, x: event.clientX, y: event.clientY, t: event.timeStamp
      })
    };
  }

  // A page revealed during a handoff is the page (#119): a swipe right on it
  // is a Back made meanwhile, which shows the next lower page at once while
  // PTT follows (#125); a swipe left on a revealed article opens its drawer,
  // whose actions wait for the real page to take over.
  _startOnLayer(event) {
    if (this.track) return this._cancel();
    // The contact lands on the page the finished swipe shows, which was not
    // usable when it was made; its touch events still go to what it touched.
    const finished = this._finishLayerExit();
    const target = finished ? document.elementFromPoint(event.clientX, event.clientY) : event.target;
    const layer = this.stack.shownLayer();
    if (!layer || !event.isPrimary || !readEffectivePrefs().articleHorizontalGestures || this._otherModalOpen()) return;
    if (this.settling) {
      if (!this.opened) return;
      this._finishDrawerSettle(true);
    }
    const allowExit = !!this.stack.nextReveal();
    const allowOpen = this.stack.showsArticleLayer();
    if (!this.opened) {
      if (!layer.el.contains(target) || target.closest(EXCLUDED) || !(allowExit || allowOpen)) return;
      if (this.core.mobileSelectMode || !window.getSelection().isCollapsed) return;
    }
    this.track = {
      id: event.pointerId,
      level: null,
      layer,
      touched: finished ? event.target : layer.el,
      gesture: new ArticleHorizontalGesture({
        width: window.innerWidth, opened: this.opened, allowExit, allowOpen, x: event.clientX, y: event.clientY, t: event.timeStamp
      })
    };
    this.track.touched.addEventListener('touchmove', this._nativeTouchMove, { capture: true, passive: false });
  }

  _move(event) {
    const track = this.track;
    if (!track || event.pointerId !== track.id) return;
    const left = track.layer ? this.stack.shownLayer() !== track.layer : this._swipeLevel() !== track.level;
    if (left || this._otherModalOpen()) return this._cancel();
    const previousAxis = track.gesture.axis;
    const snapshot = track.gesture.move(event.clientX, event.clientY, event.timeStamp);
    this.diag.move(event, track, previousAxis);
    if (this.opened || snapshot.operation) {
      this._consume(event);
      if (snapshot.operation) {
        if (snapshot.operation === 'exit' && track.layer) {
          this._ensureLayerExit(track.layer);
          this.exitDistance = snapshot.distance;
          if (!this.frame) this.frame = requestAnimationFrame(() => {
            this.frame = null;
            if (this.layerExit) paintSurfaces(this.layerExit.surfaces, this.exitDistance);
          });
          return;
        }
        if (snapshot.operation === 'exit') {
          this.exitLevel = track.level;
          this._ensureExit();
          this.exitDistance = snapshot.distance;
          if (!this.frame) this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this._paintExit(this.exitDistance);
          });
          return;
        }
        this._ensurePanel();
        this.core.setModalOpen(MODAL_SOURCE, true);
        this.reveal = snapshot.reveal;
        if (!this.frame) this.frame = requestAnimationFrame(() => {
          this.frame = null;
          this._paint(this.reveal);
        });
      }
    }
  }

  _end(event, canceled = false) {
    const track = this.track;
    if (!track || event.pointerId !== track.id) return;
    this.track = null;
    track.touched?.removeEventListener('touchmove', this._nativeTouchMove, true);
    if (!track.gesture.operation) {
      if (this.opened && track.gesture.axis) {
        this._consume(event);
        this.suppressClickUntil = performance.now() + 400;
      }
      return;
    }
    this._consume(event);
    this.suppressClickUntil = performance.now() + 400;
    const result = track.gesture.release(event.timeStamp, canceled);
    if (track.gesture.operation === 'exit') {
      return track.layer ? this._settleLayerExit(result.exit) : this._settleExit(result.exit);
    }
    this._settle(result.opened);
  }

  _cancel() {
    const track = this.track;
    if (!track) return;
    const opened = track.gesture.opened;
    const operation = track.gesture.operation;
    this.track = null;
    track.touched?.removeEventListener('touchmove', this._nativeTouchMove, true);
    if (!operation) return;
    this.suppressClickUntil = performance.now() + 400;
    if (operation === 'exit') return track.layer ? this._settleLayerExit(false) : this._settleExit(false);
    this._settle(opened);
  }

  // The revealed page and its App Bar slide over the page a Back would show
  // next. The real page does not take over meanwhile.
  _ensureLayerExit(layer) {
    if (this.layerExit) return;
    const next = this.stack.nextReveal();
    const underlay = createUnderlay(this.core, next?.layer || null, next?.title || '', next?.appBar || null);
    const surfaces = [...raiseSurfaces([this.exitUnderlay]), ...raiseSurfaces([layer.el])];
    // The layer paints over its own App Bar's underlay.
    layer.el.style.zIndex = '153';
    freezeScroll(layer.el);
    this.layerExit = { layer, below: next?.layer || null, underlay, surfaces, timer: null, release: this.stack.holdSwap() };
  }

  _settleLayerExit(commit) {
    const exit = this.layerExit;
    if (!exit) return;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    const duration = slideDuration();
    for (const { node } of exit.surfaces) node.style.transition = `translate ${duration}ms ease-out`;
    paintSurfaces(exit.surfaces, commit ? window.innerWidth : 0);
    clearTimeout(exit.timer);
    exit.committed = commit;
    exit.timer = setTimeout(() => {
      exit.timer = null;
      this._dropLayerExit(commit && this.stack.shownLayer() === exit.layer);
    }, duration);
  }

  // A committed swipe still sliding away is a Back already made: it counts
  // before any input that follows it, so a second Back is never absorbed.
  _finishLayerExit() {
    const exit = this.layerExit;
    if (!exit?.committed) return false;
    this._dropLayerExit(this.stack.shownLayer() === exit.layer);
    return true;
  }

  // Ends a swipe on a revealed page: `back` makes it a Back during the
  // handoff, which reveals the page shown under it; otherwise the page stays.
  _dropLayerExit(back = false) {
    const exit = this.layerExit;
    if (!exit) return;
    this.layerExit = null;
    clearTimeout(exit.timer);
    exit.layer.el.removeEventListener('touchmove', this._nativeTouchMove, true);
    releaseSurfaces(exit.surfaces);
    exit.underlay.remove();
    if (back) this.stack.backDuringHandoff();
    // A Back made meanwhile some other way may already show the page below.
    else if (exit.below && exit.below !== this.stack.shownLayer()) {
      if (exit.below.prepare) exit.below.prepare();
      else exit.below.hide();
    }
    exit.release();
  }

  // Another modal owns input; an open drawer or exit underlay is our own.
  _otherModalOpen() {
    const own = this.root || this.exitUnderlay ? 1 : 0;
    return (this.core.modalShown && !own) || this.core._openModals?.size > own;
  }

  // Stop the pending paint frame and settle timer of the current surface.
  _stopMotion() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    clearTimeout(this.timer);
    this.timer = null;
  }

  _consume(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  // A session opens an entry from the shown page, enters it, or abandons the
  // open: the shown page is kept, bound or dropped as the lower page.
  captureListLayer() {
    this.stack.captureList();
    this._beginEntry();
  }

  captureHomeLayer(board) {
    this.stack.captureHome(board);
    this._beginEntry();
  }

  captureBoardListLayer(board) {
    this.stack.captureBoardList(board);
    this._beginEntry();
  }

  // An article shortcut search keeps its source article alive under the
  // results (#49); its results slide in once they present (slideInOver).
  captureArticleLayer() {
    return this.stack.captureArticle();
  }

  // The real screen, which PTT has already answered, slides in from the right
  // over `cover`, a copy of the page it was opened from shown over it, with
  // that page's `title` and `appBar` beside it. The cover goes with the
  // motion.
  slideInOver(cover, title, appBar) {
    this.entry?.end();
    if (this.exitUnderlay || this.stack.handingOff) return void cover.destroy();
    this.entry = new StackEntry(this.core, { kind: PAGE.ARTICLE, layer: cover, title, appBar }, entry => {
      cover.destroy();
      if (this.entry === entry) this.entry = null;
    });
    this.entry.answered();
  }

  bindListLayer() {
    this.stack.enterArticle();
    this.entry?.answered();
  }

  dropPendingLayer() {
    if (this.entry?.loading) this.entry.failed(this.stack.takePending());
    else this.stack.dropPending();
  }

  // Opening an entry from the shown page slides the new page in over it (#36).
  _beginEntry() {
    this.entry?.end();
    const from = this.stack.pending;
    if (!from?.layer || this.exitUnderlay || this.stack.handingOff) return;
    this.entry = new StackEntry(this.core, from, entry => {
      if (this.entry === entry) this.entry = null;
    });
  }

  leaveGoneArticle() {
    if (!this.stack.leaveGone()) return false;
    this.update();
    return true;
  }

  // A leave is on its way to PTT, from the committed slide on: other input
  // waits for the swap.
  holdsInput() {
    return (this.stack.handingOff || this.backsDuringSlide != null) && !this.sendingBack;
  }

  // A Back made meanwhile reveals the next lower page at once, and PTT follows
  // it (#125); one made during the slide does so once the leave is sent. A
  // drawer open on the revealed page closes first, as a sheet does.
  backDuringHandoff() {
    if (this.root) return this.close();
    this._finishLayerExit();
    if (!this.stack.backDuringHandoff() && this.backsDuringSlide != null) this.backsDuringSlide++;
  }

  // A key for PTT made on a page revealed during the handoff (the toolbar, the
  // keypad): kept in order with the others made meanwhile and sent once the
  // real page takes over.
  holdKey(key, mods) {
    const view = this.core.view;
    this.stack.holdKey(() => view.sendKeyAsUser(key, mods));
  }

  // A session presented a real page: an article list, a board list or the
  // home dashboard. `another`: a board list other than the one shown before.
  pagePresented(kind, { another = false } = {}) {
    if (this.entry?.loading && kind === this.entry.from) {
      // A board list opened from a board list's row, such as a class group,
      // stacks over it like a board.
      if (kind === PAGE.BOARD_LIST && another) {
        this.stack.enterBoardList();
        return this.entry.answered();
      }
      // The page an open came from, presented again: nothing was entered.
      this.dropPendingLayer();
    }
    this.stack.pagePresented(kind);
    this.entry?.answered();
  }

  // Back from an article, an article list or a board list opened from a board
  // list (←, system Back, the toolbar) reveals the lower page the same way the
  // article swipe does. Returns true when it took the key.
  handleBack(event) {
    if (!isPlainBack(event)) return false;
    this.entry?.land();
    if (this.sendingBack || this.stack.handingOff || this.entry || this.track || this.exitUnderlay || this.root) return false;
    const core = this.core;
    if (this._otherModalOpen()) return false;
    const level = [PAGE.ARTICLE, PAGE.ARTICLE_LIST, PAGE.BOARD_LIST].find(level => this._leaveable(level));
    if (!level || core.buf.pageState !== (level === PAGE.ARTICLE ? 3 : 2) || !this.stack.revealable()) return false;
    this.exitLevel = level;
    this._ensureExit();
    this._settleExit(true);
    return true;
  }

  _ensureExit() {
    if (this.exitUnderlay) return;
    const layer = this.stack.revealable();
    this.exitUnderlay = createUnderlay(this.core, layer, this.stack.title, this.stack.appBar);
    this.exitUnderlay.setAttribute('data-article-exit-underlay', '');
    this.exitUnderlay.dataset.preview = layer ? 'layer' : 'fallback';
    this.exitSurfaces = holdSurfaces(this.core);
    freezeScroll(this.core.view.mainDisplay);
    this.core.setModalOpen(MODAL_SOURCE, true);
  }

  _paintExit(distance) {
    paintSurfaces(this.exitSurfaces || [], distance);
  }

  _settleExit(commit) {
    if (!this.exitUnderlay) return;
    this._stopMotion();
    this.exitSettling = true;
    const identity = this.identity;
    const duration = slideDuration();
    this.backsDuringSlide = commit ? 0 : null;
    for (const { node } of this.exitSurfaces) node.style.transition = `translate ${duration}ms ease-out`;
    this._paintExit(commit ? window.innerWidth : 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      const backsDuringSlide = this.backsDuringSlide || 0;
      this.backsDuringSlide = null;
      const valid = commit && this._leaveable(this.exitLevel) && identity === this.identity;
      if (valid) this._handoff(backsDuringSlide);
      else this._removeExit();
    }, duration);
  }

  // The article stays off screen over the revealed list, or the dark fallback,
  // until the real list is presented (#20, #28). `backsDuringSlide` made during the
  // slide reveal further once the handoff is under way (#125).
  _handoff(backsDuringSlide) {
    const core = this.core;
    // PTT's Back from a page of kind `level`, sent past the exit's modal gate.
    const sendBack = level => {
      const record = recordFor(core);
      const bookmark = record.begin(level === PAGE.ARTICLE ? 'article-swipe-exit' : 'list-back-reveal');
      core.noteUserAction();
      // The exit surfaces hold the modal gate; release it only for the send.
      core.setModalOpen(MODAL_SOURCE, false);
      this.sendingBack = true;
      let sent = false;
      try {
        sent = core.sendNavKeyAsUser('ArrowLeft');
      } finally {
        this.sendingBack = false;
        record.end(bookmark, sent ? 'done' : 'cancel');
        // A Back not sent either retries or cancels the exit, which releases it.
        core.setModalOpen(MODAL_SOURCE, true);
      }
      return sent;
    };
    const sent = this.stack.begin({
      level: this.exitLevel,
      send: () => sendBack(this.exitLevel),
      follow: sendBack,
      reveal: (layer, title, appBar) => this._revealUnder(layer, title, appBar),
      finish: () => this._removeExit(),
      cancel: () => this._settleExit(false),
      hint: () => core.view.flashListHint?.(i18n('stack_handoffTimeout'), STACK_NOTICE_MS)
    });
    for (let i = 0; sent && i < backsDuringSlide; i++) this.stack.backDuringHandoff();
  }

  // A later Back's lower page replaces the one shown under the page left.
  _revealUnder(layer, title, appBar) {
    const old = this.exitUnderlay;
    if (!old) return;
    this.exitUnderlay = createUnderlay(this.core, layer, title, appBar);
    this.exitUnderlay.setAttribute('data-article-exit-underlay', '');
    this.exitUnderlay.dataset.preview = layer ? 'layer' : 'fallback';
    old.remove();
  }

  // The current page can be left now, by any Back.
  // Whether a page of kind `level` is shown and can be left.
  _leaveable(level) {
    if (level === PAGE.ARTICLE) return this._articleLeaveable();
    return level === PAGE.ARTICLE_LIST ? this._listLeaveable() : this._boardListLeaveable();
  }

  _articleLeaveable() {
    const core = this.core;
    return !!(core.mobile && core.conn?.isConnected && core.view.useEasyReadingMode && core.buf.startedEasyReading &&
      !core.buf.easyReadingFunctionMode && !serializedOpHint(core));
  }

  // An easy-reading article list showing its cards, idle.
  _listLeaveable() {
    const core = this.core;
    const ls = core.listSession;
    return !!(core.mobile && core.conn?.isConnected && core.view.listCards && core.buf.listRenderOwner === OWNER_ARTICLE_LIST &&
      ls?.state === 'active' && ls._renderMode === 'buffer' && !serializedOpHint(core));
  }

  // A smooth-scrolling board list showing its cards, idle.
  _boardListLeaveable() {
    const core = this.core;
    const bs = core.boardListSession;
    return !!(core.mobile && core.conn?.isConnected && core.buf.listRenderOwner === OWNER_BOARD_LIST &&
      bs?.state === 'active' && bs._renderMode === 'buffer' && !serializedOpHint(core));
  }

  _removeExit() {
    this._dropLayerExit();
    if (!this.exitUnderlay) return;
    // A drawer opened on the revealed page owns the motion from then on.
    if (!this.root) this._stopMotion();
    this.backsDuringSlide = null;
    if (!this.stack.handingOff) {
      const layer = this.stack.revealable();
      if (layer?.prepare) layer.prepare();
      else layer?.hide();
    }
    releaseSurfaces(this.exitSurfaces);
    this.exitUnderlay.remove();
    this.exitUnderlay = this.exitSurfaces = null;
    this.exitSettling = false;
    // A drawer opened on the revealed page keeps the modal they share.
    if (!this.root) this.core.setModalOpen(MODAL_SOURCE, false);
  }

  _ensurePanel() {
    if (this.root) return;
    this.previousFocus = document.activeElement;
    this.root = document.createElement('div');
    this.root.className = 'articleDrawerRoot nomouse_command';
    this.root.setAttribute('data-article-drawer', '');
    this.root.addEventListener('touchmove', this._nativeTouchMove, { capture: true, passive: false });
    this.root.addEventListener('click', event => {
      if (event.target === this.root && !this.settling) {
        this._consume(event);
        this.close();
      }
    });
    // A tap acts when the finger lifts: on Android, a tap that stops native
    // momentum left by the opening drag gets no click. A click that still
    // follows is suppressed; keyboard activation keeps the click handlers.
    this.root.addEventListener('pointerdown', event => {
      this.tap = event.pointerType === 'mouse' ? null : { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target };
    });
    this.root.addEventListener('pointerup', event => {
      const tap = this.tap;
      this.tap = null;
      if (!tap || tap.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > ARTICLE_TAP_SLOP) return;
      const button = tap.target.closest?.('[data-article-shortcut]');
      if (button ? !button.contains(event.target) : tap.target !== this.root || event.target !== this.root || this.settling) return;
      this._consume(event);
      this.suppressClickUntil = performance.now() + 400;
      this.diag.log('tapUp', event, { action: button?.getAttribute('data-article-shortcut') || null });
      if (button) this._runShortcut(ACTIONS.find(action => action.key === button.getAttribute('data-article-shortcut')));
      else this.close();
    });
    this.panel = document.createElement('div');
    this.panel.className = 'articleShortcutDrawer';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', i18n('articleShortcutDrawer_title'));
    this.panel.tabIndex = -1;
    for (const action of ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nomouse_command pttRipple';
      button.setAttribute('data-article-shortcut', action.key);
      button.textContent = i18n(action.label);
      button.addEventListener('click', event => {
        this._consume(event);
        this.diag.log('shortcutClick', event, { action: action.key });
        this._runShortcut(action);
      });
      this.panel.appendChild(button);
    }
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    this._geometry();
    this._paint(0);
    this.unregisterDismiss = this.core.registerSheetDismiss(() => this.close());
  }

  // An action from the drawer of a page revealed during a handoff is
  // remembered until the real page takes over (#119); one that cannot run
  // there then says so.
  _runShortcut(action) {
    const held = this.stack.handingOff;
    const gate = !this.opened ? 'closed' : this.settling ? 'settling' : !held && !this.available() ? 'unavailable' : null;
    if (gate) return this.diag.log('shortcutRefused', null, { action: action.key, gate });
    this.close(true);
    const run = () => {
      if (!mobileToolbarContext(this.core).threadNav) {
        if (held) this.core.view.flashListHint?.(i18n('stack_actionNotRun'), STACK_NOTICE_MS);
        return;
      }
      this.core.noteUserAction();
      if (action.key === 'author' || action.key === 'thread') this.core.articleShortcutSearch.start(action.key);
      else this.core.view.sendKeyAsUser(action.key);
    };
    if (held) this.stack.whenReady(run);
    else run();
  }

  _geometry() {
    if (!this.root) return;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const bottom = Math.min(top + (viewport?.height || window.innerHeight),
      document.getElementById('mobileToolbar')?.getBoundingClientRect().top ?? window.innerHeight);
    const height = Math.max(0, bottom - top);
    this.panel.style.height = height * DRAWER_HEIGHT + 'px';
    this.panel.style.top = top + height * DRAWER_TOP + 'px';
    this.panel.style.width = window.innerWidth * DRAWER_WIDTH + 'px';
  }

  _paint(reveal) {
    if (!this.panel) return;
    this.panel.style.transform = `translateX(${window.innerWidth * DRAWER_WIDTH - reveal}px)`;
  }

  _settle(opened) {
    if (!this.root && !opened) return;
    this._ensurePanel();
    this._stopMotion();
    this.opened = opened;
    this.settling = true;
    this.root.dataset.state = opened ? 'opening' : 'closing';
    this.diag.log('settle', null, { to: this.root.dataset.state });
    // Keep opening buttons as touch targets; their click handlers remain gated
    // until settling finishes or a fresh contact completes it early.
    this.panel.inert = !opened;
    const duration = slideDuration();
    this.panel.style.transition = `transform ${duration}ms ease-out`;
    this._paint(opened ? window.innerWidth * DRAWER_WIDTH : 0);
    this.timer = setTimeout(() => this._finishDrawerSettle(opened), duration);
  }

  _finishDrawerSettle(opened) {
    this._stopMotion();
    this.settling = false;
    if (!opened) this._remove();
    else {
      this.root.dataset.state = 'open';
      this.diag.log('settle', null, { to: 'open' });
      this.panel.style.transition = '';
      this.panel.inert = false;
      this.panel.querySelector('button').focus({ preventScroll: true });
    }
  }

  _remove() {
    if (!this.root) return;
    this._stopMotion();
    this.unregisterDismiss?.();
    this.unregisterDismiss = null;
    this.root?.remove();
    this.root = this.panel = null;
    this.opened = this.settling = false;
    // The exit of a handoff keeps the modal they share.
    if (!this.exitUnderlay) this.core.setModalOpen(MODAL_SOURCE, false);
    if (this.previousFocus?.isConnected && this.previousFocus !== this.core.inputArea) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  }

  close(immediate = false) {
    if (this.track?.layer) this._cancel();
    this.track = null;
    if (this.root) return immediate ? this._remove() : this._settle(false);
    // Leaving the article is what a handoff expects; it ends on its own.
    if (this.stack.handingOff) return;
    if (this.exitUnderlay) this._removeExit();
  }

  // Kept layers survive resizing: a revealed layer re-renders at the new
  // width when it is shown (fitViewport). A handoff keeps its swipes and
  // drawer.
  _resize() {
    if (!this.stack.handingOff && (this.track || this.exitUnderlay)) this.close(true);
    else if (this.root) {
      this._geometry();
      this._paint(this.opened ? window.innerWidth * DRAWER_WIDTH : 0);
    }
  }

  _key(event) {
    if (!this.root) return;
    if (event.key === 'Escape') {
      this._consume(event);
      this.close();
    } else if (event.key === 'Tab') {
      this._consume(event);
      if (this.settling) return;
      const buttons = [...this.panel.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
    }
  }

  disconnected() {
    this.close(true);
    // The page underneath goes with the connection.
    this.entry?.end();
    this.stack.disconnected();
  }

  destroy() {
    this._setNativeTouchMove(false);
    this.close(true);
    this.entry?.end();
    this.stack.clear();
    this.listeners.forEach(remove => remove());
    this.core.buf.removeEventListener('viewUpdate', this._refresh);
    this.core.buf.removeEventListener('screenSettled', this._refresh);
    this.unsubscribeMobile();
    this.core.view.mainDisplay.classList.remove('articleHorizontalGestures');
  }
}
