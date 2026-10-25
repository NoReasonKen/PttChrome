import { isSubListTitle } from './aid_navigation';
import { isArticleListFooter, footerCaption } from './screen_captions';
import { parseBoardName, sameBoard } from './screen_titles';

export const SEARCH_RESULT_NOTICE = /找不到符合條件的文章|搜尋服務異常|已達搜尋條件上限/;

export function isBoardArticleList(facts, board) {
  const rows = facts?.rowTexts || [];
  return !facts?.inputField && sameBoard(parseBoardName(rows[0]), board) &&
    isArticleListFooter(rows[(facts?.rows || rows.length) - 1] || '');
}

// Legacy captions prove results only after a verified search transaction.
// Digests have a separate numbering space but are not search results.
export function isSearchResultsFrame(facts, board, allowLegacy = true) {
  if (!isBoardArticleList(facts, board)) return false;
  const rows = facts.rowTexts;
  const caption = footerCaption(rows[facts.rows - 1]);
  if (caption === '文摘列表') return false;
  return caption === '系列文章' || isSubListTitle(rows[0]) ||
    (allowLegacy && caption === '文章選讀');
}

// Completion is stricter than list identity. Background fill may temporarily
// move the cursor while the existing search results remain the visible list.
export function searchResultsLanded(facts, board) {
  return isSearchResultsFrame(facts, board) && facts.curY >= 3 &&
    facts.curY < facts.rows - 1 && facts.curX <= 1;
}
