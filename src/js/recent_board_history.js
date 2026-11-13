import { normalizeHistory } from './history_entries';

export const RECENT_BOARD_HISTORY_KEY = 'pttchrome.homeRecentBoards.v2';
export const LEGACY_RECENT_BOARD_HISTORY_KEY = 'pttchrome.homeRecentBoards.v1';

const BOARD_OPTIONS = { caseInsensitive: true };

export function writeRecentBoardHistory(history) {
  const next = normalizeHistory(history, BOARD_OPTIONS);
  try {
    window.localStorage.setItem(RECENT_BOARD_HISTORY_KEY, JSON.stringify(next));
  } catch (e) {}
  return next;
}

export function readRecentBoardHistory() {
  try {
    const current = window.localStorage.getItem(RECENT_BOARD_HISTORY_KEY);
    // An existing v2 value, even empty or damaged, owns this history. Looking
    // back at v1 could otherwise restore entries the reader already deleted.
    if (current !== null) {
      try {
        return normalizeHistory(JSON.parse(current), BOARD_OPTIONS);
      } catch (e) {
        return normalizeHistory(null, BOARD_OPTIONS);
      }
    }
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_RECENT_BOARD_HISTORY_KEY));
    if (!Array.isArray(legacy)) return normalizeHistory(null, BOARD_OPTIONS);
    const recent = legacy
      .filter(name => typeof name === 'string' && name.trim())
      .map(name => ({ text: name.trim(), uses: 0 }));
    // The old array knew only order, not visit counts or pinned entries.
    return writeRecentBoardHistory({ pinned: [], recent });
  } catch (e) {
    return normalizeHistory(null, BOARD_OPTIONS);
  }
}
