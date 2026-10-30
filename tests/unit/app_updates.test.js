import {
  getUpdateState,
  subscribeUpdates,
  updateAction,
} from "../../src/js/app_updates.js";

afterEach(() => vi.unstubAllGlobals());

test("a browser without native update capabilities remains usable", async () => {
  expect(getUpdateState().supported).toBe(false);
  await expect(updateAction("state")).resolves.toMatchObject({
    supported: false,
  });
});

test("a transport failure replaces a previously successful update result with an error", async () => {
  let receive;
  let fail = false;
  vi.stubGlobal("window", {
    __PTT_ANDROID__: { version: "0.2.0" },
    PttAndroid: {
      addEventListener: (_name, listener) => {
        receive = listener;
      },
      postMessage: (text) => {
        const request = JSON.parse(text);
        if (fail) throw new Error("Connection unavailable");
        receive({
          data: JSON.stringify({
            id: request.id,
            ok: true,
            state: {
              supported: true,
              phase: "idle",
              lastSuccessfulCheck: 1234,
            },
          }),
        });
      },
    },
  });
  await updateAction("state");
  const observed = [];
  const unsubscribe = subscribeUpdates(() =>
    observed.push(getUpdateState().phase),
  );
  fail = true;
  await expect(updateAction("check", { manual: true })).rejects.toThrow(
    "Connection unavailable",
  );
  expect(getUpdateState()).toMatchObject({
    phase: "error",
    lastSuccessfulCheck: 1234,
  });
  expect(observed).toContain("error");
  unsubscribe();
});

test("a legacy APK keeps its version visible without claiming updater support", async () => {
  let receive;
  vi.stubGlobal("window", {
    __PTT_ANDROID__: { version: "0.2.0" },
    PttAndroid: {
      addEventListener: (_event, listener) => {
        receive = listener;
      },
      postMessage: (text) =>
        receive({
          data: JSON.stringify({
            id: JSON.parse(text).id,
            ok: false,
            error: "unknown op",
          }),
        }),
    },
  });
  await expect(updateAction("state")).resolves.toMatchObject({
    supported: false,
    installedVersion: "0.2.0",
    phase: "idle",
    lastError: null,
  });
});

test("a late progress query cannot undo a newer download action", async () => {
  let receive;
  let stale;
  let queries = 0;
  const reply = (id, phase) =>
    receive({
      data: JSON.stringify({
        id,
        ok: true,
        state: { supported: true, phase, lastError: null },
      }),
    });
  vi.stubGlobal("window", {
    __PTT_ANDROID__: { version: "0.3.0" },
    PttAndroid: {
      addEventListener: (_event, listener) => {
        receive = listener;
      },
      postMessage: (text) => {
        const request = JSON.parse(text);
        if (request.action === "state" && ++queries === 2) stale = request.id;
        else
          reply(
            request.id,
            request.action === "download" ? "downloading" : "available",
          );
      },
    },
  });
  await updateAction("state");
  const progress = updateAction("state");
  await updateAction("download", { releaseId: "android-fork-v0.4.0" });
  reply(stale, "available");
  await progress;
  expect(getUpdateState().phase).toBe("downloading");
});
