// @unit-env browser
// real-input: tests/e2e/offline/mobile_app_updates.offline.spec.js
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { AppUpdates } from "../../src/components/AppUpdates.jsx";
import { setupI18n, i18n } from "../../src/js/i18n";
import { updateAction } from "../../src/js/app_updates.js";

beforeAll(() => setupI18n());
afterEach(() => vi.unstubAllGlobals());

test("a download blocks app interaction until explicit cancellation", async () => {
  let receive;
  let phase = "downloading";
  const actions = [];
  vi.stubGlobal("PttAndroid", undefined);
  window.__PTT_ANDROID__ = { version: "0.2.0" };
  window.PttAndroid = {
    addEventListener: (_event, listener) => {
      receive = listener;
    },
    postMessage: (text) => {
      const { id, action } = JSON.parse(text);
      actions.push(action);
      if (action === "cancel") phase = "available";
      receive({
        data: JSON.stringify({
          id,
          ok: true,
          state: {
            supported: true,
            phase,
            progress: { downloaded: 512, total: 1024 },
            prompt: false,
            release: null,
          },
        }),
      });
    },
  };
  await act(() => updateAction("state"));
  const core = {
    setModalOpen() {},
    registerSheetDismiss() {
      return () => {};
    },
  };
  render(
    <MantineProvider>
      <AppUpdates pttchrome={core} />
    </MantineProvider>,
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(actions).not.toContain("cancel");
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n("about_update_cancel_download"),
      }),
    ),
  );
  expect(actions).toContain("cancel");
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  delete window.PttAndroid;
  delete window.__PTT_ANDROID__;
});

test("skipping the offered version passes its identity to the native owner", async () => {
  let receive;
  const requests = [];
  window.__PTT_ANDROID__ = { version: "0.2.0" };
  window.PttAndroid = {
    addEventListener: (_event, listener) => {
      receive = listener;
    },
    postMessage: (text) => {
      const request = JSON.parse(text);
      requests.push(request);
      receive({
        data: JSON.stringify({
          id: request.id,
          ok: true,
          state: {
            supported: true,
            phase: "available",
            prompt: request.action !== "skip",
            release: { id: "android-fork-v0.4.0", version: "0.4.0" },
          },
        }),
      });
    },
  };
  await act(() => updateAction("state"));
  const core = {
    setModalOpen() {},
    registerSheetDismiss() {
      return () => {};
    },
  };
  render(
    <MantineProvider>
      <AppUpdates pttchrome={core} />
    </MantineProvider>,
  );
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: i18n("about_update_skip") }),
    ),
  );
  expect(requests.find((request) => request.action === "skip")).toMatchObject({
    releaseId: "android-fork-v0.4.0",
  });
  delete window.PttAndroid;
  delete window.__PTT_ANDROID__;
});
