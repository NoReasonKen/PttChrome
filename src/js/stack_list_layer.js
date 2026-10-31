// A live article list kept underneath an article (#25, #28): a second instance
// of the shared screen renderer re-renders the list's last presented frame in
// its own scroll viewport, so revealing it shows the real list, scrollable at
// once, instead of a static copy.
import { ScreenCopyLayer, setUsable, STACK_NOTICE_MS } from './stack_layer';
import { LIST_TITLE_COL_START, hasServerCursorMark, rowToText } from './comment_parse';
import { labelListCursor } from './list_window';
import { listEntryOf } from './split_reader';
import { subjectKey, subjectMatches } from './long_push_anchor';
import { i18n } from './i18n';
import { PAGE } from './page_stack';

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

// The row of an article list frame's `lines` that lists `article` ({ author,
// title }; the list may cut the title short), or -1. Several rows can list the
// same author and subject, as in that author's search results; PTT then moved
// its selection from the row `from` to the nearest of them above it (`up`) or
// below it, or to the topmost one above it for the first article of the
// thread (`first`). Without a direction, only a single row other than `from`
// names it. Entries run from `bodyStart` to the footer.
export function articleRow(lines, bodyStart, article, { from = -1, up = null, first = false } = {}) {
  const author = String(article.author || '').toLowerCase();
  const subject = subjectKey(article.title);
  if (!author || !subject) return -1;
  const hits = [];
  for (let row = bodyStart; row < lines.length - 1; row++) {
    const entry = listEntryOf(rowToText(lines[row]));
    if (entry && !entry.deleted && entry.subject && String(entry.author).toLowerCase() === author &&
        subjectMatches(entry.subject, subject)) hits.push(row);
  }
  if (up != null) {
    const side = hits.filter(row => (up ? row < from : row > from));
    return side.length ? side[up && !first ? side.length - 1 : 0] : -1;
  }
  const others = hits.filter(row => row !== from);
  if (others.length === 1) return others[0];
  return hits.length === 1 ? hits[0] : -1;
}

// The frame's lines with the selection mark on `row` alone. A changed row is a
// copy: the rows are shared with the list's own buffer.
function withSelection(lines, bodyStart, row) {
  return lines.map((line, r) => {
    if (r < bodyStart || r === lines.length - 1 || (r === row) === hasServerCursorMark(line, 0)) return line;
    const copy = line.map(ch => Object.assign(Object.create(Object.getPrototypeOf(ch)), ch));
    if (r === row) labelListCursor(copy);
    else Object.assign(copy[0], { ch: ' ', isLeadByte: false });
    return copy;
  });
}

export class StackListLayer extends ScreenCopyLayer {
  // Render `view`'s current list frame of `kind` ('article' or 'board') as a
  // live copy over the list's box. Returns null when the view is not showing
  // such an easy-reading list.
  static capture(view, kind = 'article') {
    const screen = view.componentScreen;
    const frame = screen && screen.props;
    const listScroll = frame && frame.enhance && frame.enhance.listScroll;
    if (!listScroll || listScroll.kind !== kind || !screen.hasListViewport()) return null;
    const main = view.mainDisplay;
    const rect = main.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return new StackListLayer(view, rect, screen, frame);
  }

  constructor(view, rect, screen, frame) {
    const kind = frame.enhance.listScroll.kind;
    super(view, frame, kind === 'board' ? PAGE.BOARD_LIST : PAGE.ARTICLE_LIST);
    this.kind = kind;
    this._render(rect, frame.forceWidth);
    this.scrollTop = screen.getListScrollTop();
    // The reading position by entry, for a render at another width.
    this.anchor = topCard(view.mainDisplay, rect.top);
  }

  _render(rect, forceWidth) {
    this.rect = rect;
    this.forceWidth = forceWidth;
    const enhance = Object.assign({}, this.frame.enhance, {
      listScroll: Object.assign({}, this.frame.enhance.listScroll, { scrollable: true })
    });
    this._renderOver(rect, forceWidth, false, enhance);
  }

  // The card of frame row `row`, or null when the list does not show it.
  _card(row) {
    return this.el.querySelector(`.listCardBody[data-row="${row}"]`)?.closest('.listCard') || null;
  }

  // Show `article` ({ author, title }) selected, as PTT's selection is once
  // another article replaced the selected one in place (#74). `up`: whether it
  // was posted before that one, null when unknown; `first`: it is the first
  // article of the thread. Returns whether the list shows it.
  select(article, up, first = false) {
    const lines = this.frame.lines;
    const bodyStart = this.frame.enhance.listScroll.bodyStart;
    const from = lines.findIndex((line, r) => r >= bodyStart && r < lines.length - 1 && hasServerCursorMark(line, 0));
    const row = articleRow(lines, bodyStart, article, { from, up, first });
    if (row < 0 || !this._card(row)) return false;
    this.frame = { ...this.frame, lines: withSelection(this.frame.lines, bodyStart, row) };
    this._render(this.rect, this.forceWidth);
    this.selection = row;
    if (this.el.isConnected) this._revealSelection();
    return true;
  }

  // Scroll the selection chosen by `select` into view, the least distance.
  _revealSelection() {
    const card = this.selection != null && this._card(this.selection);
    const view = card && this.el.querySelector('.listBodyView');
    if (!view) return;
    const box = card.getBoundingClientRect();
    const port = view.getBoundingClientRect();
    const shift = box.top < port.top ? box.top - port.top : box.bottom > port.bottom ? box.bottom - port.bottom : 0;
    if (!shift) return;
    this.screen.setListScrollTop(this.screen.getListScrollTop() + shift);
    this.scrollTop = this.screen.getListScrollTop();
  }

  // Ready to be revealed at the current width. A width change, such as a
  // rotation, re-lays out the list, so the stored frame is rendered again over
  // the list's box and the reading position is kept by entry (#35).
  fitViewport() {
    if (this.width === window.innerWidth) return true;
    const rect = this.view.mainDisplay.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    this._render(rect, this.view.chh);
    this.scrollTop = null;
    return true;
  }

  // Visible, and usable when `usable`: it scrolls, and its input stays local.
  show(usable) {
    if (!this.el.isConnected) {
      this.parent.appendChild(this.el);
      if (this.scrollTop != null) this.screen.setListScrollTop(this.scrollTop);
      else this._restoreAnchor();
      this._revealSelection();
    }
    setUsable(this.el, usable);
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
    const realScreen = core.view.componentScreen;
    const shift = anchorShift(core.view.mainDisplay, topCard(this.el, this.el.getBoundingClientRect().top));
    if (shift == null) return false;
    realScreen.setListScrollTop(realScreen.getListScrollTop() + shift);
    return true;
  }

  // The entry a tap on this layer chose, or null.
  tapOf(event) {
    const card = event.type === 'click' && event.target.closest?.('.listCardBody') && event.target.closest('.listCard');
    return card ? cardIdentity(card) : null;
  }

  // Open the remembered entry on the refreshed list, found by identity, through
  // its list session's own open path.
  openTapped(core, id) {
    const row = findCard(core.view.mainDisplay, id)?.querySelector('.listCardBody')?.closest('[data-row]')?.dataset.row;
    if (row == null) {
      core.view.flashListHint?.(i18n(this.kind === 'board' ? 'stack_boardGone' : 'stack_articleGone'), STACK_NOTICE_MS);
      return;
    }
    core.noteUserAction?.();
    const session = this.kind === 'board' ? core.boardListSession : core.listSession;
    session.onMouseClick(Number(row), LIST_TITLE_COL_START);
  }
}
