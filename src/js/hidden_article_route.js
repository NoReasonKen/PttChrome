// A key sequence that leaves an easy-reading article and comes back to an
// article out of sight (#65, #77). The article on screen covers the reading
// area until the route lands, the progress bar runs, and reader input waits
// (serializedOpHint). Subclasses send the keys; this owns the cover, the
// parked sessions, the step budget and the landing.
import { SLOW_STEP_BUDGET } from './aid_navigation';
import { StackArticleLayer } from './stack_article_layer';
import { EMPTY_TOOLBAR_CONTEXT } from './mobile_toolbar';
import { parseStatusRow } from './string_util';
import { recordFor } from './reading_record';

const articleShown = facts => facts.kind === 'article' || !!parseStatusRow(facts.rowTexts[facts.rows - 1] || '');

// Input on the cover stays on it; nothing reaches the terminal.
const COVER_INPUT = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'contextmenu', 'dblclick'];

// A copy of the easy-reading article on screen over the reading area, or null
// when none shows.
export function coverWithArticle(view) {
  const layer = StackArticleLayer.capture(view);
  if (!layer) return null;
  layer.show(true);
  layer.el.style.zIndex = '150';
  for (const type of COVER_INPUT) layer.el.addEventListener(type, event => event.stopPropagation());
  return layer;
}

export class HiddenArticleRoute {
  // `name`: the route, for easy reading's landing; `kind`: its command kind
  // prefix; `failed`: the message key shown when the route gives up.
  constructor(core, { name, kind, failed }) {
    this.core = core;
    this.name = name;
    this.kind = kind;
    this.failed = failed;
    this.active = false;
    this.held = false;
    this.cover = null;
    // The App Bar shown while the route runs; null shows the default title.
    this.appBar = null;
  }

  // While the cover is up, the toolbar and App Bar stay those of the article
  // it shows.
  toolbarContext() {
    if (!this.active) return null;
    return { ...EMPTY_TOOLBAR_CONTEXT, appBar: this.appBar || EMPTY_TOOLBAR_CONTEXT.appBar, locked: true };
  }

  // Disconnection.
  reset() {
    if (this.active) this._end();
  }

  _begin(appBar) {
    this.active = true;
    this.held = false;
    this.appBar = appBar;
    this._cover();
  }

  _enqueue(step) {
    this.core.commandQueue.enqueue({
      ...SLOW_STEP_BUDGET,
      fullRepaint: true,
      ...step,
      onFail: reason => this._fail(`${step.kind}: ${reason || 'timeout'}`),
      onFlushed: () => this._fail(`${step.kind}: flushed`)
    });
  }

  // The route continues out of sight: the sessions that would present the
  // screens on the way are parked, as for any external navigation. The
  // article list is parked even when it never presented this board (the
  // article was opened some other way): it would otherwise take over the
  // first list frame on the way and follow the route's screens.
  _hold() {
    const core = this.core;
    this.held = true;
    core.holdBusy?.(true);
    core.easyReading?._enterFunctionMode();
    core.listSession?.beginExternalNavigation({ fromIdle: true });
    core.boardListSession?.beginExternalNavigation();
  }

  // `rowContext`: the list row of the article it opens, the identity of an
  // article without a header (#77).
  _open(keys, rowContext = null) {
    this._enqueue({
      keys,
      kind: this.kind + '-open',
      expect: (snapshot, facts) => articleShown(facts),
      onDone: () => {
        this.core.view.adoptListRowContext(rowContext);
        // Unlock first: easy reading's paging waits for no transaction.
        this.active = false;
        this.core.easyReading?.ensureEnabledOnArticle(true, this.name);
        this._landed();
        recordFor(this.core).releaseExternal();
        this._end();
      }
    });
  }

  // The article has opened again; easy reading has it.
  _landed() {}

  // A step's check failed (#193): the article stays shown under its cover,
  // handed to the article hold, and pull-to-refresh retries.
  _fail(reason = 'failed') {
    if (!this.active) return;
    const cover = this.cover;
    const parked = this.held;
    this.cover = null;
    this._end();
    const hold = this.core.articleHold;
    if (hold) hold.hold({ source: this.name, reason, message: this.failed, cover, appBar: this.appBar, parked });
    else cover?.destroy();
  }

  _cover() {
    this.cover = coverWithArticle(this.core.view);
  }

  _end() {
    const core = this.core;
    this.active = false;
    this.cover?.destroy();
    this.cover = null;
    core.holdBusy?.(false);
    core._refreshScreenContext?.();
  }
}
