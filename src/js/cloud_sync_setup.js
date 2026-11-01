// The setup link reveals sign-in controls for this page session. It grants no
// authorization; the authenticated token and Firestore rules decide access.
export const CLOUD_SYNC_SETUP_HASH = "#cloud-sync-setup";
const HIDDEN_CLOUD_SYNC_SEARCH_KEYS = Object.freeze(["section:options_sync"]);

export function cloudSyncUiPolicy(allowed, setupRequested) {
  const visible = !!(allowed || setupRequested);
  return {
    visible,
    hiddenSearchKeys: visible ? undefined : HIDDEN_CLOUD_SYNC_SEARCH_KEYS,
  };
}

const isSetupUrl = (href) => {
  try {
    return new URL(href).hash === CLOUD_SYNC_SETUP_HASH;
  } catch {
    return false;
  }
};

export function createCloudSyncSetupStore(win) {
  let requested = isSetupUrl(win.location.href);
  const listeners = new Set();
  const capture = (event) => {
    // newURL preserves the incoming link even if another URL consumer has
    // already replaced the address by the time this handler runs.
    if (requested || !isSetupUrl(event.newURL || win.location.href)) return;
    requested = true;
    listeners.forEach((listener) => listener());
  };
  win.addEventListener("hashchange", capture, true);
  return {
    getSnapshot: () => requested,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      win.removeEventListener("hashchange", capture, true);
      listeners.clear();
    },
  };
}

// Capture the cold-start URL before application startup consumes article links.
// Nothing is persisted or synchronized, and a new page starts with a new store.
const store =
  typeof window === "undefined" ? null : createCloudSyncSetupStore(window);

export const cloudSyncSetupRequested = () => store?.getSnapshot() || false;
export const subscribeCloudSyncSetup = (listener) =>
  store ? store.subscribe(listener) : () => {};

// CodeQL's JavaScript parser reads a statement that starts with `import.meta`
// as an import declaration and stops on the dot, so the hook goes through a
// local binding.
const hot = import.meta.hot;
if (hot) hot.dispose(() => store?.dispose());
