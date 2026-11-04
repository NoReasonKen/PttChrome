// A live article kept underneath the results of an article shortcut search
// (#49): a second instance of the shared screen renderer re-renders the
// article's whole last presented frame over the article's box, scrollable at
// its reading position, so revealing it shows the article at once.
import { ScreenCopyLayer, setUsable, STACK_NOTICE_MS } from './stack_layer';
import { PAGE } from './page_stack';
import { rowToText } from './comment_parse';
import { i18n } from './i18n';

// The article row at the top of `scroller` and its offset from that top.
function topRow(scroller) {
  const top = scroller.getBoundingClientRect().top;
  for (const row of scroller.querySelectorAll('[type="bbsrow"][srow]')) {
    const r = row.getBoundingClientRect();
    if (r.height && r.bottom > top + 1) return { srow: row.getAttribute('srow'), offset: r.top - top };
  }
  return null;
}

// Scroll `scroller` so that `anchor`'s row is back at its offset.
function scrollToRow(scroller, anchor) {
  const row = anchor && scroller.querySelector(`[type="bbsrow"][srow="${anchor.srow}"]`);
  if (!row) return false;
  scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
  return true;
}

// What the real article needs to show this article again as it was left
// (#121): its accumulated rows and where accumulation stood, and the
// new-comments scan that placed its marker. Only an article read to its end
// is kept: rows past a partial read would have to come from PTT.
function articleContent(view) {
  const core = view.bbscore;
  const buf = view.buf;
  const reading = core?.easyReading;
  if (!buf?.pageLines?.length || !reading?.easyReadingReachedPageEnd || reading._reverse || view._reverse) return null;
  const marks = core.newComments;
  return {
    pageLines: buf.pageLines, accEndRow: view._accEndRow, lastSig: view._lastAccumulatedSig,
    marks: marks && { _head: marks._head, _scanner: marks._scanner, _key: marks._key, _seen: marks._seen, _saved: marks._saved }
  };
}

// PTT has reopened the article and easy reading paged it to its end, with
// nothing in flight: a later page would not land on the adopted rows.
function readIdle(core) {
  const reading = core.easyReading;
  return core.buf.pageState === 3 && !!reading?.easyReadingReachedPageEnd && reading._inFlightSig == null &&
    !reading._reverse && !reading._functionMode && !core.buf.easyReadingHealInFlight;
}

const blank = text => !text.trim();

// What PTT's reopened copy `reopened` adds to the rows `shown` (#126): the
// rows past `shown`'s content, which `shown` keeps as a prefix, and how many
// of `shown`'s rows they follow. Trailing blank rows hold no content: a short
// article's last page pads with them. Null when the copy no longer starts with
// `shown`'s content, as after the author edited it; no rows when it adds none.
function reopenedTail(shown, reopened) {
  const was = shown.map(rowToText);
  const now = reopened.map(rowToText);
  let keep = was.length;
  while (keep && blank(was[keep - 1])) keep--;
  if (now.length < keep) return null;
  for (let i = 0; i < keep; i++) if (was[i] !== now[i]) return null;
  const rows = now.slice(keep).some(text => !blank(text)) ? reopened.slice(keep) : [];
  return { keep, rows };
}

export class StackArticleLayer extends ScreenCopyLayer {
  // Render `view`'s current article frame as a live copy over the article's
  // box. Returns null when the view shows no article frame.
  static capture(view) {
    const frame = view.componentScreen?.props;
    const main = view.mainDisplay;
    if (!frame?.lines || !main) return null;
    const rect = main.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return new StackArticleLayer(view, rect, frame);
  }

  constructor(view, rect, frame) {
    super(view, frame, PAGE.ARTICLE);
    const main = view.mainDisplay;
    this._hold = () => {
      this.held = true;
    };
    this._render(rect, frame.forceWidth);
    this.scrollTop = main.scrollTop;
    this.scrollHeight = main.scrollHeight;
    // The reading position by row, for a render at another width.
    this.anchor = topRow(main);
    this.content = articleContent(view);
  }

  _render(rect, forceWidth) {
    this._renderOver(rect, forceWidth, this.frame.enableLinkInlinePreview, this.frame.enhance);
  }

  // Ready to be revealed at the current width; a width change renders the
  // stored frame again over the article's box.
  fitViewport() {
    if (this.width === window.innerWidth) return true;
    const rect = this.view.mainDisplay.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (this.el.isConnected) this.anchor = topRow(this.el);
    this._render(rect, this.view.chh);
    this.scrollTop = null;
    this.scrollHeight = 0;
    if (this.el.isConnected) scrollToRow(this.el, this.anchor);
    return true;
  }

  // Visible, and usable when `usable`: it scrolls, and its input stays local.
  show(usable) {
    if (!this.el.isConnected) {
      this.parent.appendChild(this.el);
      this._place();
      // The renderer's commit and layout settle once the layer is attached:
      // each change of its content puts it back at the reading position, until
      // the reader scrolls it.
      this.held = false;
      this.resizes = new ResizeObserver(() => !this.held && this._place());
      for (const child of this.el.children) if (child !== this.spacer) this.resizes.observe(child);
      this.el.addEventListener('pointerdown', this._hold);
      this.el.addEventListener('wheel', this._hold, { passive: true });
    }
    setUsable(this.el, usable);
  }

  _place() {
    this._fitEnd();
    if (this.scrollTop != null) this.el.scrollTop = this.scrollTop;
    else scrollToRow(this.el, this.anchor);
  }

  // The real article ends with rows of its own below the screen (the last row
  // bar): room for them keeps the reading position near the end reachable.
  _fitEnd() {
    if (!this.spacer) {
      this.spacer = document.createElement('div');
      this.spacer.setAttribute('aria-hidden', 'true');
    }
    this.spacer.style.height = '0';
    this.el.appendChild(this.spacer);
    this.spacer.style.height = Math.max(0, this.scrollHeight - this.el.scrollHeight) + 'px';
  }

  hide() {
    this.resizes?.disconnect();
    this.resizes = null;
    this.el.removeEventListener('pointerdown', this._hold);
    this.el.removeEventListener('wheel', this._hold);
    super.hide();
  }

  // Put the real article at this layer's reading position: the same row at
  // the same offset from the top of the view. The real article shows this
  // layer's content, not PTT's reopened copy (#121).
  alignReal(core) {
    this._adopt(core);
    return scrollToRow(core.view.mainDisplay, topRow(this.el));
  }

  // The real article takes over this layer's rows, in place of what PTT's
  // reopened copy accumulated; PTT's pager stays where the reopen left it.
  // Comments the copy gained are appended behind the new-comments marker,
  // and accumulation continues from the copy's end, where PTT's pager is
  // (#126). The handoff only swaps once no finger is down and scrolling has
  // stopped, and rows added below the reading position leave it in place.
  // A copy that no longer starts with this layer's content adds nothing.
  _adopt(core) {
    const content = this.content;
    if (!content || !readIdle(core)) return false;
    const view = core.view;
    const reopened = { pageLines: core.buf.pageLines, accEndRow: view._accEndRow, lastSig: view._lastAccumulatedSig };
    const tail = reopenedTail(content.pageLines, reopened.pageLines);
    const appends = !!tail?.rows.length;
    const kept = appends ? { ...reopened, pageLines: content.pageLines.slice(0, tail.keep).concat(tail.rows) } : content;
    core.buf.pageLines = kept.pageLines;
    view._accEndRow = kept.accEndRow;
    view._lastAccumulatedSig = kept.lastSig;
    if (content.marks && core.newComments) {
      Object.assign(core.newComments, content.marks);
      if (appends) core.newComments.appended(kept.pageLines, tail.keep);
    }
    view._renderScreenLines(kept.pageLines, true, true, false, view._pageRenderOverrides());
    core.commentBar?.refresh();
    if (!tail) view.flashListHint?.(i18n('stack_articleUpdated'), STACK_NOTICE_MS);
    return true;
  }

  // While PTT reopens the article, its copy must not record comments the
  // reader has not seen as read: the shown article is this layer's.
  holdsReading() {
    return !!this.content;
  }

  // The real article can take over: with content to adopt, once PTT has
  // reopened the article to its end; otherwise once easy reading has paged as
  // far as the reading position.
  reaches(core) {
    if (this.content) return readIdle(core);
    const anchor = topRow(this.el);
    return !anchor || !!core.view.mainDisplay.querySelector(`[type="bbsrow"][srow="${anchor.srow}"]`);
  }

  // An article layer remembers no tap: nothing on it opens a page.
  tapOf() {
    return null;
  }
}
