// A page of its own over the easy-reading list: the user query page (#199,
// user_query.js) and the board entry screen page (#292, board_notes.js). The
// list stays on screen under it, held, and shows at once when the page leaves.
//
// This is the page's shell, shared by both: it slides in from the right over
// the list's own area, follows the window's geometry, takes the keyboard's
// keys first (a window listener in the capture phase, the keypad's sticky
// Ctrl applied first), keeps taps on it away from the terminal, and a swipe
// right leaves it. What the page shows, which keys it answers and what
// leaving tells PTT stay with its owner.
import { slideDuration } from './stack_motion';
import { ArticleHorizontalGesture } from './article_horizontal_gesture';
import { inputPage } from './input_page';
import { takeStickyCtrl } from './mobile_layout';
import { keyEventPredatesModalClose } from './modal_key_gate';

// The terminal's mouse entrances listen on window: a tap on the page is not a
// tap on PTT's screen.
const MOUSE_INPUT = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'];

export class OverListPage {
  // view: the terminal view (its mainDisplay gives the list's area).
  // marker: the page carries data-<marker>-page while shown and
  //   data-<marker>-leaving while it slides away.
  // className, label: the page's class names and its accessible name.
  // onKey(e): every keydown on window while the page is open.
  // canSwipe(): whether a swipe may leave the page now.
  // onSwipeLeave(): a swipe right left the page.
  constructor(view, { marker, className, label, onKey, canSwipe, onSwipeLeave }) {
    this.view = view;
    this._marker = marker;
    this._onKeyHandler = onKey;
    this._canSwipe = canSwipe;
    this._onSwipeLeave = onSwipeLeave;
    this._swipe = null;
    this._onKey = null;
    this._onResize = null;
    const el = document.createElement('div');
    el.className = className + ' nomouse_command';
    el.setAttribute('data-' + marker + '-page', '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', label);
    this.el = el;
  }

  // Slide the page in over the list. `onPlaced` runs after every placement
  // (the open, a window resize), once the page's width is set. Returns
  // whether it opened: the list's area must be on the page.
  open(onPlaced) {
    const main = this.view && this.view.mainDisplay;
    if (!main || !main.parentNode) return false;
    const page = this.el;
    this._onPlaced = onPlaced || null;
    this.place();
    for (const type of MOUSE_INPUT) page.addEventListener(type, (e) => e.stopPropagation());
    this._bindSwipe(page);
    main.parentNode.appendChild(page);
    if (this._onPlaced) this._onPlaced();
    const ms = slideDuration();
    if (ms) {
      page.style.translate = '100% 0';
      page.getBoundingClientRect();
      page.style.transition = `translate ${ms}ms ease-out`;
      page.style.translate = '0 0';
    }
    this._onResize = () => {
      this.place();
      if (this._onPlaced) this._onPlaced();
    };
    window.addEventListener('resize', this._onResize);
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey, true);
    return true;
  }

  // A keyboard key while the page is open. The keypad's sticky Ctrl comes
  // first, as at the terminal's own entrances (mobile_layout.takeStickyCtrl):
  // the key goes on as the keypad's Ctrl+key (term_view.sendKeyAsUser), which
  // the page judges as a key that is no keydown on window. Only while the page
  // owns the keys: a sheet over it keeps its own, and a key that closed one
  // (Esc) is already answered.
  _key(e) {
    const view = this.view;
    const core = view && view.bbscore;
    const mine = inputPage(core) && view.sendKeyAsUser &&
      !keyEventPredatesModalClose(e.timeStamp, core.anyModalClosedAt);
    const mods = mine ? takeStickyCtrl(core, e) : null;
    if (!mods) return void this._onKeyHandler(e);
    e.preventDefault();
    e.stopImmediatePropagation();
    view.sendKeyAsUser(mods.key, mods);
  }

  // Over the list's own area (between the App Bar and the toolbar on mobile).
  // Only the sides are measured here (the terminal's). The top and bottom
  // edges are CSS: --term-top-inset (the App Bar) and --term-bottom-inset
  // (toolbar, the keypad over it and the safe area), both kept by
  // App._applyMobileGeometry, so the page follows every geometry change (the
  // keypad opening and closing, the soft keyboard, a resize) as the other
  // overlays do, and never measures a layout the keypad had shifted.
  place() {
    const main = this.view && this.view.mainDisplay;
    if (!main) return;
    const r = main.getBoundingClientRect();
    Object.assign(this.el.style, { left: r.left + 'px', width: r.width + 'px' });
  }

  // A swipe right leaves the page; a swipe left does nothing (no drawer).
  _bindSwipe(page) {
    page.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.pointerType === 'mouse' || !this._canSwipe()) return;
      this._swipe = {
        id: e.pointerId,
        gesture: new ArticleHorizontalGesture({
          width: page.getBoundingClientRect().width || window.innerWidth,
          opened: false, allowExit: true, allowOpen: false, x: e.clientX, y: e.clientY, t: e.timeStamp
        })
      };
    });
    page.addEventListener('pointermove', (e) => {
      const s = this._swipe;
      if (!s || s.id !== e.pointerId) return;
      const snap = s.gesture.move(e.clientX, e.clientY, e.timeStamp);
      if (snap.axis === 'vertical') {
        this._swipe = null;
        return;
      }
      if (snap.operation === 'exit') {
        page.style.transition = '';
        page.style.translate = snap.distance + 'px 0';
      }
    });
    const end = (e, canceled) => {
      const s = this._swipe;
      if (!s || s.id !== e.pointerId) return;
      this._swipe = null;
      const r = s.gesture.release(e.timeStamp, canceled);
      if (r.exit) return void this._onSwipeLeave();
      if (s.gesture.operation !== 'exit') return;
      const ms = slideDuration();
      page.style.transition = ms ? `translate ${ms}ms ease-out` : '';
      page.style.translate = '0 0';
    };
    page.addEventListener('pointerup', (e) => end(e, false));
    page.addEventListener('pointercancel', (e) => end(e, true));
  }

  // Take the page away. slide: it slides out over the list, which shows at
  // once under it; otherwise it goes at once.
  close(slide) {
    if (this._onKey) window.removeEventListener('keydown', this._onKey, true);
    this._onKey = null;
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onResize = null;
    this._onPlaced = null;
    this._swipe = null;
    const page = this.el;
    page.removeAttribute('data-' + this._marker + '-page');
    page.setAttribute('data-' + this._marker + '-leaving', '');
    page.inert = true;
    const ms = slide ? slideDuration() : 0;
    if (!ms) return void page.remove();
    page.style.transition = `translate ${ms}ms ease-in`;
    page.style.translate = '100% 0';
    setTimeout(() => page.remove(), ms);
  }
}
