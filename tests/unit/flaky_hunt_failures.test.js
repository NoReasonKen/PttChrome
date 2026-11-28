// Flaky Hunt 失敗清單的解析（scripts/flaky-hunt-failures.mjs）。fixtures 是 2026-11-28 nightly 真實 job log
// 的節錄（拿掉時間戳前綴、截短過長的行）：Playwright 逾時／斷言失敗、vitest unit-browser 斷言失敗。
import fs from "node:fs";
import path from "node:path";
import { parsePlaywrightLog, parseVitestLog, normalizeLog } from "../../scripts/flaky-hunt-failures.mjs";

const fixture = (n) => fs.readFileSync(path.join(__dirname, "fixtures", "flaky_hunt", n), "utf8");

describe("parsePlaywrightLog", () => {
  test("逾時：project、file:line、title 與第一行錯誤，附 shard", () => {
    const [f, ...rest] = parsePlaywrightLog(fixture("playwright_timeout.log"), { suite: "e2e-offline", shard: "7/8" });
    expect(rest).toEqual([]);
    expect(f).toEqual({
      kind: "playwright",
      suite: "e2e-offline",
      project: "offline-mobile",
      file: "tests/e2e/offline/mobile_user_list_entry.offline.spec.js",
      line: 90,
      title: "the online user list entrance › 線上使用者 sends Ctrl+Z u, and the user cards slide in over the dashboard",
      error: "Test timeout of 60000ms exceeded.",
      where: "shard 7/8",
    });
  });

  test("斷言失敗：錯誤取 Error 那一行，不是後面幾十行的畫面內容", () => {
    const [f] = parsePlaywrightLog(fixture("playwright_expect.log"), { suite: "e2e-offline" });
    expect(f.file).toBe("tests/e2e/offline/mobile_stack_search_source.offline.spec.js");
    expect(f.line).toBe(645);
    expect(f.error).toBe("Error: expect(received).toContain(expected) // indexOf");
    expect(f.where).toBe("");
  });

  test("沒有失敗摘要、通過的列不算；(retry #N) 後綴與 ANSI／時間戳都吃得掉", () => {
    expect(parsePlaywrightLog("  ✓  1 [offline] › tests/e2e/a.spec.js:1:1 › ok (1s)\n  1 passed (1m)\n")).toEqual([]);
    const raw =
      "2026-11-28T04:00:52.3252515Z \x1b[31m  2) [offline] › tests/e2e/a.spec.js:5:3 › g › t (retry #1) \x1b[39m\n\n    Error: boom\n";
    expect(parsePlaywrightLog(raw)).toMatchObject([{ project: "offline", file: "tests/e2e/a.spec.js", line: 5, title: "g › t", error: "Error: boom" }]);
  });

  test("repeat-each 同一條紅多次 ⇒ 每次一筆（report 再合併計次）", () => {
    const one = "  1) [offline] › tests/e2e/a.spec.js:5:3 › t \n\n    Error: x\n";
    expect(parsePlaywrightLog(one + one.replace("1)", "2)"))).toHaveLength(2);
  });
});

describe("parseVitestLog", () => {
  test("unit-browser 的斷言失敗：project、file、describe > test 與第一行錯誤，附 round", () => {
    const found = parseVitestLog(fixture("vitest_browser_fail.log"), { suite: "unit", round: 6 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "vitest",
      suite: "unit",
      project: "unit-browser (chromium)",
      file: "tests/unit/lazy_inline_preview.test.js",
      title: expect.stringMatching(/^延遲載入佔位盒（掛載\/卸載） > 替身盒頂到真圖佔到版面為止/),
      error: "AssertionError: expected null not to be null",
      where: "round 6",
    });
  });

  test("沒有 project 欄、檔案層級失敗、同一輪重複印的 FAIL 行只算一次", () => {
    const text = [
      " FAIL  tests/unit/a.test.js > g > t",
      "Error: one",
      " FAIL  tests/unit/a.test.js > g > t",
      "Error: one",
      " FAIL  unit  tests/unit/b.test.js [ tests/unit/b.test.js ]",
      "SyntaxError: bad",
    ].join("\n");
    expect(parseVitestLog(text)).toMatchObject([
      { project: "", file: "tests/unit/a.test.js", title: "g > t", error: "Error: one" },
      { project: "unit", file: "tests/unit/b.test.js", title: "", error: "SyntaxError: bad" },
    ]);
  });

  test("全綠的 log ⇒ 空", () => {
    expect(parseVitestLog(" ✓  unit  tests/unit/a.test.js (3 tests) 5ms\n Test Files  1 passed (1)\n")).toEqual([]);
  });
});

test("normalizeLog 去 ANSI 與時間戳", () => {
  expect(normalizeLog("2026-11-28T04:00:52.3252515Z \x1b[31mhi\x1b[0m")).toEqual(["hi"]);
});
