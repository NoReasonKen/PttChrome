import { readEffectivePrefs } from './pref_storage';
import { mobileToolbarContext } from './mobile_toolbar';
import { i18n } from './i18n';
import { serializedOpHint } from './serialized_op_gate';
import { ArticleHorizontalGesture, ARTICLE_SETTLE_MS } from './article_horizontal_gesture';
import { ArticleExitPreview } from './article_exit_preview';
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

const settleDuration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ARTICLE_SETTLE_MS;

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
    this.listeners = [];
    this.exitPreview = new ArticleExitPreview(core);
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
      if (performance.now() < this.suppressClickUntil) this._consume(event);
    }, true);
    this._listen(window, 'contextmenu', event => {
      if (this.track?.gesture.operation || this.opened) this._consume(event);
    }, true);
    this._listen(window, 'keydown', event => this._key(event), true);
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

  update() {
    this.exitPreview.update();
    // Resize events already adapt an open panel or cancel its active drag.
    // A temporary PTT footer mismatch must not dismiss that open panel.
    if (this.core.buf.easyReadingResizeInFlight && this.root && !this.track) return;
    const available = this.available();
    this.core.view.mainDisplay.classList.toggle('articleHorizontalGestures', available);
    this._setNativeTouchMove(available);
    const { board, author, title } = articleIdentity(this.core);
    const identity = [board, author, title, this.core.easyReading?._articleKey].join('\n');
    if (!available || (this.identity && identity !== this.identity)) this.close(true);
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
    if (this.track) {
      this._cancel();
      return;
    }
    if (!event.isPrimary || !this.available() || this._otherModalOpen()) return;
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
      gesture: new ArticleHorizontalGesture({ width, opened: this.opened, allowExit: true, x: event.clientX, y: event.clientY, t: event.timeStamp })
    };
  }

  _move(event) {
    const track = this.track;
    if (!track || event.pointerId !== track.id) return;
    if (!this.available() || this._otherModalOpen()) return this._cancel();
    const snapshot = track.gesture.move(event.clientX, event.clientY, event.timeStamp);
    if (this.opened || snapshot.operation) {
      this._consume(event);
      if (snapshot.operation) {
        if (snapshot.operation === 'exit') {
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

  captureListPreview() {
    if (readEffectivePrefs().articleHorizontalGestures) this.exitPreview.capture();
    else this.exitPreview.clear();
  }

  bindListPreview() {
    this.exitPreview.enterArticle();
  }

  clearListPreview() {
    this.exitPreview.clear();
  }

  _ensureExit() {
    if (this.exitUnderlay) return;
    this.exitUnderlay = document.createElement('div');
    this.exitUnderlay.className = 'articleExitUnderlay';
    this.exitUnderlay.setAttribute('data-article-exit-underlay', '');
    this.exitUnderlay.setAttribute('aria-hidden', 'true');
    this.exitUnderlay.inert = true;
    this.exitUnderlay.dataset.preview = this.exitPreview.appendTo(this.exitUnderlay) ? 'list' : 'fallback';
    const toolbar = document.getElementById('mobileToolbar');
    this.exitUnderlay.style.height = (toolbar?.getBoundingClientRect().top ?? window.innerHeight) + 'px';
    this.core.view.mainDisplay.parentNode.appendChild(this.exitUnderlay);
    this.exitSurfaces = [this.core.view.mainDisplay, document.getElementById('mobileAppBar')].filter(Boolean).map(node => ({
      node, translate: node.style.translate, transition: node.style.transition, zIndex: node.style.zIndex
    }));
    for (const { node } of this.exitSurfaces) {
      node.classList.add('articleExitMoving');
      node.style.zIndex = '152';
    }
    this.core.setModalOpen(MODAL_SOURCE, true);
  }

  _paintExit(distance) {
    for (const { node } of this.exitSurfaces || []) node.style.translate = `${distance}px 0`;
  }

  _settleExit(commit) {
    if (!this.exitUnderlay) return;
    this._stopMotion();
    this.settling = true;
    const identity = this.identity;
    const duration = settleDuration();
    for (const { node } of this.exitSurfaces) node.style.transition = `translate ${duration}ms ease-out`;
    this._paintExit(commit ? window.innerWidth : 0);
    this.timer = setTimeout(() => {
      const valid = commit && this.available() && identity === this.identity;
      this._removeExit();
      if (valid) {
        const record = recordFor(this.core);
        const bookmark = record.begin('article-swipe-exit');
        this.core.noteUserAction();
        let sent = false;
        try {
          sent = this.core.sendNavKeyAsUser('ArrowLeft');
        } finally {
          record.end(bookmark, sent ? 'done' : 'cancel');
        }
      }
    }, duration);
  }

  _removeExit() {
    if (!this.exitUnderlay) return;
    this._stopMotion();
    for (const surface of this.exitSurfaces) {
      surface.node.style.translate = surface.translate;
      surface.node.style.transition = surface.transition;
      surface.node.style.zIndex = surface.zIndex;
      surface.node.classList.remove('articleExitMoving');
    }
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
        if (!this.opened || this.settling || !this.available()) return;
        this.close(true);
        if (!mobileToolbarContext(this.core).threadNav) return;
        this.core.noteUserAction();
        if (action.key === 'author' || action.key === 'thread') this.core.articleShortcutSearch.start(action.key);
        else this.core.view.sendKeyAsUser(action.key);
      });
      this.panel.appendChild(button);
    }
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    this._geometry();
    this._paint(0);
    this.unregisterDismiss = this.core.registerSheetDismiss(() => this.close());
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
    // Keep opening buttons as touch targets; their click handlers remain gated
    // until settling finishes or a fresh contact completes it early.
    this.panel.inert = !opened;
    const duration = settleDuration();
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
    if (this.exitUnderlay) return this._removeExit();
    if (immediate) this._remove();
    else this._settle(false);
  }

  // A captured list preview survives resizing; it checks whether it still
  // matches the viewport when an exit drag shows it.
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

  destroy() {
    this._setNativeTouchMove(false);
    this.close(true);
    this.exitPreview.clear();
    this.listeners.forEach(remove => remove());
    this.core.buf.removeEventListener('viewUpdate', this._refresh);
    this.core.buf.removeEventListener('screenSettled', this._refresh);
    this.unsubscribeMobile();
    this.core.view.mainDisplay.classList.remove('articleHorizontalGestures');
  }
}
