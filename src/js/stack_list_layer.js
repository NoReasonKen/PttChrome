// A live article list kept underneath an article (#25, #28): a second instance
// of the shared screen renderer re-renders the list's last presented frame in
// its own scroll viewport, so revealing it shows the real list, scrollable at
// once, instead of a static copy.
import { ScreenCopyLayer, setUsable, STACK_NOTICE_MS, releaseScreenLater } from './stack_layer';
import { LIST_TITLE_COL_START, rowToText } from './comment_parse';
import { listEntryOf } from './split_reader';
import { KeptListPage } from './stack_list_page';
import { i18n } from './i18n';
import { PAGE } from './page_stack';
import { mobileFillLayout, listRowSpan } from './mobile_layout';
import { boardMarkReadTargetOfText } from './board_list_parse';

// Layout sizes that differ by less than a pixel are the same size: the
// layout reports sub-pixel drift (411.99997 / 412.00003) between frames.
const sameSize = (a, b) => Math.abs(a - b) < 1;

// Only one hidden list per terminal stays connected and laid out. Deeper
// history keeps its detached renderer and the existing live-layer bound.
const readyLists = new WeakMap();

// Identity of a list card. An article is its author and title: its number can
// move when earlier articles are deleted. A board is its name.
export function cardIdentity(card) {
  if (card.dataset.listBoard != null) return { board: card.dataset.listBoard };
  return { author: card.dataset.listAuthor || '', title: card.dataset.listTitle || '' };
}

function sameIdentity(a, b) {
  return a.board != null || b.board != null ? a.board === b.board : a.author === b.author && a.title === b.title;
}

export function findCard(root, id) {
  for (const card of root.querySelectorAll('.listCard')) {
    if (sameIdentity(cardIdentity(card), id)) return card;
  }
  return null;
}

// The first card at the top of the viewport and its offset from that top.
function topCard(root, viewportTop) {
  for (const card of root.querySelectorAll('.listCard')) {
    const r = card.getBoundingClientRect();
    if (r.height && r.bottom > viewportTop + 1) return { id: cardIdentity(card), offset: r.top - viewportTop };
  }
  return null;
}

// How far `root`'s list scrolls to put `anchor`'s card back at its offset, or
// null when the card is not there.
function anchorShift(root, anchor) {
  const card = anchor && findCard(root, anchor.id);
  return card ? card.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset : null;
}

export class StackListLayer extends ScreenCopyLayer {
  // Render `view`'s current list frame of `kind` ('article' or 'board') as a
  // live copy over the list's box, keeping the list session's own page
  // `session` with it (KeptListPage). Returns null when the view is not
  // showing such an easy-reading list.
  static capture(view, kind = 'article', session = null) {
    const screen = view.componentScreen;
    const frame = screen && screen.props;
    const listScroll = frame && frame.enhance && frame.enhance.listScroll;
    if (!listScroll || listScroll.kind !== kind || !screen.hasListViewport()) return null;
    const main = view.mainDisplay;
    const rect = main.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return new StackListLayer(view, rect, screen, new KeptListPage(frame, session));
  }

  constructor(view, rect, screen, listPage) {
    const frame = listPage.frame;
    const kind = frame.enhance.listScroll.kind;
    super(view, kind === 'board' ? PAGE.BOARD_LIST : PAGE.ARTICLE_LIST);
    // The page this layer shows, the one copy the real list takes over again.
    this.listPage = listPage;
    // Keep this unchanged between parking and an inert drag reveal: changing
    // an inherited property on reveal invalidates every descendant's style.
    this.el.style.pointerEvents = 'none';
    this.kind = kind;
    this._render(rect, frame.forceWidth);
    this.scrollTop = screen.getListScrollTop();
    // The reading position by entry, for a render at another width.
    this.anchor = topCard(view.mainDisplay, rect.top);
  }

  get frame() {
    return this.listPage.frame;
  }

  _render(rect, forceWidth) {
    this.rect = rect;
    this.forceWidth = forceWidth;
    // The live screen's text size, undoing the page's text scaling (TermView.syncTextScale).
    this.el.style.fontSize = this.el.style.lineHeight = this.view.textFontPx(forceWidth) + 'px';
    const enhance = Object.assign({}, this.frame.enhance, {
      listScroll: Object.assign({}, this.frame.enhance.listScroll, { scrollable: true })
    });
    if (enhance.listCards) {
      enhance.listScroll.viewportPx = this.view.listCardViewportPx();
      const count = Math.max(0, this.frame.lines.length - enhance.listScroll.bodyStart - 1);
      enhance.listScroll.tailPx = Math.max(0, enhance.listScroll.viewportPx - count * listRowSpan(true) * forceWidth);
    }
    this._renderOver(rect, forceWidth, false, enhance);
    this._clipToAppBar(rect);
  }

  // The real App Bar covers a list shifted upward by the keyboard. Its lower
  // copy lives behind this layer, so keep those same covered rows clipped.
  _clipToAppBar(rect) {
    const bottom = document.getElementById('mobileAppBar')?.getBoundingClientRect().bottom ?? rect.top;
    const top = this.frame.enhance.listCards ? Math.max(0, bottom - rect.top) : 0;
    this.el.style.clipPath = top ? `inset(${top}px 0 0)` : '';
  }

  // The list keeps its content height above a keyboard, unlike an article.
  // Share the real list's layout rule without changing the foreground surface.
  _viewportRect() {
    const main = this.view.mainDisplay;
    const box = main.getBoundingClientRect();
    // A handoff can refit while the foreground is still sliding. The lower
    // page follows its layout box, not the stack's horizontal animation.
    const translateX = parseFloat(getComputedStyle(main).translate) || 0;
    const rect = { left: box.left - translateX, top: box.top, width: box.width, height: box.height };
    if (!this.frame.enhance.listCards) return rect;
    const fill = mobileFillLayout({
      innerHeight: this.view.innerBounds.height,
      topInset: this.view.topInset,
      bottomInset: this.view.keyboardInset,
      contentPx: this.view.listCardViewportPx()
    });
    return {
      left: rect.left, width: rect.width, height: fill.height,
      top: rect.top - (parseFloat(main.style.marginTop) || 0) + fill.marginTop
    };
  }

  // Follow PTT's selection to `article` ({ author, title }), which replaced
  // the open article in place (#74). The list keeps showing the article the
  // reader opened from it selected (#123); PTT's selection is only tracked,
  // to know which rows were read and to move PTT back on Back. `up`: whether
  // it was posted before the previous one, null when unknown; `first`: it is
  // the first article of the thread. Returns whether the list holds it.
  follow(article, up, first = false) {
    if (!this.screen) return false;
    const row = this.listPage.follow(article, up, first);
    if (row < 0) return false;
    this._showPage();
    return true;
  }

  // `article` was read with PTT's selection no longer followed: it shows read
  // when the list names it by its own identity (stack_list_page.js
  // #identityRows). Rows it cannot be told from stay as they are, and the
  // real list takes them from PTT rather than guess (#128).
  noteRead(article) {
    if (this.screen && this.listPage.noteRead(article)) this._showPage();
  }

  // The article opened from this list was entered: it reads as read.
  opened() {
    const row = this.screen ? this.listPage.selectedRow() : -1;
    if (row >= 0 && this.listPage.markRead(row, null)) this._showPage();
  }

  _showPage() {
    this.screen.update({ ...this.screen.props, lines: this.frame.lines });
  }

  // Ready to be revealed at the current width. A width change, such as a
  // rotation, re-lays out the list, so the stored frame is rendered again over
  // the list's box and the reading position is kept by entry (#35).
  fitViewport(force = false) {
    if (!this.screen) return false;
    const rect = this._viewportRect();
    if (!rect.width || !rect.height) return false;
    const viewportChanged = this.frame.enhance.listCards &&
      !sameSize(this.screen.props.enhance.listScroll.viewportPx, this.view.listCardViewportPx());
    if (!force && sameSize(this.width, window.innerWidth) && sameSize(rect.width, this.rect.width) &&
        this.forceWidth === this.view.chh && !viewportChanged) {
      // Keyboard-only changes move the box, preserving the prepared rows.
      if (rect.top !== this.rect.top || rect.height !== this.rect.height) {
        Object.assign(this.el.style, { top: rect.top + 'px', height: rect.height + 'px' });
        // The foreground can still be translated while canceling an exit.
        // Cache only the geometry applied to this stationary lower page.
        this.rect = { left: this.rect.left, width: this.rect.width, top: rect.top, height: rect.height };
        this._clipToAppBar(rect);
      }
      return true;
    }
    // A parked layer still shows the reading position it was captured with.
    // Measuring it again would carry over wherever a render at another width
    // had to clamp it, as while PTT's own list is mirrored (#127).
    if (this.el.isConnected && !this.el.hasAttribute('data-stack-parked'))
      this.anchor = topCard(this.el, this.el.getBoundingClientRect().top);
    this._render(rect, this.view.chh);
    this.scrollTop = null;
    if (this.el.isConnected) this._restoreAnchor();
    return true;
  }

  // Visible, and usable when `usable`: it scrolls, and its input stays local.
  show(usable) {
    if (!this.screen) return;
    if (readyLists.get(this.view) === this) readyLists.delete(this.view);
    this.viewportObserver?.disconnect();
    this.el.removeAttribute('data-stack-parked');
    this.el.style.opacity = '';
    if (!this.el.isConnected) {
      this.parent.appendChild(this.el);
      if (this.scrollTop != null) this.screen.setListScrollTop(this.scrollTop);
      else this._restoreAnchor();
    }
    this.el.style.pointerEvents = usable ? '' : 'none';
    setUsable(this.el, usable);
  }

  // Preserve the layout already paid for during entry instead of reattaching
  // and forcing a full list layout on the first pointer move. Opacity is not
  // inherited, so revealing the root does not restyle every list descendant.
  park() {
    if (!this.screen) return;
    const previous = readyLists.get(this.view);
    if (previous && previous !== this) previous._detach();
    readyLists.set(this.view, this);
    this.el.setAttribute('data-stack-parked', '');
    this.el.classList.remove('blink--active');
    this.el.style.opacity = '0';
    this.el.style.pointerEvents = 'none';
    setUsable(this.el, false);
    if (!this.el.isConnected) {
      this.parent.appendChild(this.el);
      if (this.scrollTop != null) this.screen.setListScrollTop(this.scrollTop);
      else this._restoreAnchor();
    }
    this.viewportObserver ||= new ResizeObserver(() => {
      if (readyLists.get(this.view) !== this) return;
      const rect = this.view.mainDisplay.getBoundingClientRect();
      // An article shrinks for the keyboard; a list keeps its content height.
      // Only width and font changes require preparing the list's layout again.
      if (!sameSize(rect.width, this.rect.width) || this.view.chh !== this.forceWidth)
        this.fitViewport(true);
    });
    this.viewportObserver.observe(this.view.mainDisplay);
  }

  // A deeper list becomes the next reveal after a nested Back completes.
  prepare() {
    if (readyLists.get(this.view) !== this) this.park();
  }

  // Taking a layer out of view does not make it the next prepared page.
  hide() {
    this._detach();
  }

  _detach() {
    if (readyLists.get(this.view) === this) readyLists.delete(this.view);
    this.viewportObserver?.disconnect();
    super.hide();
    this.el.removeAttribute('data-stack-parked');
    this.el.style.opacity = '';
  }

  destroy() {
    // Destruction must remove the prepared DOM, rather than park it again.
    this._detach();
    releaseScreenLater(this.screen);
    this.screen = null;
  }

  // Put the entry that was at the top back at its offset.
  _restoreAnchor() {
    const shift = anchorShift(this.el, this.anchor);
    if (shift == null) return;
    this.screen.setListScrollTop(this.screen.getListScrollTop() + shift);
    this.scrollTop = this.screen.getListScrollTop();
  }

  // Put the real list at this layer's reading position: the same entry at
  // the same offset from the top of the view.
  alignReal(core) {
    if (!this.screen) return false;
    const realScreen = core.view.componentScreen;
    const shift = anchorShift(core.view.mainDisplay, topCard(this.el, this.el.getBoundingClientRect().top));
    if (shift == null) return false;
    realScreen.setListScrollTop(realScreen.getListScrollTop() + shift);
    return true;
  }

  // The entry a tap on this layer chose, or null.
  tapOf(event) {
    if (!this.screen) return null;
    const card = event.type === 'click' && event.target.closest?.('.listCardBody') && event.target.closest('.listCard');
    return card ? cardIdentity(card) : null;
  }

  // Open the remembered entry on the real list PTT now shows. It runs after
  // the swap, when this layer may already be released.
  openTapped(core, id) {
    openListEntry(core, { kind: this.kind, id });
  }

  // The entry of this list under `target`, for the context menu, or null: its
  // kind and identity, and the number marking it read would use.
  entryAt(target) {
    if (!this.screen) return null;
    const card = target?.closest?.('.listCard');
    if (!card || !this.el.contains(card)) return null;
    const line = this.frame.lines[Number(card.querySelector('.listCardBody')?.dataset.row)];
    const text = line ? rowToText(line) : '';
    if (this.kind === 'board') return { kind: 'board', id: cardIdentity(card), boardMarkRead: boardMarkReadTargetOfText(text) };
    const entry = listEntryOf(text);
    return { kind: 'article', id: cardIdentity(card), markRead: entry ? { num: entry.num } : null };
  }
}

// The row of `entry` ({ kind, id }) on the real list PTT now shows, or null
// with a notice when that list no longer has it.
export function realEntryRow(core, entry) {
  const row = findCard(core.view.mainDisplay, entry.id)?.querySelector('.listCardBody')?.dataset.row;
  if (row != null) return Number(row);
  core.view.flashListHint?.(i18n(entry.kind === 'board' ? 'stack_boardGone' : 'stack_articleGone'), STACK_NOTICE_MS);
  return null;
}

// Open `entry` on the real list through its list session's own open path.
export function openListEntry(core, entry) {
  const row = realEntryRow(core, entry);
  if (row == null) return;
  core.noteUserAction?.();
  const session = entry.kind === 'board' ? core.boardListSession : core.listSession;
  session.onMouseClick(row, LIST_TITLE_COL_START);
}
