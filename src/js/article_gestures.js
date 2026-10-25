import { readEffectivePrefs } from './pref_storage';
import { mobileToolbarContext } from './mobile_toolbar';
import { i18n } from './i18n';
import { serializedOpHint } from './serialized_op_gate';
import { ArticleHorizontalGesture, ARTICLE_SETTLE_MS } from './article_horizontal_gesture';
import '../css/article_gestures.css';

const MODAL_SOURCE = 'articleShortcutDrawer';
const ACTIONS = [
  { key: '[', label: 'mobileToolbar_threadPrev' },
  { key: '=', label: 'mobileToolbar_threadFirst' },
  { key: ']', label: 'mobileToolbar_threadNext' }
];
const EXCLUDED = 'input, textarea, select, button, [contenteditable="true"], video, audio, iframe, [role="slider"], .easyReadingVideo';

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
    this._listen(window, 'pointerdown', event => this._start(event), true);
    this._listen(window, 'pointermove', event => this._move(event), { capture: true, passive: false });
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
    const available = this.available();
    this.core.view.mainDisplay.classList.toggle('articleHorizontalGestures', available);
    const view = this.core.view;
    const identity = [view._articleBoard, view._articleAuthor, view._articleTitle].join('\n');
    if (!available || (this.identity && identity !== this.identity)) this.close(true);
    this.identity = identity;
  }

  _start(event) {
    if (event.isPrimary) this.suppressClickUntil = 0;
    if (event.pointerType !== 'touch') return;
    if (this.track) {
      this._cancel();
      return;
    }
    if (!event.isPrimary || !this.available() || this.settling) return;
    if (this.core.modalShown && !this.root) return;
    if (this.core._openModals?.size > (this.root ? 1 : 0)) return;
    const target = event.target;
    if (!this.opened && (!this.core.view.mainDisplay.contains(target) || target.closest(EXCLUDED))) return;
    if (!this.opened && (this.core.mobileSelectMode || !window.getSelection().isCollapsed)) return;
    const width = window.innerWidth;
    this.track = {
      id: event.pointerId,
      gesture: new ArticleHorizontalGesture({ width, opened: this.opened, x: event.clientX, y: event.clientY, t: event.timeStamp })
    };
  }

  _move(event) {
    const track = this.track;
    if (!track || event.pointerId !== track.id) return;
    if (!this.available() || (this.core.modalShown && !this.root) ||
        this.core._openModals?.size > (this.root ? 1 : 0)) return this._cancel();
    const snapshot = track.gesture.move(event.clientX, event.clientY, event.timeStamp);
    if (this.opened || snapshot.operation) {
      this._consume(event);
      if (snapshot.operation) {
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
    this._settle(result.opened);
  }

  _cancel() {
    if (!this.track) return;
    const opened = this.track.gesture.opened;
    const recognized = !!this.track.gesture.operation;
    this.track = null;
    if (recognized) {
      this.suppressClickUntil = performance.now() + 400;
      this._settle(opened);
    }
  }

  _consume(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  _ensurePanel() {
    if (this.root) return;
    this.previousFocus = document.activeElement;
    this.root = document.createElement('div');
    this.root.className = 'articleDrawerRoot nomouse_command';
    this.root.setAttribute('data-article-drawer', '');
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
        this.core.view.sendKeyAsUser(action.key);
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
    this.panel.style.height = Math.max(0, bottom - top) * 0.6 + 'px';
    this.panel.style.top = top + Math.max(0, bottom - top) * 0.2 + 'px';
    this.panel.style.width = window.innerWidth * 0.75 + 'px';
  }

  _paint(reveal) {
    if (!this.panel) return;
    this.panel.style.transform = `translateX(${window.innerWidth * 0.75 - reveal}px)`;
  }

  _settle(opened) {
    if (!this.root && !opened) return;
    this._ensurePanel();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    clearTimeout(this.timer);
    this.opened = opened;
    this.settling = true;
    this.root.dataset.state = opened ? 'opening' : 'closing';
    this.panel.inert = true;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ARTICLE_SETTLE_MS;
    this.panel.style.transition = `transform ${duration}ms ease-out`;
    this._paint(opened ? window.innerWidth * 0.75 : 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.settling = false;
      if (!opened) this._remove();
      else {
        this.root.dataset.state = 'open';
        this.panel.style.transition = '';
        this.panel.inert = false;
        this.panel.querySelector('button').focus({ preventScroll: true });
      }
    }, duration);
  }

  _remove() {
    if (!this.root) return;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    clearTimeout(this.timer);
    this.timer = null;
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
    if (immediate) this._remove();
    else this._settle(false);
  }

  _resize() {
    if (this.track) this.close(true);
    else if (this.root) {
      this._geometry();
      this._paint(this.opened ? window.innerWidth * 0.75 : 0);
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
    this.close(true);
    this.listeners.forEach(remove => remove());
    this.core.buf.removeEventListener('viewUpdate', this._refresh);
    this.core.buf.removeEventListener('screenSettled', this._refresh);
    this.unsubscribeMobile();
    this.core.view.mainDisplay.classList.remove('articleHorizontalGestures');
  }
}
