// Search trail kept on this device across reloads and app reopening
// (docs/article-swipe-drawer-spec.md). Local device state, deliberately outside the
// preference document: it is never exported or synchronized to the cloud.
import { readRecoveryRecord } from './search_trail';

export const SEARCH_TRAIL_KEY = 'pttchrome.searchTrail.v1';

const storage = () => (typeof window !== 'undefined' && window.localStorage) || null;

// Read once at startup and delete, like the reconnect-resume snapshot. An
// expired or damaged record is discarded silently.
export function takeStoredRecovery() {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(SEARCH_TRAIL_KEY);
    store.removeItem(SEARCH_TRAIL_KEY);
    return raw ? readRecoveryRecord(JSON.parse(raw), Date.now()) : null;
  } catch (e) {
    return null;
  }
}

// Keep `record` (search_trail.recoveryRecord), or remove the stored
// one when there is nothing worth keeping.
export function storeRecovery(record) {
  try {
    const store = storage();
    if (!store) return;
    if (record) store.setItem(SEARCH_TRAIL_KEY, JSON.stringify(record));
    else store.removeItem(SEARCH_TRAIL_KEY);
  } catch (e) {
    // Storage blocked or full: the trail simply does not survive a reload.
  }
}
