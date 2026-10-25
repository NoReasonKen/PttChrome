// Search return history kept on this device across reloads and app reopening
// (docs/article-search.md). Local device state, deliberately outside the
// preference document: it is never exported or synchronized to the cloud.
import { readRecoveryRecord } from './search_return_history';

export const SEARCH_RETURN_KEY = 'pttchrome.searchReturn.v1';

const storage = () => (typeof window !== 'undefined' && window.localStorage) || null;

// Read once at startup and delete, like the reconnect-resume snapshot. An
// expired or damaged record is discarded silently.
export function takeStoredRecovery() {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(SEARCH_RETURN_KEY);
    store.removeItem(SEARCH_RETURN_KEY);
    return raw ? readRecoveryRecord(JSON.parse(raw), Date.now()) : null;
  } catch (e) {
    return null;
  }
}

// Keep `record` (search_return_history.recoveryRecord), or remove the stored
// one when there is nothing worth keeping.
export function storeRecovery(record) {
  try {
    const store = storage();
    if (!store) return;
    if (record) store.setItem(SEARCH_RETURN_KEY, JSON.stringify(record));
    else store.removeItem(SEARCH_RETURN_KEY);
  } catch (e) {
    // Storage blocked or full: the route simply does not survive a reload.
  }
}
