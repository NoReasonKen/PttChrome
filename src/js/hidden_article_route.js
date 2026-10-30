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
import { i18n } from './i18n';

const articleShown = facts => facts.kind === 'article' || !!parseStatusRow(facts.rowTexts[facts.rows - 1] || '');

// Input on the cover stays on it; nothing reaches the terminal.
const COVER_INPUT = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'contextmenu', 'dblclick'];

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
      onFail: () => this._fail(),
      onFlushed: () => this._fail()
    });
  }

  // The route continues out of sight: the sessions that would present the
  // screens on the way are parked, as for any external navigation.
  _hold() {
    const core = this.core;
    this.held = true;
    core.holdBusy?.(true);
    core.easyReading?._enterFunctionMode();
    core.listSession?.beginExternalNavigation();
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
        recordFor(this.core).releaseExternal();
        this._end();
      }
    });
  }

  _fail() {
    if (!this.active) return;
    const held = this.held;
    this._end();
    if (held) recordFor(this.core).releaseExternal({ listNotice: i18n(this.failed) });
    this.core.view.flashListHint?.(i18n(this.failed), 4000);
  }

  _cover() {
    const layer = StackArticleLayer.capture(this.core.view);
    if (!layer) return;
    this.cover = layer;
    layer.show(true);
    layer.el.style.zIndex = '150';
    for (const type of COVER_INPUT) layer.el.addEventListener(type, event => event.stopPropagation());
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
