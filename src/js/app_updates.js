import { androidBridgeAvailable, requestAndroid } from "./android_bridge";

const initialState = {
  supported: false, phase: "idle", installedVersion: "", installedVersionCode: 0,
  systemLanguage: "", automaticChecks: true, lastSuccessfulCheck: 0,
  lastError: null, needsNativeUpdate: false, prompt: false, release: null,
  progress: { downloaded: 0, total: 0 },
};
// Document-start native configuration keeps a recreated WebView blocked while
// its first asynchronous request reconciles a system-owned download.
let state = Object.freeze({ ...initialState,
  ...(typeof window !== "undefined" && window.__PTT_ANDROID__?.updateBlocking
    ? { supported: true, phase: "verifying" } : {}),
});
const listeners = new Set();
let readingCore;
let mutationEpoch = 0;
let pendingMutations = 0;

export const getUpdateState = () => state;
export const updateBlocksInteraction = (value = state) =>
  ["downloading", "paused", "verifying"].includes(value.phase);
export function subscribeUpdates(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function updateAction(action, payload = {}) {
  if (!androidBridgeAvailable()) return state;
  const mutating = action !== "state";
  const epoch = mutating ? ++mutationEpoch : mutationEpoch;
  if (mutating) pendingMutations++;
  try {
    if (action === "install") readingCore?.reconnectResume?.saveSnapshot({ lifecycle: true });
    const reply = await requestAndroid("update", { ...payload, action });
    if (epoch === mutationEpoch && reply.state) publish(reply.state);
    if (!reply.ok) {
      if (action === "state" && reply.error === "unknown op") {
        if (epoch === mutationEpoch) publish({ ...initialState,
          installedVersion: window.__PTT_ANDROID__?.version || "",
          systemLanguage: window.__PTT_ANDROID__?.systemLanguage || "",
        });
        return state;
      }
      throw new Error(reply.error || "Update operation failed");
    }
    return state;
  } catch (error) {
    if (epoch === mutationEpoch) publish({
      phase: updateBlocksInteraction() ? state.phase : "error",
      lastError: error.message,
    });
    throw error;
  } finally {
    if (mutating) pendingMutations--;
  }
}

function publish(change) {
  state = Object.freeze({ ...state, ...change });
  for (const listener of listeners) listener();
}

export function openUpdateAbout() {
  window.dispatchEvent(new Event("pttchrome:open-updates"));
}

export function startUpdateRuntime(core) {
  if (!androidBridgeAvailable()) return () => {};
  readingCore = core;
  let stopped = false;
  let running = false;
  let awaitingInstallation = updateBlocksInteraction() && !window.__PTT_ANDROID__?.openUpdate;
  const installReady = async () => {
    if (document.hidden || state.phase !== "ready" || !state.release) return;
    try { await updateAction("install", { releaseId: state.release.id }); }
    catch { openUpdateAbout(); }
  };
  const unsubscribe = subscribeUpdates(() => {
    if (["downloading", "paused"].includes(state.phase)) awaitingInstallation = !document.hidden;
    if (state.phase === "ready" && awaitingInstallation) {
      awaitingInstallation = false;
      // Defer until the native state reply and its mutation bookkeeping settle.
      queueMicrotask(() => { if (!stopped) void installReady(); });
    }
    if (["idle", "error", "available"].includes(state.phase)) awaitingInstallation = false;
  });
  const refresh = async (check = false) => {
    if (stopped || running || pendingMutations || document.hidden || !androidBridgeAvailable()) return;
    running = true;
    try {
      await updateAction("state");
      if (check && state.supported && !pendingMutations) await updateAction("check", { manual: false });
    } catch { /* About retains the error; discovery must not interrupt reading. */ }
    finally { running = false; }
  };
  const foreground = () => {
    if (document.hidden) awaitingInstallation = false;
    else void refresh(true);
  };
  const open = async () => {
    awaitingInstallation = false;
    try { await updateAction("state"); await installReady(); }
    catch { openUpdateAbout(); }
  };
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("pttandroid:update-open", open);
  const timer = setInterval(() => {
    if (state.supported && (state.phase === "checking" || updateBlocksInteraction())) void refresh();
  }, 1000);
  void refresh(true);
  if (window.__PTT_ANDROID__?.openUpdate) setTimeout(open, 0);
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("pttandroid:update-open", open);
    if (readingCore === core) readingCore = undefined;
  };
}
