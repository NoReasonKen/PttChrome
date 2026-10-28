import { readEffectivePrefs } from './pref_storage';
import { mobileToolbarContext } from './mobile_toolbar';
import { i18n } from './i18n';
import { serializedOpHint } from './serialized_op_gate';
import { ArticleHorizontalGesture, ARTICLE_GESTURE_SLOP } from './article_horizontal_gesture';
import { NavigationStack } from './navigation_stack';
import { StackEntry } from './stack_entry';
import { createUnderlay, holdSurfaces, releaseSurfaces, paintSurfaces, slideDuration } from './stack_motion';
import { OWNER_ARTICLE_LIST } from './list_render_owner';
import { recordFor } from './reading_record';
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

// What a debug recording names an event's target by.
function diagTarget(target) {
  const el = target?.nodeType === 1 ? target : target?.parentElement;
  if (!el) return null;
  const shortcut = el.closest('[data-article-shortcut]');
  if (shortcut) return 'shortcut:' + shortcut.getAttribute('data-article-shortcut');
  if (el.matches('[data-article-drawer]')) return 'backdrop';
  if (el.closest('.articleShortcutDrawer')) return 'panel';
  if (el.closest('.main')) return 'article';
  return el.tagName.toLowerCase();
}


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
    this.earlyBacks = null;
    this.listeners = [];
    this.stack = new NavigationStack(core);
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
      this._diag('clickSuppressed', event);
    }, true);
    this._listen(window, 'contextmenu', event => {
      if (this.track?.gesture.operation || this.opened) this._consume(event);
    }, true);
    this._listen(window, 'keydown', event => this._key(event), true);
    this._diagInput();
    this._listen(window, 'resize', () => this._resize());
    if (window.visualViewport) this._listen(window.visualViewport, 'resize', () => this._resize());
    this._refresh = () => this.update();
    core.buf.addEventListener('viewUpdate', this._refresh);
    core.buf.addEventListener('screenSettled', this._refresh);
    this.unsubscribeMobile = core.onMobileChange(this._refresh);
    this.update();
  }

  // A debug recording keeps what each contact and click on the drawer met, so
  // a tap that does nothing on a device can be traced (taps right after the
  // drawer opens). Listeners run after the ones above, so states are after
  // handling.
  _diagInput() {
    let contact = null;
    const drawerInput = () => this.root || this.track;
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click']) {
      this._listen(window, type, event => {
        if (type === 'touchstart' && event.touches.length === 1) contact = { uncancelable: false, scrolled: false };
        if (drawerInput()) this._diag(type, event);
      }, true);
    }
    // Native scrolling that took the contact over leaves later moves
    // uncancelable; record the first such move and scroll of each contact.
    this._listen(window, 'touchmove', event => {
      if (!contact || contact.uncancelable || event.cancelable || !drawerInput()) return;
      contact.uncancelable = true;
      this._diag('touchmoveUncancelable', event);
    }, { capture: true, passive: true });
    this._listen(window, 'scroll', event => {
      if (!contact || contact.scrolled || !drawerInput()) return;
      contact.scrolled = true;
      this._diag('scroll', event);
    }, { capture: true, passive: true });
  }

  _diag(name, event, info) {
    const rec = this.core.debugRecorder;
    if (!rec?.isRecording) return;
    const now = performance.now();
    rec.log('articleGestures.' + name, {
      t: Math.round(event?.timeStamp ?? now),
      target: event ? diagTarget(event.target) : null,
      cancelable: event?.cancelable, prevented: event?.defaultPrevented,
      primary: event?.isPrimary, pointer: event?.pointerType,
      state: this.root?.dataset.state || null, settling: !!this.settling, opened: this.opened,
      suppressMs: Math.max(0, Math.round(this.suppressClickUntil - now)),
      operation: this.track?.gesture.operation || null,
      ...info
    });
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

  // An easy-reading article list swipes right to go back (#32), under the
  // same preference; it has no drawer.
  listSwipeAvailable() {
    return !!(readEffectivePrefs().articleHorizontalGestures && this.core.buf.pageState === 2 && this._listLeaveable());
  }

  // The page a contact starting now would swipe: 'article', 'list' or null.
  _swipeLevel() {
    return this.available() ? 'article' : this.listSwipeAvailable() ? 'list' : null;
  }

  update() {
    this.stack.update();
    const available = this.available();
    const swipeable = available || this.listSwipeAvailable();
    this.core.view.mainDisplay.classList.toggle('articleHorizontalGestures', swipeable);
    this._setNativeTouchMove(swipeable);
    const { board, author, title } = articleIdentity(this.core);
    const identity = [board, author, title, this.core.easyReading?._articleKey].join('\n');
    // A list being swiped or left stays while it can be left: its own paging
    // redraws the screen meanwhile.
    const leavingList = (this.track?.level || (this.exitUnderlay && this.exitLevel)) === 'list';
    const lost = leavingList ? !this._listLeaveable() : !available || (this.identity && identity !== this.identity);
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
    // A revealed list owns its input until the real list takes over, and a page
    // sliding in is not there until PTT has answered.
    this.entry?.land();
    if (this.stack.handingOff || this.entry) return;
    if (this.track) {
      this._cancel();
      return;
    }
    const level = this._swipeLevel();
    if (!event.isPrimary || !level || this._otherModalOpen()) return;
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
        width, opened: this.opened, allowExit: true, allowOpen: level === 'article', x: event.clientX, y: event.clientY, t: event.timeStamp
      })
    };
  }

  _move(event) {
    const track = this.track;
    if (!track || event.pointerId !== track.id) return;
    if (this._swipeLevel() !== track.level || this._otherModalOpen()) return this._cancel();
    const snapshot = track.gesture.move(event.clientX, event.clientY, event.timeStamp);
    if (this.opened || snapshot.operation) {
      this._consume(event);
      if (snapshot.operation) {
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
    if (track.gesture.operation === 'exit') return this._settleExit(result.exit);
    this._settle(result.opened);
  }

  _cancel() {
    if (!this.track) return;
    const opened = this.track.gesture.opened;
    const recognized = !!this.track.gesture.operation;
    this.track = null;
    if (recognized) {
      this.suppressClickUntil = performance.now() + 400;
      if (this.exitUnderlay) return this._settleExit(false);
      this._settle(opened);
    }
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

  // A leave is on its way to PTT, from the committed slide on: other input
  // waits for the swap.
  holdsInput() {
    return (this.stack.handingOff || this.earlyBacks != null) && !this.sendingBack;
  }

  // A Back made meanwhile unwinds further after the swap (#34).
  queueBack() {
    if (!this.stack.queueBack() && this.earlyBacks != null) this.earlyBacks++;
  }

  // A session presented a real page: an article list, a board list or the
  // home dashboard.
  pagePresented(kind) {
    // The page an open came from, presented again: nothing was entered.
    if (this.entry?.loading && kind === this.entry.from) this.dropPendingLayer();
    this.stack.pagePresented(kind);
    this.entry?.answered();
  }

  // Back from an article or an article list (←, system Back, the toolbar)
  // reveals the lower page the same way the article swipe does. Returns true
  // when it took the key.
  handleBack(event) {
    if (event.key !== 'ArrowLeft' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
    this.entry?.land();
    if (this.sendingBack || this.stack.handingOff || this.entry || this.track || this.exitUnderlay || this.root) return false;
    const core = this.core;
    if (this._otherModalOpen()) return false;
    const level = this._articleLeaveable() ? 'article' : this._listLeaveable() ? 'list' : null;
    if (!level || core.buf.pageState !== (level === 'article' ? 3 : 2) || !this.stack.revealable()) return false;
    this.exitLevel = level;
    this._ensureExit();
    this._settleExit(true);
    return true;
  }

  _ensureExit() {
    if (this.exitUnderlay) return;
    const layer = this.stack.revealable();
    this.exitUnderlay = createUnderlay(this.core, layer, this.stack.title);
    this.exitUnderlay.setAttribute('data-article-exit-underlay', '');
    this.exitUnderlay.dataset.preview = layer ? 'layer' : 'fallback';
    this.exitSurfaces = holdSurfaces(this.core);
    this.core.setModalOpen(MODAL_SOURCE, true);
  }

  _paintExit(distance) {
    paintSurfaces(this.exitSurfaces || [], distance);
  }

  _settleExit(commit) {
    if (!this.exitUnderlay) return;
    this._stopMotion();
    this.settling = true;
    const identity = this.identity;
    const duration = slideDuration();
    this.earlyBacks = commit ? 0 : null;
    for (const { node } of this.exitSurfaces) node.style.transition = `translate ${duration}ms ease-out`;
    this._paintExit(commit ? window.innerWidth : 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      const earlyBacks = this.earlyBacks || 0;
      this.earlyBacks = null;
      const valid = commit && this._leaveable() && identity === this.identity;
      if (valid) this._handoff(earlyBacks);
      else this._removeExit();
    }, duration);
  }

  // The article stays off screen over the revealed list, or the dark fallback,
  // until the real list is presented (#20, #28). `earlyBacks` made during the
  // slide are queued once the handoff is under way.
  _handoff(earlyBacks) {
    const core = this.core;
    const sent = this.stack.begin({
      level: this.exitLevel,
      send: () => {
        const record = recordFor(core);
        const bookmark = record.begin(this.exitLevel === 'list' ? 'list-back-reveal' : 'article-swipe-exit');
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
          if (sent) core.setModalOpen(MODAL_SOURCE, true);
        }
        return sent;
      },
      finish: () => this._removeExit(),
      cancel: () => this._settleExit(false),
      hint: () => core.view.flashListHint?.(i18n('stack_handoffTimeout'), 4000)
    });
    for (let i = 0; sent && i < earlyBacks; i++) this.stack.queueBack();
  }

  // The current page can be left now, by any Back.
  _leaveable() {
    return this.exitLevel === 'list' ? this._listLeaveable() : this._articleLeaveable();
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

  _removeExit() {
    if (!this.exitUnderlay) return;
    this._stopMotion();
    this.earlyBacks = null;
    if (!this.stack.handingOff) this.stack.revealable()?.hide();
    releaseSurfaces(this.exitSurfaces);
    this.exitUnderlay.remove();
    this.exitUnderlay = this.exitSurfaces = null;
    this.settling = false;
    this.core.setModalOpen(MODAL_SOURCE, false);
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
      if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > ARTICLE_GESTURE_SLOP) return;
      const button = tap.target.closest?.('[data-article-shortcut]');
      if (button ? !button.contains(event.target) : tap.target !== this.root || event.target !== this.root || this.settling) return;
      this._consume(event);
      this.suppressClickUntil = performance.now() + 400;
      this._diag('tapUp', event, { action: button?.getAttribute('data-article-shortcut') || null });
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
        this._diag('shortcutClick', event, { action: action.key });
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

  _runShortcut(action) {
    const gate = !this.opened ? 'closed' : this.settling ? 'settling' : !this.available() ? 'unavailable' : null;
    if (gate) return this._diag('shortcutRefused', null, { action: action.key, gate });
    this.close(true);
    if (!mobileToolbarContext(this.core).threadNav) return;
    this.core.noteUserAction();
    if (action.key === 'author' || action.key === 'thread') this.core.articleShortcutSearch.start(action.key);
    else this.core.view.sendKeyAsUser(action.key);
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
    this._diag('settle', null, { to: this.root.dataset.state });
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
      this._diag('settle', null, { to: 'open' });
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
    this.core.setModalOpen(MODAL_SOURCE, false);
    if (this.previousFocus?.isConnected && this.previousFocus !== this.core.inputArea) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  }

  close(immediate = false) {
    this.track = null;
    // Leaving the article is what a handoff expects; it ends on its own.
    if (this.stack.handingOff) return;
    if (this.exitUnderlay) return this._removeExit();
    if (immediate) this._remove();
    else this._settle(false);
  }

  // Kept layers survive resizing: a revealed layer re-renders at the new
  // width when it is shown (fitViewport).
  _resize() {
    if (this.track || this.exitUnderlay) this.close(true);
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
