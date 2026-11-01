// @unit-env browser
// 搜尋紀錄的管理頁（src/components/ContextMenu/SearchHistoryManager.jsx，#70），設定裡
// 「本機」底下的一頁。守的是使用者在這裡做的事：分種類看釘選／最近兩段、勾選後用
// 下方那排按鈕一次上移／下移／釘選／取消釘選／刪除；每個變更立刻寫回本機紀錄。
// 進出這一頁（返回、系統返回）守在 pref_modal_local_tab.test.jsx。
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import SearchHistoryManager from "../../src/components/ContextMenu/SearchHistoryManager";
// 標籤一律經 i18n 取：CI 是英文語系，寫死中文字面在那裡找不到。
import { setupI18n, i18n } from "../../src/js/i18n";
import {
  rememberSearch,
  updateSearchHistory,
  pinSearchEntries,
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

const renderManager = () =>
  render(
    <MantineProvider>
      <SearchHistoryManager />
    </MantineProvider>,
  );

// 逐筆釘：釘選的順序就是 pins 的順序。
function seed(kind, texts, pins = []) {
  texts.forEach((t) => rememberSearch(kind, t));
  updateSearchHistory((h) => pins.reduce((acc, t) => pinSearchEntries(acc, kind, [t]), h));
}

const section = (name) =>
  document.querySelector(`[data-manager-section="${name}"]`);
const entries = (name) =>
  [...section(name).querySelectorAll("[data-manager-entry]")].map(
    (e) => e.dataset.managerEntry,
  );
const entry = (text) => document.querySelector(`[data-manager-entry="${text}"]`);
const check = (text) => fireEvent.click(within(entry(text)).getByRole("checkbox"));
const checked = (text) => within(entry(text)).getByRole("checkbox").checked;
const action = (name) => document.querySelector(`[data-manager-action="${name}"]`);

test("兩段：釘選在前、最近在後（最新的在前）；未釘選的顯示次數；自動釘選的標「自動」", () => {
  seed("title", ["a", "b", "b", "c"], ["a"]);
  for (let i = 0; i < 10; ++i) rememberSearch("title", "hot"); // 第 10 次自動釘選
  renderManager();
  expect(entries("pinned")).toEqual(["a", "hot"]);
  expect(entries("recent")).toEqual(["c", "b"]);
  expect(entry("b").querySelector("[data-manager-uses]").textContent).toBe("2");
  expect(entry("c").querySelector("[data-manager-uses]").textContent).toBe("1");
  expect(entry("a").querySelector("[data-manager-uses]")).toBeNull();
  expect(entry("hot").querySelector("[data-manager-auto]").textContent).toBe(
    i18n("searchHistoryManager_auto"),
  );
  expect(entry("a").querySelector("[data-manager-auto]")).toBeNull();
  expect(screen.getByText(i18n("searchHistoryManager_help"))).toBeTruthy();
});

test("每一列只有勾選框、文字與次數，沒有按鈕；點文字也能勾選", () => {
  seed("title", ["a", "b"], ["a"]);
  renderManager();
  ["a", "b"].forEach((t) => expect(entry(t).querySelectorAll("button")).toHaveLength(0));
  fireEvent.click(entry("b").querySelector("[data-manager-text]"));
  expect(checked("b")).toBe(true);
  fireEvent.click(entry("b").querySelector("[data-manager-text]"));
  expect(checked("b")).toBe(false);
});

test("切換種類只顯示那一類，勾選清掉", () => {
  seed("title", ["t1"]);
  seed("author", ["someone"]);
  renderManager();
  check("t1");
  fireEvent.click(screen.getByText(i18n("searchModal_kindAuthor")));
  expect(entries("recent")).toEqual(["someone"]);
  expect(entry("t1")).toBeNull();
  expect(action("delete").disabled).toBe(true);
});

test("兩段各自全選；刪除鈕寫出筆數，刪了立刻寫回、勾選清掉，其他種類不動", () => {
  seed("title", ["p1", "p2", "r1", "r2"], ["p1", "p2"]);
  seed("author", ["someone"]);
  renderManager();
  expect(action("delete").disabled).toBe(true);
  fireEvent.click(within(section("recent")).getByLabelText(i18n("searchHistoryManager_selectAll")));
  expect(action("delete").textContent).toBe(
    i18n("searchHistoryManager_delete").replace("{0}", "2"),
  );
  check("p2");
  expect(action("delete").textContent).toBe(
    i18n("searchHistoryManager_delete").replace("{0}", "3"),
  );
  fireEvent.click(action("delete"));
  expect(entries("pinned")).toEqual(["p1"]);
  expect(entries("recent")).toEqual([]);
  expect(searchHistoryOrder(readSearchHistory(), "title")).toEqual(["p1"]);
  expect(searchHistoryOrder(readSearchHistory(), "author")).toEqual(["someone"]);
  expect(action("delete").disabled).toBe(true);
});

test("全選再按一次＝全部取消", () => {
  seed("title", ["p1", "r1"], ["p1"]);
  renderManager();
  const all = within(section("pinned")).getByLabelText(i18n("searchHistoryManager_selectAll"));
  fireEvent.click(all);
  fireEvent.click(all);
  expect(action("delete").disabled).toBe(true);
});

test("一次釘選多筆（照最近的順序接到最後面），勾選保留；再一次取消釘選", () => {
  seed("title", ["a", "b", "c"], ["a"]); // 最近：c b
  renderManager();
  expect(action("pin").disabled).toBe(true);
  expect(action("unpin").disabled).toBe(true);
  check("b");
  check("c");
  expect(action("unpin").disabled).toBe(true);
  fireEvent.click(action("pin"));
  expect(entries("pinned")).toEqual(["a", "c", "b"]);
  expect(searchHistoryKind(readSearchHistory(), "title").pinned).toEqual([
    { text: "a", auto: false },
    { text: "c", auto: false },
    { text: "b", auto: false },
  ]);
  expect(checked("b") && checked("c")).toBe(true);
  expect(action("pin").disabled).toBe(true);
  fireEvent.click(action("unpin"));
  expect(entries("pinned")).toEqual(["a"]);
  expect(entries("recent")).toEqual(["c", "b"]);
});

test("一次上移／下移多筆；移不動就停用；只勾最近的也停用", () => {
  seed("title", ["a", "b", "c", "d", "r"], ["a", "b", "c", "d"]);
  renderManager();
  check("r");
  expect(action("up").disabled).toBe(true);
  expect(action("down").disabled).toBe(true);
  check("r");
  check("b");
  check("d");
  fireEvent.click(action("up"));
  expect(entries("pinned")).toEqual(["b", "a", "d", "c"]);
  fireEvent.click(action("up"));
  expect(entries("pinned")).toEqual(["b", "d", "a", "c"]);
  expect(action("up").disabled).toBe(true);
  fireEvent.click(action("down"));
  expect(entries("pinned")).toEqual(["a", "b", "d", "c"]);
  expect(searchHistoryOrder(readSearchHistory(), "title").slice(0, 4)).toEqual([
    "a",
    "b",
    "d",
    "c",
  ]);
});

test("釘選放不下勾的那幾筆：釘選鈕停用，提示上限", () => {
  const pins = Array.from({ length: 9 }, (_, i) => "p" + i);
  seed("title", pins, pins);
  seed("title", ["x", "y"]);
  renderManager();
  check("x");
  expect(action("pin").disabled).toBe(false);
  expect(document.querySelector("[data-manager-pin-full]")).toBeNull();
  check("y");
  expect(action("pin").disabled).toBe(true);
  expect(document.querySelector("[data-manager-pin-full]").textContent).toBe(
    i18n("searchHistoryManager_pinFull").replace("{0}", "10"),
  );
});

test("沒有紀錄的種類：顯示「沒有搜尋紀錄」，全選與所有操作停用", () => {
  renderManager();
  expect(screen.getByText(i18n("searchHistoryManager_empty"))).toBeTruthy();
  document
    .querySelectorAll("[data-manager-select-all]")
    .forEach((el) => expect(el.disabled).toBe(true));
  expect(document.querySelectorAll("[data-manager-select-all]")).toHaveLength(2);
  ["up", "down", "pin", "unpin", "delete"].forEach((a) =>
    expect(action(a).disabled).toBe(true),
  );
});
