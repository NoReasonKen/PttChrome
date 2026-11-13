// 搜尋紀錄（本機；規則見 docs/article-search.md「搜尋紀錄」）。取代 PTT 原生的輸入記憶
// —— 那份會被列表好讀的跳號污染（article_search.js 檔頭）。
//
// 刻意**不放進 pttchrome.pref.v1**（同 upload_history.js）：它是使用歷史不是偏好，
// 混進去會被雲端同步與設定匯出帶走；使用者也明確要求只存本機。
//
// 每個種類分兩段：
//   - pinned：釘選的搜尋紀錄，使用者排的順序，不會被擠掉；auto＝自動釘選的。
//   - recent：最近的，最新的在最前面，滿了最舊的掉出去；uses＝搜尋過幾次。
// 搜尋紀錄區與 ↑ 都是 pinned 在前、recent 在後（searchHistoryOrder）。
// v1（只有一串字）不搬過來：舊紀錄沒有次數也沒有釘選，搬了也只是重新累積。
// 守護 tests/unit/search_history.test.js。

import {
  HISTORY_RECENT_LIMIT,
  HISTORY_PINNED_LIMIT,
  HISTORY_AUTO_PIN_USES,
  normalizeHistory,
  historyOrder,
  pinRoom,
  rememberHistoryEntry,
  pinHistoryEntries,
  unpinHistoryEntries,
  moveHistoryEntries,
  removeHistoryEntries,
} from './history_entries';

const HISTORY_KEY = 'pttchrome.searchHistory.v2';
export const MAX_SEARCH_HISTORY = HISTORY_RECENT_LIMIT;
export const MAX_PINNED_SEARCH_HISTORY = HISTORY_PINNED_LIMIT;
export const AUTO_PIN_USES = HISTORY_AUTO_PIN_USES;
export const SEARCH_KINDS = ['title', 'author', 'push', 'board'];
// 種類的名稱（i18n key）：搜尋視窗與管理視窗共用。
export const SEARCH_KIND_LABEL_KEY = {
  title: 'searchModal_kindTitle',
  author: 'searchModal_kindAuthor',
  push: 'searchModal_kindPush',
  board: 'searchModal_kindBoard',
};

// 複製一份、補齊四類、丟掉形狀不對與重複的項目：讀進來的 JSON 與呼叫端傳的物件同一套。
function cloneHistory(history) {
  const base = history && typeof history === 'object' ? history : {};
  const next = {};
  SEARCH_KINDS.forEach((k) => {
    next[k] = normalizeHistory(base[k]);
  });
  return next;
}

// 複製一份再改其中一類；不認得的種類原樣回傳。
function changeKind(history, kind, change) {
  const next = cloneHistory(history);
  if (SEARCH_KINDS.includes(kind)) next[kind] = change(next[kind]);
  return next;
}

export function searchHistoryKind(history, kind) {
  return SEARCH_KINDS.includes(kind) ? cloneHistory(history)[kind] : normalizeHistory(null);
}

// 搜尋紀錄區顯示的順序，也是 ↑ 叫回的順序。
export function searchHistoryOrder(history, kind) {
  return historyOrder(searchHistoryKind(history, kind));
}

// 釘選還放得下幾筆。
export function searchPinRoom(history, kind) {
  return pinRoom(searchHistoryKind(history, kind));
}

// 送出一次搜尋：最新的往前提、次數 +1。已釘選的原地不動、不計數。
// 次數到 AUTO_PIN_USES 就自動釘選；釘選滿了就先不釘，下一次搜尋再判斷。
export function addSearchEntry(history, kind, text) {
  return changeKind(history, kind, current => rememberHistoryEntry(current, text));
}

export function pinSearchEntries(history, kind, texts) {
  return changeKind(history, kind, current => pinHistoryEntries(current, texts));
}

// 回到最近的最前面（照釘選的順序）、次數從 0 重算；最近滿了照常擠掉最舊的。
export function unpinSearchEntries(history, kind, texts) {
  return changeKind(history, kind, current => unpinHistoryEntries(current, texts));
}

// 勾到的釘選一起上移（delta -1）／下移（+1）一格，相對順序不變；最近的不受影響。
// 擋在最前（後）面的那幾筆不動：前面那格也被勾到又沒移動，就跟著不動。
export function moveSearchEntries(history, kind, texts, delta) {
  return changeKind(history, kind, current => moveHistoryEntries(current, texts, delta));
}

// 管理視窗的「刪除 N 筆」：釘選和最近一起刪。
export function removeSearchEntries(history, kind, texts) {
  return changeKind(history, kind, current => removeHistoryEntries(current, texts));
}

// 讀壞掉的 JSON／localStorage 被關掉都只回空紀錄：附屬功能不可以炸掉呼叫端。
export function readSearchHistory() {
  try {
    return cloneHistory(JSON.parse(window.localStorage.getItem(HISTORY_KEY)));
  } catch (e) {
    return cloneHistory(null);
  }
}

export function writeSearchHistory(history) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {}
  return history;
}

export function updateSearchHistory(change) {
  return writeSearchHistory(change(readSearchHistory()));
}

export function rememberSearch(kind, text) {
  return updateSearchHistory((h) => addSearchEntry(h, kind, text));
}

export const SEARCH_HISTORY_KEY = HISTORY_KEY;
