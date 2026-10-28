// What a debug recording keeps of the article drawer's input (#11): each
// contact and click it met, so a tap that does nothing on a device can be
// traced, with the drawer's state at the time, and each contact that started
// no swipe, with what decided it.
import { readEffectivePrefs } from './pref_storage';
import { serializedOpHint } from './serialized_op_gate';

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

export class DrawerDiagnostics {
  constructor(gestures) {
    this.gestures = gestures;
  }

  // Record the drawer's input through `listen`, ArticleGestures' own listener
  // registration. They are added after its handlers, so the states logged are
  // after handling (taps right after the drawer opens).
  listen(listen) {
    const g = this.gestures;
    let contact = null;
    const drawerInput = () => g.root || g.track;
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click']) {
      listen(window, type, event => {
        if (type === 'touchstart' && event.touches.length === 1) contact = { uncancelable: false, scrolled: false };
        if (drawerInput()) this.log(type, event);
        else if (type === 'pointerdown' && event.pointerType === 'touch' && event.isPrimary && g.core.debugRecorder?.isRecording)
          this.log('noSwipe', event, this._swipeGates());
      }, true);
    }
    // Native scrolling that took the contact over leaves later moves
    // uncancelable; record the first such move and scroll of each contact.
    listen(window, 'touchmove', event => {
      if (!contact || contact.uncancelable || event.cancelable || !drawerInput()) return;
      contact.uncancelable = true;
      this.log('touchmoveUncancelable', event);
    }, { capture: true, passive: true });
    listen(window, 'scroll', event => {
      if (!contact || contact.scrolled || !drawerInput()) return;
      contact.scrolled = true;
      this.log('scroll', event);
    }, { capture: true, passive: true });
  }

  // What decides whether a contact starts a swipe, for one that did not.
  _swipeGates() {
    const g = this.gestures;
    const core = g.core;
    const ls = core.listSession;
    return {
      pref: !!readEffectivePrefs().articleHorizontalGestures, pageState: core.buf.pageState,
      article: g.available(), list: g._listLeaveable(), boardList: g._boardListLeaveable(), listCards: !!core.view.listCards,
      owner: core.buf.listRenderOwner || null, listState: ls?.state || null, renderMode: ls?._renderMode || null,
      busy: !!serializedOpHint(core), modal: g._otherModalOpen(), entry: g.entry?.state || null,
      handingOff: !!g.stack.handingOff, surfaceClass: core.view.mainDisplay.classList.contains('articleHorizontalGestures')
    };
  }

  log(name, event, info) {
    const g = this.gestures;
    const rec = g.core.debugRecorder;
    if (!rec?.isRecording) return;
    const now = performance.now();
    rec.log('articleGestures.' + name, {
      t: Math.round(event?.timeStamp ?? now),
      target: event ? diagTarget(event.target) : null,
      cancelable: event?.cancelable, prevented: event?.defaultPrevented,
      primary: event?.isPrimary, pointer: event?.pointerType,
      state: g.root?.dataset.state || null, settling: !!g.settling, opened: g.opened,
      suppressMs: Math.max(0, Math.round(g.suppressClickUntil - now)),
      operation: g.track?.gesture.operation || null,
      ...info
    });
  }
}
