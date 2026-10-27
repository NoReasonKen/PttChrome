// A live article list kept underneath an article (#25, #28): a second instance
// of the shared screen renderer re-renders the list's last presented frame in
// its own scroll viewport, so revealing it shows the real list, scrollable at
// once, instead of a static copy.
import { renderScreen } from './term_ui';
import { LIST_TITLE_COL_START } from './comment_parse';
import { i18n } from './i18n';

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

export class StackListLayer {
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
    const main = view.mainDisplay;
    this.view = view;
    this.frame = frame;
    this.el = document.createElement('div');
    // Same classes and inline geometry as the list surface, so list CSS applies.
    this.el.className = main.className;
    this.el.style.cssText = main.style.cssText;
    this.kind = frame.enhance.listScroll.kind;
    this.el.setAttribute('data-stack-layer', this.kind === 'board' ? 'boardList' : 'articleList');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.inert = true;
    // Rendered now, so the reveal only attaches it. It stays out of the document
    // until then: while the article is read there is one screen surface.
    this.parent = main.parentNode;
    this._render(rect, frame.forceWidth);
    this.scrollTop = screen.getListScrollTop();
    // The reading position by entry, for a render at another width.
    this.anchor = topCard(main, rect.top);
  }

  _render(rect, forceWidth) {
    this.width = window.innerWidth;
    Object.assign(this.el.style, {
      position: 'absolute', left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', height: rect.height + 'px', margin: '0', translate: 'none', zIndex: '2'
    });
    const enhance = Object.assign({}, this.frame.enhance, {
      listScroll: Object.assign({}, this.frame.enhance.listScroll, { scrollable: true })
    });
    this.screen = renderScreen(this.frame.lines, forceWidth, false, false, this.el, enhance);
  }

  // Ready to be revealed at the current width. A width change, such as a
  // rotation, re-lays out the list, so the stored frame is rendered again over
  // the list's box and the reading position is kept by entry (#35).
  fit() {
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
    }
    this.el.inert = !usable;
    this.el.removeAttribute('aria-hidden');
    if (!usable) this.el.setAttribute('aria-hidden', 'true');
  }

  // Put the entry that was at the top back at its offset.
  _restoreAnchor() {
    const card = this.anchor && findCard(this.el, this.anchor.id);
    if (!card) return;
    const shift = card.getBoundingClientRect().top - this.el.getBoundingClientRect().top - this.anchor.offset;
    this.screen.setListScrollTop(this.screen.getListScrollTop() + shift);
    this.scrollTop = this.screen.getListScrollTop();
  }

  hide() {
    this.el.remove();
    this.el.inert = true;
    this.el.setAttribute('aria-hidden', 'true');
  }

  destroy() {
    this.hide();
  }

  // Put the real list at this layer's reading position: the same entry at
  // the same offset from the top of the view.
  alignReal(core) {
    const realScreen = core.view.componentScreen;
    const realRoot = core.view.mainDisplay;
    const top = this.el.getBoundingClientRect().top;
    const anchor = topCard(this.el, top);
    const card = anchor && findCard(realRoot, anchor.id);
    if (!card) return false;
    const shift = card.getBoundingClientRect().top - realRoot.getBoundingClientRect().top - anchor.offset;
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
      core.view.flashListHint?.(i18n(this.kind === 'board' ? 'stack_boardGone' : 'stack_articleGone'), 4000);
      return;
    }
    core.noteUserAction?.();
    const session = this.kind === 'board' ? core.boardListSession : core.listSession;
    session.onMouseClick(Number(row), LIST_TITLE_COL_START);
  }
}
