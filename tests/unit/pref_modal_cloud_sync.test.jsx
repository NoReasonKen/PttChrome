// @unit-env browser
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { page } from "vitest/browser";
import { PrefModal } from "../../src/components/ContextMenu/PrefModal";
import { setupI18n, i18n } from "../../src/js/i18n";
import * as prefSync from "../../src/js/pref_sync";
import {
  cloudSyncSetupRequested,
  subscribeCloudSyncSetup,
} from "../../src/js/cloud_sync_setup";

const auth = vi.hoisted(() => ({
  user: null,
  allowed: false,
  listeners: new Set(),
}));
const setup = vi.hoisted(() => ({ requested: false, listeners: new Set() }));

vi.mock("../../src/js/pref_sync", { spy: true });
vi.mock("../../src/js/cloud_sync_setup", { spy: true });


const openModal = () =>
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
const syncSection = () =>
  document.querySelector('[data-pref-anchor="section:options_sync"]');
const openBackup = () =>
  fireEvent.click(screen.getByRole("tab", { name: i18n("options_backup") }));
const searchForSync = () => {
  fireEvent.change(screen.getByLabelText(i18n("options_settingsSearchLabel")), {
    target: { value: i18n("options_sync") },
  });
  return document.querySelector(
    '.PrefModal__Search__Dropdown [role="option"][value="section:options_sync"]',
  );
};
const emitAuth = (user, allowed) =>
  act(() => {
    auth.user = user;
    auth.allowed = allowed;
    auth.listeners.forEach((listener) => listener(user));
  });

beforeAll(() => setupI18n());
beforeEach(() => {
  vi.mocked(prefSync.canSync).mockImplementation(() => auth.allowed);
  vi.mocked(prefSync.signIn).mockResolvedValue(undefined);
  vi.mocked(prefSync.signOut).mockResolvedValue(undefined);
  vi.mocked(prefSync.onAuthState).mockImplementation((listener) => {
    auth.listeners.add(listener);
    listener(auth.user);
    return () => auth.listeners.delete(listener);
  });
  vi.mocked(cloudSyncSetupRequested).mockImplementation(() => setup.requested);
  vi.mocked(subscribeCloudSyncSetup).mockImplementation((listener) => {
    setup.listeners.add(listener);
    return () => setup.listeners.delete(listener);
  });
  window.localStorage.clear();
  auth.user = null;
  auth.allowed = false;
  setup.requested = false;
  prefSync.signIn.mockClear();
});
afterEach(() => page.viewport(1024, 768));

test.each([
  [false, false, "optionsDesc_backupLocal"],
  [true, false, "optionsDesc_backup"],
  [false, true, "optionsDesc_backup"],
])(
  "mobile backup summary respects setup %s and authorization %s",
  async (requested, allowed, summaryKey) => {
    await page.viewport(390, 800);
    setup.requested = requested;
    auth.allowed = allowed;
    openModal();
    const category = document.querySelector('[data-pref-category="backup"]');
    expect(category.textContent).toContain(i18n(summaryKey));
    if (!requested && !allowed)
      expect(category.textContent).not.toContain(i18n("optionsDesc_backup"));
  },
);

test.each([false, true])(
  "auto-login explains cloud behavior only when setup is requested: %s",
  (requested) => {
    setup.requested = requested;
    openModal();
    fireEvent.click(
      screen.getByRole("tab", { name: i18n("options_autoLoginTab") }),
    );
    expect(!!screen.queryByText(i18n("tooltip_autoLoginSynced"))).toBe(
      requested,
    );
  },
);

test("ordinary signed-out readers see neither cloud controls nor a cloud search result", () => {
  openModal();
  openBackup();
  expect(syncSection()).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n("options_syncSignIn") }),
  ).toBeNull();
  expect(searchForSync()).toBeNull();
  expect(prefSync.signIn).not.toHaveBeenCalled();
});

test("a captured cold-start setup request reveals sign-in without authenticating anyone", () => {
  setup.requested = true;
  openModal();
  openBackup();
  expect(syncSection()).not.toBeNull();
  expect(
    screen.getByRole("button", { name: i18n("options_syncSignIn") }),
  ).toBeVisible();
  expect(prefSync.signIn).not.toHaveBeenCalled();
});

test("a setup request arriving while settings are mounted reveals the controls", () => {
  openModal();
  expect(syncSection()).toBeNull();
  act(() => {
    setup.requested = true;
    setup.listeners.forEach((listener) => listener());
  });
  openBackup();
  expect(
    screen.getByRole("button", { name: i18n("options_syncSignIn") }),
  ).toBeVisible();
});

test("an already authorized account sees cloud controls without a setup link", () => {
  auth.user = { email: "owner@example.test" };
  auth.allowed = true;
  openModal();
  openBackup();
  expect(syncSection()).not.toBeNull();
  expect(screen.getByText(/owner@example\.test/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: i18n("options_syncSignOut") }),
  ).toBeVisible();
  expect(searchForSync()).not.toBeNull();
});

test("a signed-in account without permission does not expose cloud controls", () => {
  auth.user = { email: "reader@example.test" };
  openModal();
  openBackup();
  expect(syncSection()).toBeNull();
  expect(searchForSync()).toBeNull();
});

test("permission changes update section visibility even when the user object stays the same", () => {
  auth.user = { email: "owner@example.test" };
  openModal();
  openBackup();
  expect(syncSection()).toBeNull();
  emitAuth(auth.user, true);
  expect(syncSection()).not.toBeNull();
  emitAuth(auth.user, false);
  expect(syncSection()).toBeNull();
});

test("signing out hides the section when this page was not opened for setup", () => {
  auth.user = { email: "owner@example.test" };
  auth.allowed = true;
  const mounted = openModal();
  expect(auth.listeners.size).toBe(1);
  emitAuth(null, false);
  expect(syncSection()).toBeNull();
  mounted.unmount();
  expect(auth.listeners.size).toBe(0);
  expect(setup.listeners.size).toBe(0);
});
