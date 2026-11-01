// @unit-env browser
// 搜尋紀錄的管理視窗（src/components/ContextMenu/SearchHistoryManager.jsx，#70）。
// 守的是使用者在這裡做的事：分種類看釘選／最近兩段、釘選與取消、排釘選的順序、
// 勾選後一次刪除；每個變更立刻寫回本機紀錄（視窗只有「完成」，沒有取消）。
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import SearchHistoryManager from "../../src/components/ContextMenu/SearchHistoryManager";
// 標籤一律經 i18n 取：CI 是英文語系，寫死中文字面在那裡找不到。
import { setupI18n, i18n } from "../../src/js/i18n";
import {
  rememberSearch,
  updateSearchHistory,
  pinSearchEntry,
  readSearchHistory,
  searchHistoryKind,
  searchHistoryOrder,
} from "../../src/js/search_history";

beforeAll(() => {
  setupI18n();
});
beforeEach(() => {
  localStorage.clear();
});

const renderManager = (props = {}) => {
  const onClose = props.onClose || vi.fn();
  render(
    <MantineProvider>
      <SearchHistoryManager
        opened
        onClose={onClose}
        mobile={props.mobile}
        registerBack={props.registerBack}
      />
    </MantineProvider>,
  );
  return { onClose };
};

function seed(kind, texts, pins = []) {
  texts.forEach((t) => rememberSearch(kind, t));
  updateSearchHistory((h) => pins.reduce((acc, t) => pinSearchEntry(acc, kind, t), h));
}

const section = (name) =>
  document.querySelector(`[data-manager-section="${name}"]`);
const entries = (name) =>
  [...section(name).querySelectorAll("[data-manager-entry]")].map(
    (e) => e.dataset.managerEntry,
  );
const entry = (text) => document.querySelector(`[data-manager-entry="${text}"]`);
const deleteButton = () => document.querySelector("[data-manager-delete]");

test("兩段：釘選在前、最近在後；未釘選的顯示次數，釘選的不顯示；自動釘選的標「自動」", () => {
  seed("title", ["a", "b", "b", "c"], ["a"]);
  for (let i = 0; i < 10; ++i) rememberSearch("title", "hot"); // 第 10 次自動釘選
  renderManager();
  expect(entries("pinned")).toEqual(["a", "hot"]);
  expect(entries("recent")).toEqual(["c", "b"]);
  expect(within(entry("b")).getByText("2")).toBeTruthy();
  expect(entry("c").querySelector("[data-manager-uses]").textContent).toBe("1");
  expect(entry("a").querySelector("[data-manager-uses]")).toBeNull();
  expect(entry("hot").querySelector("[data-manager-auto]").textContent).toBe(
    i18n("searchHistoryManager_auto"),
  );
  expect(entry("a").querySelector("[data-manager-auto]")).toBeNull();
  expect(screen.getByText(i18n("searchHistoryManager_help"))).toBeTruthy();
});

test("切換種類只顯示那一類", () => {
  seed("title", ["t1"]);
  seed("author", ["someone"]);
  renderManager();
  fireEvent.click(screen.getByText(i18n("searchModal_kindAuthor")));
  expect(entries("recent")).toEqual(["someone"]);
  expect(entry("t1")).toBeNull();
});

test("兩段各自全選；刪除鈕寫出筆數，刪了立刻寫回，其他種類不動", () => {
  seed("title", ["p1", "p2", "r1", "r2"], ["p1", "p2"]);
  seed("author", ["someone"]);
  renderManager();
  expect(deleteButton().disabled).toBe(true);
  fireEvent.click(within(section("recent")).getByLabelText(i18n("searchHistoryManager_selectAll")));
  expect(deleteButton().textContent).toBe(
    i18n("searchHistoryManager_delete").replace("{0}", "2"),
  );
  fireEvent.click(within(entry("p2")).getByRole("checkbox"));
  expect(deleteButton().textContent).toBe(
    i18n("searchHistoryManager_delete").replace("{0}", "3"),
  );
  fireEvent.click(deleteButton());
  expect(entries("pinned")).toEqual(["p1"]);
  expect(entries("recent")).toEqual([]);
  expect(searchHistoryOrder(readSearchHistory(), "title")).toEqual(["p1"]);
  expect(searchHistoryOrder(readSearchHistory(), "author")).toEqual(["someone"]);
  expect(deleteButton().disabled).toBe(true);
});

test("全選再按一次＝全部取消", () => {
  seed("title", ["p1", "r1"], ["p1"]);
  renderManager();
  const all = within(section("pinned")).getByLabelText(i18n("searchHistoryManager_selectAll"));
  fireEvent.click(all);
  fireEvent.click(all);
  expect(deleteButton().disabled).toBe(true);
});

test("釘選切換：最近的釘到釘選最後面，取消釘選回到最近的最前面", () => {
  seed("title", ["a", "b", "c"], ["a"]);
  renderManager();
  fireEvent.click(within(entry("b")).getByLabelText(i18n("searchHistoryManager_pin")));
  expect(entries("pinned")).toEqual(["a", "b"]);
  expect(searchHistoryKind(readSearchHistory(), "title").pinned).toEqual([
    { text: "a", auto: false },
    { text: "b", auto: false },
  ]);
  fireEvent.click(within(entry("a")).getByLabelText(i18n("searchHistoryManager_unpin")));
  expect(entries("pinned")).toEqual(["b"]);
  expect(entries("recent")).toEqual(["a", "c"]);
});

test("釘選滿 20 筆：最近的釘選鈕停用", () => {
  const pins = Array.from({ length: 20 }, (_, i) => "p" + i);
  seed("title", pins, pins);
  seed("title", ["extra"]);
  renderManager();
  expect(entries("pinned")).toHaveLength(20);
  expect(within(entry("extra")).getByLabelText(i18n("searchHistoryManager_pin")).disabled).toBe(
    true,
  );
});

test("釘選的上移／下移；第一筆不能上移、最後一筆不能下移", () => {
  seed("title", ["a", "b", "c"], ["a", "b", "c"]);
  renderManager();
  const up = (t) => within(entry(t)).getByLabelText(i18n("searchHistoryManager_moveUp"));
  const down = (t) => within(entry(t)).getByLabelText(i18n("searchHistoryManager_moveDown"));
  expect(up("a").disabled).toBe(true);
  expect(down("c").disabled).toBe(true);
  fireEvent.click(up("c"));
  expect(entries("pinned")).toEqual(["a", "c", "b"]);
  fireEvent.click(down("a"));
  expect(entries("pinned")).toEqual(["c", "a", "b"]);
  expect(searchHistoryOrder(readSearchHistory(), "title")).toEqual(["c", "a", "b"]);
});

test("沒有紀錄的種類：顯示「沒有搜尋紀錄」，全選與刪除停用", () => {
  renderManager();
  expect(screen.getByText(i18n("searchHistoryManager_empty"))).toBeTruthy();
  document
    .querySelectorAll("[data-manager-select-all]")
    .forEach((el) => expect(el.disabled).toBe(true));
  expect(document.querySelectorAll("[data-manager-select-all]")).toHaveLength(2);
  expect(deleteButton().disabled).toBe(true);
});

test("「完成」關閉；開著時向系統返回登記同一個關閉", () => {
  const unregister = vi.fn();
  const registerBack = vi.fn(() => unregister);
  const { onClose } = renderManager({ registerBack });
  expect(registerBack).toHaveBeenCalledTimes(1);
  registerBack.mock.calls[0][0]();
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(document.querySelector("[data-manager-done]"));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("手機用 bottom sheet", () => {
  seed("title", ["a"]);
  renderManager({ mobile: true });
  expect(document.querySelector('[data-sheet="searchHistory"]')).not.toBeNull();
  expect(entries("recent")).toEqual(["a"]);
});
