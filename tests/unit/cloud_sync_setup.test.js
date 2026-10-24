// @unit-env browser
// Exercise the real store while UI suites mock its page-session entry points.
const {
  createCloudSyncSetupStore,
  CLOUD_SYNC_SETUP_HASH,
} = await vi.importActual("../../src/js/cloud_sync_setup");

let store;
let earlyConsumer;
const clearHash = () =>
  history.replaceState(null, "", location.pathname + location.search);

beforeEach(clearHash);
afterEach(() => {
  store?.dispose();
  store = null;
  if (earlyConsumer)
    window.removeEventListener("hashchange", earlyConsumer, true);
  earlyConsumer = null;
  clearHash();
});

test("captures a cold setup link before another consumer clears the URL", () => {
  history.replaceState(null, "", CLOUD_SYNC_SETUP_HASH);
  store = createCloudSyncSetupStore(window);
  clearHash();
  expect(store.getSnapshot()).toBe(true);
});

test("captures a real hashchange on an already running page", async () => {
  store = createCloudSyncSetupStore(window);
  const listener = vi.fn();
  store.subscribe(listener);
  expect(store.getSnapshot()).toBe(false);
  location.hash = CLOUD_SYNC_SETUP_HASH;
  await vi.waitFor(() => expect(store.getSnapshot()).toBe(true));
  expect(listener).toHaveBeenCalledTimes(1);
});

test("uses the native event URL when an earlier handler already replaced the address", async () => {
  earlyConsumer = clearHash;
  window.addEventListener("hashchange", earlyConsumer, true);
  store = createCloudSyncSetupStore(window);
  location.hash = CLOUD_SYNC_SETUP_HASH;
  await vi.waitFor(() => expect(store.getSnapshot()).toBe(true));
  expect(location.hash).toBe("");
});

test("ordinary article links and lookalike setup fragments do not reveal sign-in", async () => {
  store = createCloudSyncSetupStore(window);
  location.hash = "#cloud-sync-setup-extra";
  await new Promise((resolve) =>
    window.addEventListener("hashchange", resolve, { once: true }),
  );
  expect(store.getSnapshot()).toBe(false);
  location.hash = "#Gossiping/1gIeu-3A";
  await new Promise((resolve) =>
    window.addEventListener("hashchange", resolve, { once: true }),
  );
  expect(store.getSnapshot()).toBe(false);
});

test("setup state is local to a store and subscriptions can be removed", async () => {
  store = createCloudSyncSetupStore(window);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  unsubscribe();
  location.hash = CLOUD_SYNC_SETUP_HASH;
  await vi.waitFor(() => expect(store.getSnapshot()).toBe(true));
  expect(listener).not.toHaveBeenCalled();
  store.dispose();
  clearHash();
  store = createCloudSyncSetupStore(window);
  expect(store.getSnapshot()).toBe(false);
});

test("disposing the store removes its hash listener", async () => {
  store = createCloudSyncSetupStore(window);
  store.dispose();
  location.hash = CLOUD_SYNC_SETUP_HASH;
  await new Promise((resolve) =>
    window.addEventListener("hashchange", resolve, { once: true }),
  );
  expect(store.getSnapshot()).toBe(false);
});
