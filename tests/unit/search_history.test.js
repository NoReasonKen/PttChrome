// @unit-env browser
// 搜尋紀錄（本機）：釘選／最近兩段、使用次數與自動釘選、↑ 的順序都是行為的一部分；
// 不可混進 pref（會同步）。
import {
  MAX_SEARCH_HISTORY,
  MAX_PINNED_SEARCH_HISTORY,
  SEARCH_HISTORY_KEY,
  addSearchEntry,
  pinSearchEntry,
  unpinSearchEntry,
  isSearchPinFull,
  moveSearchEntry,
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
  test("最多 20 筆，最舊的掉出去", () => {
    const texts = Array.from({ length: 25 }, (_, i) => "B" + i);
    const order = searchHistoryOrder(searchMany(null, "board", texts), "board");
    expect(MAX_SEARCH_HISTORY).toBe(20);
    expect(order).toHaveLength(20);
    expect(order[0]).toBe("B24");
    expect(order[19]).toBe("B5");
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
  test("釘選的排在最前面，照釘的順序", () => {
    let h = searchMany(null, "title", ["a", "b", "c"]);
    h = pinSearchEntry(h, "title", "a");
    h = pinSearchEntry(h, "title", "c");
    expect(searchHistoryOrder(h, "title")).toEqual(["a", "c", "b"]);
    expect(searchHistoryKind(h, "title").pinned).toEqual([
      { text: "a", auto: false },
      { text: "c", auto: false },
    ]);
  });
  test("釘選把次數歸零；釘選期間再搜尋不移動、不重複、不計數", () => {
    let h = searchMany(null, "title", ["a", "a", "b"]);
    h = pinSearchEntry(h, "title", "a");
    h = searchMany(h, "title", ["a", "b"]);
    expect(searchHistoryOrder(h, "title")).toEqual(["a", "b"]);
    h = unpinSearchEntry(h, "title", "a");
    expect(searchHistoryKind(h, "title").recent).toContainEqual({ text: "a", uses: 0 });
  });
  test("取消釘選回到最近的最前面；最近滿了就擠掉最舊的", () => {
    const texts = Array.from({ length: 21 }, (_, i) => "t" + i);
    let h = searchMany(null, "title", texts); // t20..t1，t0 已掉出去
    h = pinSearchEntry(h, "title", "t20");
    h = addSearchEntry(h, "title", "t21"); // 最近又滿 20 筆：t21, t19..t1
    h = unpinSearchEntry(h, "title", "t20");
    const order = searchHistoryOrder(h, "title");
    expect(order.slice(0, 3)).toEqual(["t20", "t21", "t19"]);
    expect(order).toHaveLength(20);
    expect(order).not.toContain("t1");
  });
  test("釘選滿 20 筆就不能再釘，也不擠掉任何一筆", () => {
    const texts = Array.from({ length: 21 }, (_, i) => "p" + i);
    let h = null;
    texts.forEach((t) => {
      h = pinSearchEntry(addSearchEntry(h, "push", t), "push", t);
    });
    const k = searchHistoryKind(h, "push");
    expect(MAX_PINNED_SEARCH_HISTORY).toBe(20);
    expect(k.pinned).toHaveLength(20);
    expect(k.pinned[19].text).toBe("p19");
    expect(k.recent).toEqual([{ text: "p20", uses: 1 }]);
    expect(isSearchPinFull(h, "push")).toBe(true);
    expect(isSearchPinFull(h, "title")).toBe(false);
  });
});

describe("自動釘選", () => {
  const ten = (t) => Array.from({ length: 10 }, () => t);
  test("第 10 次搜尋自動釘選到最後面，標記自動、次數歸零", () => {
    let h = searchMany(null, "author", ["x", "y"]);
    h = pinSearchEntry(h, "author", "x");
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
    h = unpinSearchEntry(h, "title", "k");
    h = searchMany(h, "title", ten("k").slice(0, 9));
    expect(searchHistoryKind(h, "title").recent).toEqual([{ text: "k", uses: 9 }]);
    h = addSearchEntry(h, "title", "k");
    expect(searchHistoryKind(h, "title").pinned).toEqual([{ text: "k", auto: true }]);
  });
  test("釘選滿了就不自動釘選、不擠掉任何一筆；下一次搜尋再判斷", () => {
    let h = null;
    for (let i = 0; i < 20; ++i) h = pinSearchEntry(addSearchEntry(h, "board", "P" + i), "board", "P" + i);
    h = searchMany(h, "board", ten("hot").concat("hot"));
    let k = searchHistoryKind(h, "board");
    expect(k.pinned.map((it) => it.text)).not.toContain("hot");
    expect(k.recent).toEqual([{ text: "hot", uses: 11 }]);
    h = unpinSearchEntry(h, "board", "P3");
    h = addSearchEntry(h, "board", "hot");
    k = searchHistoryKind(h, "board");
    expect(k.pinned[19]).toEqual({ text: "hot", auto: true });
    expect(k.recent.map((it) => it.text)).toEqual(["P3"]);
  });
  test("手動釘選自動釘選的那筆，不再標記自動", () => {
    let h = searchMany(null, "title", ten("k"));
    h = unpinSearchEntry(h, "title", "k");
    h = pinSearchEntry(h, "title", "k");
    expect(searchHistoryKind(h, "title").pinned).toEqual([{ text: "k", auto: false }]);
  });
});

describe("管理", () => {
  function pinnedABC() {
    let h = searchMany(null, "title", ["a", "b", "c", "r"]);
    ["a", "b", "c"].forEach((t) => (h = pinSearchEntry(h, "title", t)));
    return h;
  }
  test("釘選的上移／下移；到頂或到底不動", () => {
    let h = pinnedABC();
    h = moveSearchEntry(h, "title", "c", -1);
    expect(searchHistoryOrder(h, "title")).toEqual(["a", "c", "b", "r"]);
    h = moveSearchEntry(h, "title", "a", 1);
    expect(searchHistoryOrder(h, "title")).toEqual(["c", "a", "b", "r"]);
    h = moveSearchEntry(moveSearchEntry(h, "title", "c", -1), "title", "b", 1);
    expect(searchHistoryOrder(h, "title")).toEqual(["c", "a", "b", "r"]);
  });
  test("一次刪多筆，釘選和最近都可以刪，其他種類不動", () => {
    let h = addSearchEntry(pinnedABC(), "author", "a");
    h = removeSearchEntries(h, "title", ["a", "r"]);
    expect(searchHistoryOrder(h, "title")).toEqual(["b", "c"]);
    expect(searchHistoryOrder(h, "author")).toEqual(["a"]);
  });
  test("落地：updateSearchHistory 讀出、改、寫回", () => {
    rememberSearch("title", "x1");
    rememberSearch("title", "x2");
    const h = updateSearchHistory((cur) => pinSearchEntry(cur, "title", "x1"));
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
