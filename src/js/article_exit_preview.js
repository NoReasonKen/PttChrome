import { sameBoard } from './screen_titles';

const MAX_ROWS = 64;
const MAX_NODES = 1200;
const MAX_TEXT = 24000;
const TEXT_TAGS = new Set(['SPAN', 'DIV', 'A', 'B', 'STRONG', 'I', 'EM', 'SMALL', 'CODE', 'BR']);
const PRESENTATION = [
  'display', 'box-sizing', 'width', 'height', 'min-width', 'max-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'color', 'background-color', 'opacity', 'white-space', 'text-align',
  'text-overflow', 'overflow', 'overflow-wrap', 'word-break',
  'flex', 'flex-direction', 'align-items', 'justify-content', 'gap'
];

function copyTextPresentation(source, budget) {
  if (--budget.nodes < 0) return null;
  if (source.nodeType === Node.TEXT_NODE) {
    const text = source.textContent.slice(0, Math.max(0, budget.text));
    budget.text -= text.length;
    return document.createTextNode(text);
  }
  if (source.nodeType !== Node.ELEMENT_NODE || !TEXT_TAGS.has(source.tagName)) return null;
  const copy = document.createElement(source.tagName === 'BR' ? 'br' : 'span');
  const style = getComputedStyle(source);
  for (const property of PRESENTATION) copy.style.setProperty(property, style.getPropertyValue(property));
  for (const child of source.childNodes) {
    if (budget.nodes <= 0 || budget.text <= 0) break;
    const part = copyTextPresentation(child, budget);
    if (part) copy.appendChild(part);
  }
  return copy;
}

function articleIdentity(core) {
  const key = core.easyReading?._articleKey;
  const board = core.view._articleBoard;
  return key && board ? board + '\n' + key : null;
}

// A single entry's visible list presentation, never a second live list renderer.
export class ArticleExitPreview {
  constructor(core) {
    this.core = core;
    this.pending = null;
    this.current = null;
  }

  capture() {
    this.clear();
    const core = this.core;
    const main = core.view.mainDisplay;
    const board = core.listSession?._boardName;
    if (!core.mobile || !board || !core.view.componentScreen?.hasListViewport()) return;
    const viewport = main.getBoundingClientRect();
    if (!viewport.width || !viewport.height) return;
    const root = document.createElement('div');
    root.className = 'articleExitListPreview';
    root.style.cssText = `left:${viewport.left}px;top:${viewport.top}px;width:${viewport.width}px;height:${viewport.height}px`;
    const budget = { nodes: MAX_NODES, text: MAX_TEXT };
    let count = 0;
    for (const row of main.querySelectorAll('span[type="bbsrow"]')) {
      const rect = row.getBoundingClientRect();
      if (!rect.height || rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
      if (count++ >= MAX_ROWS || budget.nodes <= 0 || budget.text <= 0) break;
      const copy = copyTextPresentation(row, budget);
      if (!copy) continue;
      copy.style.position = 'absolute';
      copy.style.left = rect.left - viewport.left + 'px';
      copy.style.top = rect.top - viewport.top + 'px';
      copy.style.width = rect.width + 'px';
      copy.style.height = rect.height + 'px';
      root.appendChild(copy);
    }
    if (!root.childNodes.length) return;
    const title = document.getElementById('mobileAppBar');
    const heading = document.createElement('div');
    heading.className = 'articleExitListTitle';
    heading.textContent = title?.querySelector('.mobileAppBarTitle')?.textContent || board;
    heading.style.height = (title?.getBoundingClientRect().height || viewport.top) + 'px';
    const fragment = document.createDocumentFragment();
    fragment.append(heading, root);
    this.pending = { board, fragment, width: window.innerWidth };
  }

  enterArticle() {
    const pending = this.pending;
    this.pending = null;
    const identity = articleIdentity(this.core);
    this.current = pending && identity && sameBoard(pending.board, this.core.view._articleBoard)
      ? { ...pending, identity } : null;
  }

  update() {
    if (this.current && (!this.core.conn?.isConnected || articleIdentity(this.core) !== this.current.identity)) this.current = null;
  }

  appendTo(underlay) {
    this.update();
    const preview = this.current;
    // Rows wrap and scale with the width, so a width change (rotation) leaves
    // no matching list. Height alone changes as mobile browsers show or hide
    // their address bar; the copy stays valid and is clipped to the current
    // list viewport.
    if (!preview || preview.width !== window.innerWidth) return false;
    const copy = preview.fragment.cloneNode(true);
    const viewport = this.core.view.mainDisplay.getBoundingClientRect();
    const list = copy.querySelector('.articleExitListPreview');
    if (list && viewport.height) list.style.height = viewport.height + 'px';
    underlay.appendChild(copy);
    return true;
  }

  clear() {
    this.pending = this.current = null;
  }
}
