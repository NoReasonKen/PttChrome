// @unit-env browser
// real-input: tests/e2e/offline/mobile_recent_boards.offline.spec.js
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import RecentBoardsManager from "../../src/components/ContextMenu/RecentBoardsManager";
import { HomeDashboard as Dashboard } from "../../src/components/HomeDashboard";
import { HomeDashboard, HOME_RECENT_KEY } from "../../src/js/home_dashboard";
import { i18n, setupI18n } from "../../src/js/i18n";

beforeAll(() => setupI18n());
beforeEach(() => localStorage.clear());

function controller(names = ["Steam", "C_Chat", "Stock"]) {
  const history = Array.isArray(names)
    ? { pinned: [], recent: names.map((text) => ({ text, uses: 1 })) }
    : names;
  localStorage.setItem(HOME_RECENT_KEY, JSON.stringify(history));
  const core = { mobile: false };
  core.homeDashboard = new HomeDashboard(core);
  return core;
}

const mount = (home) => render(
  <MantineProvider><RecentBoardsManager homeDashboard={home} /></MantineProvider>,
);
const entry = (name) => document.querySelector(`[data-manager-entry="${name}"]`);
const row = (name) => entry(name)?.querySelector("input");
const all = (section = "recent") => document.querySelector(`[data-manager-select-all="${section}"]`);
const action = (name) => document.querySelector(`[data-manager-action="${name}"]`);
const remove = () => action("delete");
const entries = (section) => [...document.querySelectorAll(`[data-manager-section="${section}"] [data-manager-entry]`)]
  .map((element) => element.dataset.managerEntry);

test("shows visit order and partial selection; selecting all can be undone", () => {
  mount(controller().homeDashboard);
  expect(entries("recent")).toEqual(["Steam", "C_Chat", "Stock"]);
  for (const name of ["up", "down", "pin", "unpin", "delete"]) expect(action(name).disabled).toBe(true);
  fireEvent.click(entry("C_Chat").querySelector("[data-manager-text]"));
  expect(row("C_Chat").checked).toBe(true);
  expect(all().indeterminate).toBe(true);
  expect(action("pin").disabled).toBe(false);
  for (const name of ["up", "down", "unpin"]) expect(action(name).disabled).toBe(true);
  fireEvent.click(all());
  expect(["Steam", "C_Chat", "Stock"].every((name) => row(name).checked)).toBe(true);
  fireEvent.click(all());
  expect(["Steam", "C_Chat", "Stock"].some((name) => row(name).checked)).toBe(false);
  expect(remove().disabled).toBe(true);
});

test("deleting selected entries persists immediately and clears selection", () => {
  const { homeDashboard } = controller();
  mount(homeDashboard);
  fireEvent.click(row("Steam"));
  fireEvent.click(row("Stock"));
  expect(remove().textContent).toBe(i18n("searchHistoryManager_delete").replace("{0}", 2));
  fireEvent.click(remove());
  expect(homeDashboard.state.recents).toEqual(["C_Chat"]);
  expect(JSON.parse(localStorage.getItem(HOME_RECENT_KEY))).toEqual({
    pinned: [], recent: [{ text: "C_Chat", uses: 1 }],
  });
  expect(new HomeDashboard({}).state.recents).toEqual(["C_Chat"]);
  expect(row("C_Chat").checked).toBe(false);
  expect(remove().disabled).toBe(true);
});

test("selecting all and deleting shows the empty state with disabled actions", () => {
  mount(controller().homeDashboard);
  fireEvent.click(all());
  fireEvent.click(remove());
  expect(screen.getByText(i18n("recentBoardsManager_empty"))).toBeTruthy();
  expect(all().disabled).toBe(true);
  expect(all("pinned").disabled).toBe(true);
  for (const name of ["up", "down", "pin", "unpin", "delete"]) expect(action(name).disabled).toBe(true);
});

test("external visits appear without being selected; removed selection does not return", () => {
  const { homeDashboard } = controller();
  mount(homeDashboard);
  fireEvent.click(row("C_Chat"));
  act(() => homeDashboard._noteRecent("Test"));
  expect(row("Test").checked).toBe(false);
  expect(row("C_Chat").checked).toBe(true);
  act(() => homeDashboard.removeRecentBoards(["C_Chat"]));
  expect(remove().disabled).toBe(true);
  act(() => homeDashboard._noteRecent("C_Chat"));
  expect(row("C_Chat").checked).toBe(false);
});

test("deletion updates both home views immediately and preserves favorite boards", () => {
  const core = controller();
  core.homeDashboard._set({ visible: true, boards: [{ name: "C_Chat", desc: "", unread: false }] });
  render(
    <MantineProvider>
      <RecentBoardsManager homeDashboard={core.homeDashboard} />
      <Dashboard pttchrome={core} />
      <Dashboard pttchrome={core} layer />
    </MantineProvider>,
  );
  expect(document.querySelectorAll('[data-home-recent="C_Chat"]')).toHaveLength(2);
  fireEvent.click(row("C_Chat"));
  fireEvent.click(remove());
  expect(document.querySelectorAll('[data-home-recent="C_Chat"]')).toHaveLength(0);
  expect(document.querySelectorAll('[data-home-board="C_Chat"]')).toHaveLength(2);
});

test("can mount an empty manager without a connected dashboard", () => {
  mount(undefined);
  expect(screen.getByText(i18n("recentBoardsManager_empty"))).toBeTruthy();
  expect(remove().disabled).toBe(true);
});

test("pinning, moving and unpinning preserve the selected group and persist immediately", () => {
  const { homeDashboard } = controller({
    pinned: [{ text: "Stock", auto: false }],
    recent: [{ text: "C_Chat", uses: 3 }, { text: "Steam", uses: 2 }],
  });
  mount(homeDashboard);
  fireEvent.click(row("Steam"));
  fireEvent.click(row("C_Chat"));
  fireEvent.click(action("pin"));
  expect(entries("pinned")).toEqual(["Stock", "C_Chat", "Steam"]);
  expect(entries("recent")).toEqual([]);
  expect(row("C_Chat").checked && row("Steam").checked).toBe(true);
  fireEvent.click(action("up"));
  expect(entries("pinned")).toEqual(["C_Chat", "Steam", "Stock"]);
  expect(homeDashboard.state.recents).toEqual(["C_Chat", "Steam", "Stock"]);
  expect(action("up").disabled).toBe(true);
  fireEvent.click(action("down"));
  expect(entries("pinned")).toEqual(["Stock", "C_Chat", "Steam"]);
  expect(row("C_Chat").checked && row("Steam").checked).toBe(true);
  fireEvent.click(action("unpin"));
  expect(entries("pinned")).toEqual(["Stock"]);
  expect(entries("recent")).toEqual(["C_Chat", "Steam"]);
  expect(row("C_Chat").checked && row("Steam").checked).toBe(true);
  expect(entry("C_Chat").querySelector("[data-manager-uses]").textContent).toBe("0");
  expect(JSON.parse(localStorage.getItem(HOME_RECENT_KEY))).toEqual({
    pinned: [{ text: "Stock", auto: false }],
    recent: [{ text: "C_Chat", uses: 0 }, { text: "Steam", uses: 0 }],
  });
});

test("visit counts and automatic badges update live without losing case-insensitive selection", () => {
  const { homeDashboard } = controller({
    pinned: [{ text: "Stock", auto: false }],
    recent: [{ text: "C_Chat", uses: 9 }, { text: "Steam", uses: 2 }],
  });
  mount(homeDashboard);
  expect(entry("C_Chat").querySelector("[data-manager-uses]").textContent).toBe("9");
  expect(entry("Steam").querySelector("[data-manager-uses]").textContent).toBe("2");
  expect(entry("Stock").querySelector("[data-manager-auto]")).toBeNull();
  fireEvent.click(row("C_Chat"));
  act(() => homeDashboard._noteRecent("c_chat"));
  expect(entries("pinned")).toEqual(["Stock", "c_chat"]);
  expect(row("c_chat").checked).toBe(true);
  expect(entry("c_chat").querySelector("[data-manager-auto]").textContent)
    .toBe(i18n("searchHistoryManager_auto"));
  expect(entry("c_chat").querySelector("[data-manager-uses]")).toBeNull();
  fireEvent.click(action("unpin"));
  expect(entry("c_chat").querySelector("[data-manager-auto]")).toBeNull();
  expect(entry("c_chat").querySelector("[data-manager-uses]").textContent).toBe("0");
});

test("a pin batch that exceeds capacity is disabled without losing the selected entries", () => {
  const { homeDashboard } = controller({
    pinned: Array.from({ length: 9 }, (_, index) => ({ text: "Pin" + index, auto: false })),
    recent: [{ text: "BoardA", uses: 4 }, { text: "BoardB", uses: 2 }],
  });
  mount(homeDashboard);
  fireEvent.click(row("BoardA"));
  expect(action("pin").disabled).toBe(false);
  fireEvent.click(row("BoardB"));
  expect(action("pin").disabled).toBe(true);
  expect(document.querySelector("[data-manager-pin-full]").textContent).toContain("10");
  expect(entries("recent")).toEqual(["BoardA", "BoardB"]);
  fireEvent.click(row("BoardB"));
  fireEvent.click(action("pin"));
  expect(entries("pinned")).toHaveLength(10);
  expect(entries("pinned").at(-1)).toBe("BoardA");
  expect(row("BoardA").checked).toBe(true);
  expect(document.querySelector("[data-manager-pin-full]")).toBeNull();
});

test("each section selects independently and deletion only removes the selected section", () => {
  const { homeDashboard } = controller({
    pinned: [{ text: "Stock", auto: false }, { text: "C_Chat", auto: true }],
    recent: [{ text: "Steam", uses: 2 }, { text: "Test", uses: 1 }],
  });
  mount(homeDashboard);
  fireEvent.click(all("pinned"));
  expect(row("Stock").checked && row("C_Chat").checked).toBe(true);
  expect(row("Steam").checked || row("Test").checked).toBe(false);
  fireEvent.click(all("recent"));
  expect(["Stock", "C_Chat", "Steam", "Test"].every((name) => row(name).checked)).toBe(true);
  fireEvent.click(all("pinned"));
  expect(row("Stock").checked || row("C_Chat").checked).toBe(false);
  expect(row("Steam").checked && row("Test").checked).toBe(true);
  fireEvent.click(remove());
  expect(entries("pinned")).toEqual(["Stock", "C_Chat"]);
  expect(entries("recent")).toEqual([]);
  expect(homeDashboard.state.recents).toEqual(["Stock", "C_Chat"]);
  expect(remove().disabled).toBe(true);
});
