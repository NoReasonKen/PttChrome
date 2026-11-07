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

// Where `anchor`'s row starts in `scroller`'s content, or null.
function rowStart(scroller, anchor) {
  const row = anchor && scroller.querySelector(`[type="bbsrow"][srow="${anchor.srow}"]`);
  return row ? row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop : null;
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
// new-comments scan that placed its marker. `whole`: the article was read to
// its end. Rows past a partial read come from PTT, paged on from the line
// where that read stopped, so a partial read is kept only with that line.
function articleContent(view) {
  const core = view.bbscore;
  const buf = view.buf;
  const reading = core?.easyReading;
  if (!buf?.pageLines?.length || !reading || reading._reverse || view._reverse) return null;
  const whole = !!reading.easyReadingReachedPageEnd;
  if (!whole && (reading._functionMode || view._accEndRow == null)) return null;
  const marks = core.newComments;
  return {
    whole, pageLines: buf.pageLines, accEndRow: view._accEndRow, lastSig: view._lastAccumulatedSig,
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
    // The reading position by row. The copy lays out a long page's chunks
    // afresh, each at an estimated height until it comes into view, so the
    // real article's scroll offset would land elsewhere in it, or past its
    // end; the offset only stands in when no row shows.
    this.anchor = topRow(main);
    this.scrollTop = main.scrollTop;
    // The real article's content from that row down.
    this.tail = main.scrollHeight - (this.anchor ? main.scrollTop + this.anchor.offset : 0);
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
    this.tail = 0;
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
    if (!scrollToRow(this.el, this.anchor) && this.scrollTop != null) this.el.scrollTop = this.scrollTop;
  }

  // The real article ends with rows of its own below the screen (the last row
  // bar): room for as much as it had below the reading position keeps that
  // position near the end reachable.
  _fitEnd() {
    if (!this.spacer) {
      this.spacer = document.createElement('div');
      this.spacer.setAttribute('aria-hidden', 'true');
    }
    this.spacer.style.height = '0';
    this.el.appendChild(this.spacer);
    const start = rowStart(this.el, this.anchor) ?? 0;
    this.spacer.style.height = Math.max(0, start + this.tail - this.el.scrollHeight) + 'px';
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
    if (this.edited) core.view.flashListHint?.(i18n('stack_articleUpdated'), STACK_NOTICE_MS);
    return scrollToRow(core.view.mainDisplay, topRow(this.el));
  }

  // A source read only partly goes on from where that read stopped (#121).
  // Once PTT's reopened copy has accumulated the screen PTT shows, and the
  // layer's content starts with that copy, the real article takes the
  // layer's rows and where their accumulation stood. The next screen PTT
  // sends then falls inside those rows, so easy reading seeks PTT's pager to
  // their end, as after a seek back (`seekBack`), and pages on from there. A
  // copy that starts otherwise was edited: PTT's copy takes over, with a
  // notice. Nothing is done once PTT's copy reaches as far by itself.
  _resume(core) {
    const content = this.content;
    const view = core.view;
    const reading = core.easyReading;
    const buf = core.buf;
    if (view._accEndRow == null || view._accEndRow >= content.accEndRow) return;
    if (buf.pageState !== 3 || !buf.pageLines?.length || reading._reverse || reading._functionMode ||
      buf.easyReadingHealInFlight || view._lastAccumulatedSig !== reading._currentPageSignature()) return;
    if (!reopenedTail(buf.pageLines, content.pageLines)) {
      this.content = null;
      this.edited = true;
      return;
    }
    buf.pageLines = content.pageLines;
    view._accEndRow = content.accEndRow;
    view._lastAccumulatedSig = content.lastSig;
  }

  // The real article takes over this layer's rows, in place of what PTT's
  // reopened copy accumulated; PTT's pager stays where the reopen left it.
  // Comments the copy gained are appended behind the new-comments marker,
  // and accumulation continues from the copy's end, where PTT's pager is
  // (#126). The handoff only swaps once no finger is down and scrolling has
  // stopped, and rows added below the reading position leave it in place.
  // A copy that no longer starts with this layer's content adds nothing: the
  // layer's rows stay shown, while the accumulation state keeps describing
  // PTT's copy, so the next page PTT sends rebuilds from that copy rather than
  // appending to rows it no longer has (story 29). A partial read cannot stay
  // shown that way: PTT's copy takes over, with the same notice. The rows
  // past a partial read were never read, so the new-comments marker stays
  // where that read had it.
  _adopt(core) {
    const content = this.content;
    if (!content || !readIdle(core)) return false;
    const view = core.view;
    const reopened = { pageLines: core.buf.pageLines, accEndRow: view._accEndRow, lastSig: view._lastAccumulatedSig };
    const tail = reopenedTail(content.pageLines, reopened.pageLines);
    if (!tail && !content.whole) {
      this.content = null;
      this.edited = true;
      return false;
    }
    const appends = !!tail?.rows.length;
    const kept = appends ? { ...reopened, pageLines: content.pageLines.slice(0, tail.keep).concat(tail.rows) } : content;
    core.buf.pageLines = kept.pageLines;
    view._accEndRow = tail ? kept.accEndRow : reopened.accEndRow;
    view._lastAccumulatedSig = tail ? kept.lastSig : reopened.lastSig;
    view._showsOverCopy = tail ? null : { shown: content.pageLines, copy: reopened.pageLines };
    if (content.marks && core.newComments) {
      Object.assign(core.newComments, content.marks);
      if (!content.whole) core.newComments.readToEnd(kept.pageLines);
      else if (appends) core.newComments.appended(kept.pageLines, tail.keep);
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
  // reopened the article to its end, a partial read paged on from where it
  // stopped; otherwise once easy reading has paged as far as the reading
  // position.
  reaches(core) {
    if (this.content && !this.content.whole) this._resume(core);
    if (this.content) return readIdle(core);
    const anchor = topRow(this.el);
    return !anchor || !!core.view.mainDisplay.querySelector(`[type="bbsrow"][srow="${anchor.srow}"]`);
  }

  // An article layer remembers no tap: nothing on it opens a page.
  tapOf() {
    return null;
  }
}
