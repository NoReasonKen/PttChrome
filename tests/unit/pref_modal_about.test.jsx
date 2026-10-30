// @unit-env browser
// real-input: tests/e2e/offline/pref_modal_layout.offline.spec.js
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { PrefModal } from "../../src/components/ContextMenu/PrefModal";
import { setupI18n, i18n } from "../../src/js/i18n";
import { AboutUpdate } from "../../src/components/ContextMenu/AboutPanels";
import { updateAction } from "../../src/js/app_updates";

beforeAll(() => setupI18n());

afterEach(() => {
  delete window.__PTT_ANDROID__;
  delete window.PttAndroid;
});

function installHost(initial, checkError = null) {
  const listeners = [];
  const requests = [];
  window.__PTT_ANDROID__ = { version: "0.3.0" };
  window.PttAndroid = {
    addEventListener(type, listener) {
      if (type === "message") listeners.push(listener);
    },
    postMessage(data) {
      const request = JSON.parse(data);
      requests.push(request);
      queueMicrotask(() => {
        if (request.action === "check" && checkError) {
          for (const listener of listeners)
            listener({
              data: JSON.stringify({
                id: request.id,
                ok: false,
                error: checkError,
              }),
            });
          return;
        }
        const state =
          request.action === "check"
            ? { ...initial, lastSuccessfulCheck: 1700000000000 }
            : initial;
        for (const listener of listeners)
          listener({
            data: JSON.stringify({ id: request.id, ok: true, state }),
          });
      });
    },
  };
  return requests;
}

test("About groups the current build under collapsed version sources and keeps debugging visible", () => {
  render(
    <MantineProvider>
      <PrefModal
        show
        onSave={() => {}}
        onReset={() => {}}
        debugMode={false}
        onDebugModeChange={() => {}}
      />
    </MantineProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: i18n("options_about") }));
  const sources = document.querySelector('[data-about-section="sources"]');
  expect(sources).not.toBeNull();
  expect(sources.open).toBe(false);
  fireEvent.click(sources.querySelector("summary"));
  const current = sources.querySelector('[data-about-source="current"]');
  expect(current.textContent).toContain("build:");
  expect(
    document.querySelector('[data-pref-anchor="ui:debugMode"]'),
  ).not.toBeNull();
});

test("a failed manual check does not report that the previously checked APK is up to date", async () => {
  installHost(
    {
      supported: true,
      phase: "idle",
      installedVersion: "0.3.0",
      automaticChecks: true,
      lastSuccessfulCheck: 1700000000000,
      lastError: null,
      release: null,
      systemLanguage: "en-US",
    },
    "Release information is unavailable",
  );
  await act(() => updateAction("state"));
  render(
    <MantineProvider>
      <AboutUpdate />
    </MantineProvider>,
  );
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: i18n("about_update_check") }),
    ),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Release information is unavailable",
    ),
  );
  expect(screen.getByRole("status").textContent).toBe(
    i18n("about_update_phase_error"),
  );
});

test("a successful manual check is distinct from an update that has not been checked", async () => {
  const requests = installHost({
    supported: true,
    phase: "idle",
    installedVersion: "0.3.0",
    automaticChecks: false,
    lastSuccessfulCheck: 0,
    lastError: null,
    release: null,
    systemLanguage: "en-US",
  });
  await act(() => updateAction("state"));
  render(
    <MantineProvider>
      <AboutUpdate />
    </MantineProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Updates have not been checked.",
  );
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: i18n("about_update_check") }),
    ),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "You are using the latest APK.",
    ),
  );
  expect(requests.at(-1)).toMatchObject({
    op: "update",
    action: "check",
    manual: true,
  });
});

test("Chinese system language selects the release summary without changing English update controls", async () => {
  installHost({
    supported: true,
    phase: "available",
    installedVersion: "0.3.0",
    automaticChecks: false,
    lastSuccessfulCheck: 1700000000000,
    lastError: null,
    needsNativeUpdate: false,
    systemLanguage: "zh-CN",
    release: {
      id: "android-fork-v0.4.0",
      version: "0.4.0",
      apk: { size: 1048576 },
      summary: {
        zhTW: ["修正文章閱讀位置。"],
        en: ["Preserve article reading position."],
      },
    },
  });
  await act(() => updateAction("state"));
  render(
    <MantineProvider>
      <AboutUpdate />
    </MantineProvider>,
  );
  expect(screen.getByText("修正文章閱讀位置。")).toBeInTheDocument();
  expect(screen.queryByText("Preserve article reading position.")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Check for updates" }),
  ).toBeEnabled();
  expect(screen.getByText(i18n("about_update_web_only"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download update" })).toBeEnabled();
});

test("a retained verified APK requires confirmation after the unsent-input warning before installation", async () => {
  const requests = installHost({
    supported: true,
    phase: "ready",
    installedVersion: "0.3.0",
    automaticChecks: true,
    lastSuccessfulCheck: 1700000000000,
    lastError: null,
    needsNativeUpdate: true,
    systemLanguage: "en-US",
    release: {
      id: "android-fork-v0.4.0",
      version: "0.4.0",
      apk: { size: 1048576 },
      summary: { zhTW: ["修正閱讀位置。"], en: ["Preserve reading position."] },
    },
  });
  await act(() => updateAction("state"));
  render(
    <MantineProvider>
      <AboutUpdate />
    </MantineProvider>,
  );
  expect(screen.queryByRole("button", { name: "Download update" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Install now" }));
  expect(
    screen.getByText(i18n("about_update_install_warning")),
  ).toBeInTheDocument();
  expect(requests.some((request) => request.action === "install")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Install later" }));
  expect(screen.queryByText(i18n("about_update_install_warning"))).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Install now" }));
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and open installer" }),
    ),
  );
  expect(requests.at(-1)).toMatchObject({ op: "update", action: "install" });
  expect(requests.some((request) => request.action === "download")).toBe(false);
});
