// 外部搜尋（右鍵選單）的純邏輯守護。
//
// 這裡同時鎖住兩個被重構掉的舊 bug：
//   1) 舊 doSearchGoogle 用字串相接組 ?q=，選到帶 & # + 的字就組出錯的網址
//   2) 舊版右鍵搜尋只做單次 .replace("%s")，多個 %s 的樣板會漏換
// 以及「內建項目不進 pref、只存被停用的 id」這個決定（陣列 pref 是整包覆蓋，把內建
// 存進去會凍結在第一次寫入的狀態）。
import {
  BUILTIN_EXTERNAL_SEARCH,
  MATCH_ANY,
  MATCH_DIGITS,
  buildExternalSearchUrl,
  makeExternalSearchId,
  normalizeExternalSearchQuery,
  pruneExternalSearchEntries,
  externalSearchMatches,
  externalSearchQueryFor,
  resolveExternalSearchItems,
  validateExternalSearchEntry,
  visibleExternalSearchItems,
} from "../../src/js/external_search";
import { DEFAULT_PREFS } from "../../src/js/pref_storage";

// PTT 畫面每一格空白都是 &nbsp;(U+00A0)。用碼點組出來，避免原始碼裡出現肉眼分不出
// 來的字元。
const NBSP = String.fromCharCode(0xa0);

const custom = (over = {}) => ({
  id: "c1",
  name: "測試站",
  urlTemplate: "https://example.com/s?q=%s",
  match: MATCH_ANY,
  enabled: true,
  ...over,
});

describe("normalizeExternalSearchQuery", () => {
  test("nbsp 被當成空白收掉（不然純數字判斷會整個失效）", () => {
    expect(
      normalizeExternalSearchQuery(NBSP + "126291399" + NBSP + NBSP),
    ).toBe("126291399");
  });

  test("換行／連續空白收成單一空白並 trim", () => {
    expect(normalizeExternalSearchQuery("  台北   天氣 \n 如何 ")).toBe(
      "台北 天氣 如何",
    );
  });

  test("null / undefined 不炸，回空字串", () => {
    expect(normalizeExternalSearchQuery(null)).toBe("");
    expect(normalizeExternalSearchQuery(undefined)).toBe("");
  });
});

describe("externalSearchMatches", () => {
  test("digits 只收純數字", () => {
    expect(externalSearchMatches("126291399", MATCH_DIGITS)).toBe(true);
    expect(externalSearchMatches("abc123", MATCH_DIGITS)).toBe(false);
    expect(externalSearchMatches("126291399 ", MATCH_DIGITS)).toBe(false);
    expect(externalSearchMatches("台北", MATCH_DIGITS)).toBe(false);
  });

  test("any 收任意非空字串", () => {
    expect(externalSearchMatches("台北", MATCH_ANY)).toBe(true);
    expect(externalSearchMatches("126291399", MATCH_ANY)).toBe(true);
  });

  test("空查詢一律不符合（選單就不該出現任何項目）", () => {
    expect(externalSearchMatches("", MATCH_ANY)).toBe(false);
    expect(externalSearchMatches("", MATCH_DIGITS)).toBe(false);
  });
});

describe("buildExternalSearchUrl", () => {
  // 回歸守護：舊版 App.doSearchGoogle 是 'http://google.com/search?q='+searchTerm，
  // 選到 'a&b=c' 會被 google 當成兩個參數。
  test("查詢字串一律 encodeURIComponent", () => {
    expect(
      buildExternalSearchUrl("https://www.google.com/search?q=%s", "a&b=c#d+e f"),
    ).toBe("https://www.google.com/search?q=a%26b%3Dc%23d%2Be%20f");
  });

  test("中文正確編碼", () => {
    expect(buildExternalSearchUrl("https://x.test/?q=%s", "台北")).toBe(
      "https://x.test/?q=%E5%8F%B0%E5%8C%97",
    );
  });

  // 回歸守護：舊版是單次 .replace("%s", ...)，第二個 %s 會原封不動留在網址裡。
  test("樣板裡每個 %s 都替換", () => {
    expect(buildExternalSearchUrl("https://x.test/%s/list?q=%s", "42")).toBe(
      "https://x.test/42/list?q=42",
    );
  });
});

describe("validateExternalSearchEntry", () => {
  test("通過時回 null", () => {
    expect(validateExternalSearchEntry(custom())).toBeNull();
  });

  test("沒有名稱 → externalsearch_err_name", () => {
    expect(validateExternalSearchEntry(custom({ name: "  " }))).toBe(
      "externalsearch_err_name",
    );
  });

  test.each([
    ["缺 %s", "https://example.com/s?q="],
    ["非 http(s)", "javascript:alert(1)"],
    ["空字串", ""],
  ])("網址不合法（%s）→ externalsearch_err_url", (_label, urlTemplate) => {
    expect(validateExternalSearchEntry(custom({ urlTemplate }))).toBe(
      "externalsearch_err_url",
    );
  });
});

describe("resolveExternalSearchItems", () => {
  test("空偏好 → 三個內建項目全啟用", () => {
    const items = resolveExternalSearchItems({});
    expect(items.map((i) => i.id)).toEqual([
      "google",
      "pixiv-user",
      "pixiv-artwork",
    ]);
    expect(items.every((i) => i.enabled && i.builtin)).toBe(true);
  });

  test("externalSearchDisabled 只影響 enabled，項目不會消失（設定頁要畫得出來）", () => {
    const items = resolveExternalSearchItems({ externalSearchDisabled: ["google"] });
    expect(items).toHaveLength(BUILTIN_EXTERNAL_SEARCH.length);
    expect(items.find((i) => i.id === "google").enabled).toBe(false);
  });

  test("自訂項目接在內建後面，沒過驗證的直接跳過", () => {
    const items = resolveExternalSearchItems({
      externalSearchCustom: [
        custom({ id: "ok" }),
        custom({ id: "bad-url", urlTemplate: "https://example.com/s" }),
        custom({ id: "bad-name", name: "" }),
      ],
    });
    expect(items.filter((i) => !i.builtin).map((i) => i.id)).toEqual(["ok"]);
  });

  test("非陣列的 pref 值不炸（舊版資料／雲端髒資料）", () => {
    expect(() =>
      resolveExternalSearchItems({
        externalSearchDisabled: "google",
        externalSearchCustom: null,
      }),
    ).not.toThrow();
    expect(resolveExternalSearchItems(undefined)).toHaveLength(
      BUILTIN_EXTERNAL_SEARCH.length,
    );
  });
});

describe("visibleExternalSearchItems", () => {
  test("純數字 → 三項全出現", () => {
    expect(visibleExternalSearchItems({}, "126291399").map((i) => i.id)).toEqual([
      "google",
      "pixiv-user",
      "pixiv-artwork",
    ]);
  });

  test("非數字 → 只剩 Google（pixiv 的 id 是數字，選到中文給它毫無意義）", () => {
    expect(visibleExternalSearchItems({}, "台北天氣").map((i) => i.id)).toEqual([
      "google",
    ]);
  });

  test("停用的內建項目不出現在選單", () => {
    const items = visibleExternalSearchItems(
      { externalSearchDisabled: ["google", "pixiv-artwork"] },
      "126291399",
    );
    expect(items.map((i) => i.id)).toEqual(["pixiv-user"]);
  });

  test("自訂項目的 enabled 與適用條件都生效", () => {
    const values = {
      externalSearchDisabled: ["google", "pixiv-user", "pixiv-artwork"],
      externalSearchCustom: [
        custom({ id: "on-any" }),
        custom({ id: "off", enabled: false }),
        custom({ id: "digits-only", match: MATCH_DIGITS }),
      ],
    };
    expect(visibleExternalSearchItems(values, "台北").map((i) => i.id)).toEqual([
      "on-any",
    ]);
    expect(visibleExternalSearchItems(values, "42").map((i) => i.id)).toEqual([
      "on-any",
      "digits-only",
    ]);
  });

  test("空查詢 → 完全沒有項目", () => {
    expect(visibleExternalSearchItems({}, "")).toEqual([]);
  });
});

describe("pruneExternalSearchEntries", () => {
  test("整列空白（剛按新增還沒填）的項目在關閉設定時被丟掉", () => {
    const next = pruneExternalSearchEntries({
      externalSearchCustom: [
        custom(),
        custom({ id: "blank", name: "", urlTemplate: "" }),
      ],
    });
    expect(next.externalSearchCustom.map((c) => c.id)).toEqual(["c1"]);
  });

  test("填了一半的保留（使用者還在編輯，不能吃掉他打的字）", () => {
    const half = custom({ id: "half", urlTemplate: "" });
    const values = { externalSearchCustom: [half] };
    expect(pruneExternalSearchEntries(values)).toBe(values);
  });
});

describe("預設值不可被污染", () => {
  // readValuesWithDefault / onResetClick 都是 { ...DEFAULT_PREFS } 淺層複製，陣列
  // 共用同一個 reference：任何 in-place 修改都會毀掉整個 session 的預設值。
  test("DEFAULT_PREFS 的兩個陣列是空的且 frozen", () => {
    expect(DEFAULT_PREFS.externalSearchDisabled).toEqual([]);
    expect(DEFAULT_PREFS.externalSearchCustom).toEqual([]);
    expect(Object.isFrozen(DEFAULT_PREFS.externalSearchDisabled)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PREFS.externalSearchCustom)).toBe(true);
  });

  test("跑完解析流程後預設值仍是空陣列", () => {
    const values = { ...DEFAULT_PREFS };
    visibleExternalSearchItems(values, "126291399");
    resolveExternalSearchItems(values);
    pruneExternalSearchEntries(values);
    expect(DEFAULT_PREFS.externalSearchCustom).toHaveLength(0);
    expect(DEFAULT_PREFS.externalSearchDisabled).toHaveLength(0);
  });
});

describe("makeExternalSearchId", () => {
  test("連續產生不重複（React key／刪除定位靠它）", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeExternalSearchId()));
    expect(ids.size).toBe(50);
  });
});

// 症狀（使用者回報）：手機上外部搜尋叫不出來。選取模式關著時長按選單會先清掉
// Chromium 長按自動選起來的那個詞（不留把手），舊邏輯只看「現在有沒有選取」⇒
// 永遠沒有關鍵字。改成清之前記下那個詞，當成查詢字串。
describe("externalSearchQueryFor：選單用哪段字查", () => {
  test("有選取 ⇒ 用選取（長按詞不看）", () => {
    expect(
      externalSearchQueryFor({
        selEnabled: true,
        selectedText: " 選取\u00a0的字 ",
        longPressWord: "長按",
      }),
    ).toBe("選取 的字");
  });

  test("REGRESSION：手機長按（選取已清空）⇒ 用長按自動選起來的那個詞", () => {
    expect(
      externalSearchQueryFor({
        selEnabled: false,
        selectedText: "",
        longPressWord: "12345678\u00a0",
      }),
    ).toBe("12345678");
  });

  test("都沒有 ⇒ 空字串（外部搜尋不出現）", () => {
    expect(externalSearchQueryFor({ selEnabled: false, selectedText: "" })).toBe("");
  });
});
