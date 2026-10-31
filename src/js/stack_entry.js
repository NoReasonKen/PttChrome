// Opening an entry slides the new page in over the page it is opened from
// (#36): the real screen comes in from the right over that page's live layer
// and shows only the loading state until PTT answers. A failed open slides it
// back out over that page.
import { HANDOFF_TIMEOUT_MS } from './page_stack';
import { createUnderlay, holdSurfaces, releaseSurfaces, paintSurfaces, slideDuration } from './stack_motion';

// The loading state's owner while a page slides in.
const LOADING_OWNER = 'stackEntry';

export class StackEntry {
  // `from` is the captured page the entry is opened from: its kind, live layer
  // and title. `onEnd` runs once the motion is over.
  constructor(core, from, onEnd) {
    this.core = core;
    this.from = from.kind;
    this.layer = from.layer;
    this.onEnd = onEnd;
    // 'loading' until PTT answers ('answered') or the open fails ('failed').
    this.state = 'loading';
    this.arrived = false;
    this.dropped = null;
    this.timer = this.frame = null;
    this.underlay = createUnderlay(core, from.layer, from.title, from.appBar);
    this.underlay.setAttribute('data-stack-entry-underlay', '');
    this.surfaces = holdSurfaces(core);
    for (const { node } of this.surfaces) node.classList.add('stackEntryLoading');
    core.view.setListLoading?.(true, LOADING_OWNER);
    paintSurfaces(this.surfaces, window.innerWidth);
    // Commit the start position, so the slide starts from it.
    this.surfaces[0].node.getBoundingClientRect();
    this._slide(0);
    // An article, a screen to pass (a board's entry notice) or the editor is
    // PTT's answer, by whatever route it came; otherwise the answer is the
    // page a session presents. Prompts on the way are not.
    this.settled = () => {
      if ([3, 5, 6].includes(core.buf.pageState)) this.answered();
    };
    core.buf.addEventListener('screenSettled', this.settled);
    // An open that never reports an outcome still shows what PTT shows.
    this.bound = setTimeout(() => this.answered(), HANDOFF_TIMEOUT_MS);
  }

  get loading() {
    return this.state === 'loading';
  }

  // PTT answered the open: the new page shows it as it slides on.
  answered() {
    if (!this.loading) return;
    this.state = 'answered';
    this._showContent();
    if (this.arrived) this.end();
  }

  // The open failed: the new page slides back out, still loading, over the
  // page it came from, which the session's notice is about. `layer`, that
  // page's layer, is no lower page any more and goes with the motion.
  failed(layer) {
    this.state = 'failed';
    this.dropped = layer;
    this.arrived = false;
    this._slide(window.innerWidth);
  }

  // Input for a page PTT has answered ends its slide in place.
  land() {
    if (this.state === 'answered') this.end();
  }

  end() {
    clearTimeout(this.timer);
    clearTimeout(this.bound);
    cancelAnimationFrame(this.frame);
    this.core.buf.removeEventListener('screenSettled', this.settled);
    this._showContent();
    releaseSurfaces(this.surfaces);
    this.underlay.remove();
    // The page opened from stays as the lower page, hidden, unless the open
    // was abandoned.
    this.layer.hide();
    this.dropped?.destroy();
    this.onEnd(this);
  }

  _showContent() {
    for (const { node } of this.surfaces) node.classList.remove('stackEntryLoading');
    this.core.view.setListLoading?.(false, LOADING_OWNER);
  }

  _slide(distance) {
    clearTimeout(this.timer);
    const duration = slideDuration();
    for (const { node } of this.surfaces) node.style.transition = `translate ${duration}ms ease-out`;
    paintSurfaces(this.surfaces, distance);
    this.timer = setTimeout(() => {
      this.arrived = true;
      if (this.state === 'answered') this.end();
      else if (this.state === 'failed') this._endOut(distance);
    }, duration);
  }

  // The page that slid out puts the real screen back in place: its frame
  // fully off screen is painted first.
  _endOut(distance) {
    const node = this.surfaces[0].node;
    this.frame = requestAnimationFrame(() => {
      if (parseFloat(getComputedStyle(node).translate) < distance - 1) return this._endOut(distance);
      this.frame = requestAnimationFrame(() => this.end());
    });
  }
}
