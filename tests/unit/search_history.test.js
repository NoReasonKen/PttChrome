// @unit-env browser
// 搜尋紀錄（本機）：釘選／最近兩段、使用次數與自動釘選、↑ 的順序都是行為的一部分；
// 不可混進 pref（會同步）。
import {
  MAX_SEARCH_HISTORY,
  MAX_PINNED_SEARCH_HISTORY,
  SEARCH_HISTORY_KEY,
  addSearchEntry,
  pinSearchEntries,
  unpinSearchEntries,
  searchPinRoom,
  moveSearchEntries,
  removeSearchEntries,
  updateSearchHistory,
  searchHistoryKind,
  searchHistoryOrder,
  readSearchHistory,
  rememberSearch,
} from "../../src/js/search_history";
// pref_storage.js 的 PREF_STORAGE_KEY（未 export）：同步與匯出只碰這一把。
const PREF_STORAGE_KEY = "pttchrome.pref.v1";

beforeEach(() => {
  window.localStorage.clear();
});

function searchMany(h, kind, texts) {
  return texts.reduce((acc, t) => addSearchEntry(acc, kind, t), h);
}

describe("最近", () => {
  test("最新的排最前面、各種類分開記", () => {
    const h = searchMany(null, "title", ["問卦", "新聞"]);
    const h2 = addSearchEntry(h, "author", "abc");
    expect(searchHistoryOrder(h2, "title")).toEqual(["新聞", "問卦"]);
    expect(searchHistoryOrder(h2, "author")).toEqual(["abc"]);
    expect(searchHistoryOrder(h2, "push")).toEqual([]);
  });
  test("重複的往前提，不佔兩格，次數累加", () => {
    const h = searchMany(null, "title", ["a1", "b2", "a1"]);
    expect(searchHistoryOrder(h, "title")).toEqual(["a1", "b2"]);
    expect(searchHistoryKind(h, "title").recent).toEqual([
      { text: "a1", uses: 2 },
      { text: "b2", uses: 1 },
    ]);
  });
  test("最多 10 筆，最舊的掉出去", () => {
    const texts = Array.from({ length: 15 }, (_, i) => "B" + i);
    const order = searchHistoryOrder(searchMany(null, "board", texts), "board");
    expect(MAX_SEARCH_HISTORY).toBe(10);
    expect(order).toHaveLength(10);
    expect(order[0]).toBe("B14");
    expect(order[9]).toBe("B5");
  });
  test("空字串與未知種類不記，也不改原物件", () => {
    const h = addSearchEntry(null, "title", "x");
    const next = addSearchEntry(addSearchEntry(h, "title", "  "), "bogus", "y");
    expect(searchHistoryOrder(next, "title")).toEqual(["x"]);
    expect(next.bogus).toBeUndefined();
    addSearchEntry(h, "title", "z");
    expect(searchHistoryOrder(h, "title")).toEqual(["x"]);
  });
});

describe("釘選", () => {
  test("釘選的排在最前面，照釘的順序；一次釘多筆照最近的順序接在後面", () => {
    let h = searchMany(null, "title", ["a", "b", "c", "d"]); // 最近：d c b a
    h = pinSearchEntries(h, "title", ["a"]);
    h = pinSearchEntries(h, "title", ["b", "d"]);
    expect(searchHistoryOrder(h, "title")).toEqual(["a", "d", "b", "c"]);
    expect(searchHistoryKind(h, "title").pinned).toEqual([
      { text: "a", auto: false },
      { text: "d", auto: false },
      { text: "b", auto: false },
    ]);
  });
  test("釘選把次數歸零；釘選期間再搜尋不移動、不重複、不計數", () => {
    let h = searchMany(null, "title", ["a", "a", "b"]);
    h = pinSearchEntries(h, "title", ["a"]);
    h = searchMany(h, "title", ["a", "b"]);
    expect(searchHistoryOrder(h, "title")).toEqual(["a", "b"]);
    h = unpinSearchEntries(h, "title", ["a"]);
    expect(searchHistoryKind(h, "title").recent).toContainEqual({ text: "a", uses: 0 });
  });
  test("取消釘選回到最近的最前面（照釘選的順序）；最近滿了就擠掉最舊的", () => {
    const texts = Array.from({ length: 11 }, (_, i) => "t" + i);
    let h = searchMany(null, "title", texts); // t10..t1，t0 已掉出去
    h = pinSearchEntries(h, "title", ["t10", "t9"]);
    h = searchMany(h, "title", ["t11", "t12"]); // 最近又滿 10 筆：t12, t11, t8..t1
    h = unpinSearchEntries(h, "title", ["t9", "t10"]);
    const order = searchHistoryOrder(h, "title");
    expect(order.slice(0, 4)).toEqual(["t10", "t9", "t12", "t11"]);
    expect(order).toHaveLength(10);
    expect(order).not.toContain("t1");
    expect(order).not.toContain("t2");
  });
  test("釘選最多 10 筆；放不下的那一批整批不釘，也不擠掉任何一筆", () => {
    const texts = Array.from({ length: 12 }, (_, i) => "p" + i);
    let h = searchMany(null, "push", texts); // 最近：p11..p2
    h = pinSearchEntries(h, "push", ["p11", "p10", "p9", "p8", "p7", "p6", "p5", "p4", "p3"]);
    expect(searchPinRoom(h, "push")).toBe(1);
    const before = searchHistoryKind(h, "push");
    h = pinSearchEntries(h, "push", ["p2", "p12"]); // p12 不存在，只算 p2
    expect(searchHistoryKind(h, "push").pinned).toHaveLength(10);
    h = searchMany(h, "push", ["n1", "n2"]);
    const full = pinSearchEntries(h, "push", ["n1", "n2"]);
    expect(searchHistoryKind(full, "push").pinned).toHaveLength(10);
    expect(searchHistoryKind(full, "push").recent.map((it) => it.text)).toEqual(["n2", "n1"]);
    expect(MAX_PINNED_SEARCH_HISTORY).toBe(10);
    expect(before.pinned).toHaveLength(9);
    expect(searchPinRoom(h, "push")).toBe(0);
    expect(searchPinRoom(h, "title")).toBe(10);
  });
});

describe("自動釘選", () => {
  const ten = (t) => Array.from({ length: 10 }, () => t);
  test("第 10 次搜尋自動釘選到最後面，標記自動、次數歸零", () => {
    let h = searchMany(null, "author", ["x", "y"]);
    h = pinSearchEntries(h, "author", ["x"]);
    h = searchMany(h, "author", ten("y").slice(0, 8)); // y 共 9 次
    expect(searchHistoryKind(h, "author").pinned).toHaveLength(1);
    h = addSearchEntry(h, "author", "y");
    expect(searchHistoryKind(h, "author")).toEqual({
      pinned: [
        { text: "x", auto: false },
        { text: "y", auto: true },
      ],
      recent: [],
    });
  });
  test("取消自動釘選後從 0 重算，要再 10 次才會再釘", () => {
    let h = searchMany(null, "title", ten("k"));
    h = unpinSearchEntries(h, "title", ["k"]);
    h = searchMany(h, "title", ten("k").slice(0, 9));
    expect(searchHistoryKind(h, "title").recent).toEqual([{ text: "k", uses: 9 }]);
    h = addSearchEntry(h, "title", "k");
    expect(searchHistoryKind(h, "title").pinned).toEqual([{ text: "k", auto: true }]);
  });
  test("釘選滿了就不自動釘選、不擠掉任何一筆；下一次搜尋再判斷", () => {
    let h = null;
    for (let i = 0; i < 10; ++i) h = pinSearchEntries(addSearchEntry(h, "board", "P" + i), "board", ["P" + i]);
    h = searchMany(h, "board", ten("hot").concat("hot"));
    let k = searchHistoryKind(h, "board");
    expect(k.pinned.map((it) => it.text)).not.toContain("hot");
    expect(k.recent).toEqual([{ text: "hot", uses: 11 }]);
    h = unpinSearchEntries(h, "board", ["P3"]);
    h = addSearchEntry(h, "board", "hot");
    k = searchHistoryKind(h, "board");
    expect(k.pinned[9]).toEqual({ text: "hot", auto: true });
    expect(k.recent.map((it) => it.text)).toEqual(["P3"]);
  });
  test("手動釘選自動釘選的那筆，不再標記自動", () => {
    let h = searchMany(null, "title", ten("k"));
    h = unpinSearchEntries(h, "title", ["k"]);
    h = pinSearchEntries(h, "title", ["k"]);
    expect(searchHistoryKind(h, "title").pinned).toEqual([{ text: "k", auto: false }]);
  });
});

describe("管理", () => {
  // 釘選 a b c d e（逐筆釘），最近 r
  function pinnedAtoE() {
    const h = searchMany(null, "title", ["a", "b", "c", "d", "e", "r"]);
    return ["a", "b", "c", "d", "e"].reduce((acc, t) => pinSearchEntries(acc, "title", [t]), h);
  }
  const pinnedOrder = (h) => searchHistoryKind(h, "title").pinned.map((it) => it.text);
  test("一次上移多筆：各移一格、相對順序不變；頂到最上面的那幾筆不動", () => {
    let h = pinnedAtoE();
    h = moveSearchEntries(h, "title", ["b", "d"], -1);
    expect(pinnedOrder(h)).toEqual(["b", "a", "d", "c", "e"]);
    h = moveSearchEntries(h, "title", ["b", "a", "e"], -1);
    expect(pinnedOrder(h)).toEqual(["b", "a", "d", "e", "c"]);
  });
  test("一次下移多筆；到底的那幾筆不動；最近的紀錄不受影響", () => {
    let h = pinnedAtoE();
    h = moveSearchEntries(h, "title", ["d", "e", "b", "r"], 1);
    expect(pinnedOrder(h)).toEqual(["a", "c", "b", "d", "e"]);
    expect(searchHistoryKind(h, "title").recent.map((it) => it.text)).toEqual(["r"]);
  });
  test("一次刪多筆，釘選和最近都可以刪，其他種類不動", () => {
    let h = addSearchEntry(pinnedAtoE(), "author", "a");
    h = removeSearchEntries(h, "title", ["a", "r"]);
    expect(searchHistoryOrder(h, "title")).toEqual(["b", "c", "d", "e"]);
    expect(searchHistoryOrder(h, "author")).toEqual(["a"]);
  });
  test("落地：updateSearchHistory 讀出、改、寫回", () => {
    rememberSearch("title", "x1");
    rememberSearch("title", "x2");
    const h = updateSearchHistory((cur) => pinSearchEntries(cur, "title", ["x1"]));
    expect(searchHistoryOrder(h, "title")).toEqual(["x1", "x2"]);
    expect(searchHistoryOrder(readSearchHistory(), "title")).toEqual(["x1", "x2"]);
  });
});

describe("儲存", () => {
  test("round-trip，且 key 不是 pref（不同步、不進匯出）", () => {
    rememberSearch("title", "問卦");
    rememberSearch("title", "問卦");
    expect(searchHistoryKind(readSearchHistory(), "title").recent).toEqual([
      { text: "問卦", uses: 2 },
    ]);
    expect(SEARCH_HISTORY_KEY).not.toBe(PREF_STORAGE_KEY);
    expect(window.localStorage.getItem(PREF_STORAGE_KEY) || "").not.toContain("問卦");
  });
  test("新的 key，不讀舊的 v1 紀錄", () => {
    window.localStorage.setItem(
      "pttchrome.searchHistory.v1",
      JSON.stringify({ title: ["舊的"] }),
    );
    expect(SEARCH_HISTORY_KEY).not.toBe("pttchrome.searchHistory.v1");
    expect(searchHistoryOrder(readSearchHistory(), "title")).toEqual([]);
  });
  test("壞掉的 JSON ⇒ 空紀錄，不 throw", () => {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, "{oops");
    const h = readSearchHistory();
    ["title", "author", "push", "board"].forEach((k) =>
      expect(searchHistoryKind(h, k)).toEqual({ pinned: [], recent: [] }),
    );
  });
  test("形狀不對的項目被丟掉", () => {
    window.localStorage.setItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify({
        title: {
          pinned: [{ text: "p", auto: true }, { text: "" }, 3],
          recent: [{ text: "r", uses: 2 }, { text: "x", uses: "many" }, null],
        },
        author: ["v1 形狀"],
      }),
    );
    const h = readSearchHistory();
    expect(searchHistoryKind(h, "title")).toEqual({
      pinned: [{ text: "p", auto: true }],
      recent: [
        { text: "r", uses: 2 },
        { text: "x", uses: 0 },
      ],
    });
    expect(searchHistoryKind(h, "author")).toEqual({ pinned: [], recent: [] });
  });
  test("重複的項目只留第一筆；已釘選的不會再出現在最近", () => {
    window.localStorage.setItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify({
        title: {
          pinned: [{ text: "p" }, { text: "p", auto: true }],
          recent: [
            { text: "p", uses: 3 },
            { text: "r", uses: 2 },
            { text: "r", uses: 5 },
          ],
        },
      }),
    );
    expect(searchHistoryKind(readSearchHistory(), "title")).toEqual({
      pinned: [{ text: "p", auto: false }],
      recent: [{ text: "r", uses: 2 }],
    });
  });
  test("localStorage 丟例外 ⇒ 不 throw", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => rememberSearch("title", "x")).not.toThrow();
    spy.mockRestore();
  });
});
