// Flaky Hunt 紅了之後對 issue 的決策（scripts/flaky-hunt-report.mjs）。
//
// routine「fix Nightly flaky hunt 失敗」的 trigger 是「Issue opened、標題＝ISSUE_TITLE、作者
// github-actions[bot]」⇒ 每新開一個 issue 就起一個 Claude session。session 修完會手動 dispatch
// Flaky Hunt 驗證；PR 帶 `Fixes #N` 的話 merge 時 issue 已被關。舊版 report「沒有 open 的就新開」
// ⇒ 驗證 run 還紅就再 fire 一個 session，一路連鎖。這裡鎖住：只有 schedule 能新開。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decideReport, renderBody, renderFailures, loadFailures, mergeIssues, ISSUE_TITLE } from "../../scripts/flaky-hunt-report.mjs";

const open = (number) => ({ number, title: ISSUE_TITLE, state: "OPEN", closedAt: null });
const closed = (number, closedAt) => ({ number, title: ISSUE_TITLE, state: "CLOSED", closedAt });

describe("decideReport", () => {
  test("schedule、沒有 open issue ⇒ 新開（觸發 routine）", () => {
    expect(decideReport({ event: "schedule", issues: [] })).toEqual({ kind: "create" });
    expect(decideReport({ event: "schedule", issues: [closed(7, "2026-10-12T00:00:00Z")] })).toEqual({
      kind: "create",
    });
  });

  test("已有 open issue ⇒ 只留言（schedule／dispatch 皆同）", () => {
    for (const event of ["schedule", "workflow_dispatch"]) {
      expect(decideReport({ event, issues: [open(9), closed(7, "2026-10-12T00:00:00Z")] })).toEqual({
        kind: "comment",
        number: 9,
      });
    }
  });

  test("連鎖情境：issue 已被 Fixes #N 關掉，驗證 dispatch 仍紅 ⇒ 留言在最近關的那個，不新開", () => {
    const issues = [closed(3, "2026-10-01T00:00:00Z"), closed(9, "2026-10-13T04:00:00Z")];
    expect(decideReport({ event: "workflow_dispatch", issues })).toEqual({ kind: "comment", number: 9 });
  });

  test("dispatch 且從沒有過 issue ⇒ 什麼都不寫", () => {
    expect(decideReport({ event: "workflow_dispatch", issues: [] })).toEqual({ kind: "none" });
  });

  test("過時紅：跑的 commit 已非 dev HEAD ⇒ 不新開，留言在最近關的那個", () => {
    // 情境：nightly 晚 3～5h 才開跑，跑的期間 session 已 merge 修正並關掉 issue。
    const issues = [closed(9, "2026-10-13T04:00:00Z")];
    expect(decideReport({ event: "schedule", issues, sha: "old", headSha: "new" })).toEqual({
      kind: "comment",
      number: 9,
    });
    expect(decideReport({ event: "schedule", issues: [], sha: "old", headSha: "new" })).toEqual({ kind: "none" });
  });

  test("過時紅但還有 open issue ⇒ 留言在 open 的", () => {
    const issues = [open(11), closed(9, "2026-10-13T04:00:00Z")];
    expect(decideReport({ event: "schedule", issues, sha: "old", headSha: "new" })).toEqual({
      kind: "comment",
      number: 11,
    });
  });

  test("跑的就是 dev HEAD ⇒ schedule 照常新開", () => {
    expect(decideReport({ event: "schedule", issues: [], sha: "abc", headSha: "abc" })).toEqual({ kind: "create" });
  });

  test("搜尋是模糊比對：標題不完全相同的不算", () => {
    const other = { number: 5, title: `${ISSUE_TITLE}（舊）`, state: "OPEN", closedAt: null };
    expect(decideReport({ event: "workflow_dispatch", issues: [other] })).toEqual({ kind: "none" });
    expect(decideReport({ event: "schedule", issues: [other] })).toEqual({ kind: "create" });
  });
});

test("dispatch 的留言講明沒開新 issue 的理由", () => {
  const body = renderBody({ event: "workflow_dispatch", date: "2026-10-13", runUrl: "u", sha: "s", results: "r", repeat: "10" });
  expect(body).toContain("不開新 issue");
  expect(body).toContain("- run: u");
});

test("body 帶 ref 一行（routine 判斷「只處理 dev」不用點進 run）", () => {
  const body = renderBody({ event: "schedule", date: "d", runUrl: "u", sha: "s", headSha: "s", ref: "refs/heads/dev", results: "r", repeat: "10" });
  expect(body).toContain("- ref: refs/heads/dev");
  expect(body).not.toContain("已非 dev HEAD");
});

test("過時紅的留言標註 commit 已非 dev HEAD", () => {
  const body = renderBody({ event: "schedule", date: "d", runUrl: "u", sha: "old", headSha: "new", ref: "refs/heads/dev", results: "r", repeat: "10" });
  expect(body).toContain("此 run 的 commit 已非 dev HEAD");
  expect(body).toContain("new");
});

test("mergeIssues：label 與搜尋兩路結果依 number 去重", () => {
  const merged = mergeIssues([open(3), open(4)], [open(4), closed(2, "x")]);
  expect(merged.map((i) => i.number).sort()).toEqual([2, 3, 4]);
});

test("workflow 的 report job 交給 scripts/flaky-hunt-report.mjs，不再自己 gh issue create", () => {
  const yaml = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "flaky-hunt.yml"), "utf8");
  const report = yaml.slice(yaml.indexOf("\n  report:"));
  expect(report).toContain("node scripts/flaky-hunt-report.mjs");
  expect(report).toContain("sparse-checkout: scripts/flaky-hunt-report.mjs");
  expect(yaml).not.toContain("gh issue create");
});

test("report 新開 issue 掛 label、查詢走 label（搜尋索引查不到剛建立的 issue）", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "flaky-hunt-report.mjs"), "utf8");
  expect(src).toMatch(/"issue", "create",[^\n]*"--label", ISSUE_LABEL/);
  expect(src).toContain('"--label", ISSUE_LABEL])');
});

describe("留言帶失敗的 test（不必下載 job log）", () => {
  const pw = (n, shard = "7/8") => ({
    kind: "playwright",
    suite: "e2e-offline",
    project: "offline-mobile",
    file: `tests/e2e/offline/x${n}.offline.spec.js`,
    line: 90,
    title: "the entrance › sends `Ctrl+Z`",
    error: "Test timeout of 60000ms exceeded.",
    where: `shard ${shard}`,
  });
  const vt = (round) => ({
    kind: "vitest",
    suite: "unit",
    project: "unit-browser (chromium)",
    file: "tests/unit/lazy_inline_preview.test.js",
    title: "延遲載入佔位盒 > 替身盒",
    error: "AssertionError: expected null not to be null",
    where: `round ${round}`,
  });

  test("Playwright：project › file:line › title；vitest：file › describe › test；各帶第一行錯誤", () => {
    const text = renderFailures([pw(1), vt(6)]).join("\n");
    expect(text).toContain("e2e-offline：`offline-mobile › tests/e2e/offline/x1.offline.spec.js:90 › the entrance › sends 'Ctrl+Z'`（shard 7/8）");
    expect(text).toContain("  - `Test timeout of 60000ms exceeded.`");
    expect(text).toContain("unit：`tests/unit/lazy_inline_preview.test.js › 延遲載入佔位盒 › 替身盒`（round 6）");
  });

  test("同一條 test 合併成次數與 round 清單", () => {
    const text = renderFailures([vt(6), vt(9)]).join("\n");
    expect(text).toContain("（1 條、共 2 次）");
    expect(text).toContain("×2（round 6、round 9）");
  });

  test("最多列 20 條，其餘只講數量", () => {
    const text = renderFailures(Array.from({ length: 25 }, (_, i) => pw(i))).join("\n");
    expect(text.match(/^- e2e-offline：/gm)).toHaveLength(20);
    expect(text).toContain("另有 5 條沒列出");
  });

  test("沒有失敗清單（job 沒留下）⇒ body 與舊版相同", () => {
    const args = { event: "schedule", date: "d", runUrl: "u", sha: "s", headSha: "s", ref: "r", results: "x", repeat: "10" };
    expect(renderBody({ ...args, failures: [] })).toBe(renderBody(args));
    expect(renderBody({ ...args, failures: [vt(6)] })).toContain("**失敗的測試**");
  });

  test("loadFailures：讀目錄下所有 ndjson、壞行略過、目錄不存在回空", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flaky-"));
    fs.writeFileSync(path.join(dir, "a.ndjson"), `${JSON.stringify(vt(6))}\nnot json\n`);
    fs.writeFileSync(path.join(dir, "b.ndjson"), `${JSON.stringify(pw(1))}\n`);
    fs.writeFileSync(path.join(dir, "ignore.txt"), "x");
    expect(loadFailures(dir).map((f) => f.kind)).toEqual(["vitest", "playwright"]);
    expect(loadFailures(path.join(dir, "nope"))).toEqual([]);
    expect(loadFailures(undefined)).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });

  test("workflow：每個重複 job 紅時上傳 flaky-failures-*，report 下載後交給腳本", () => {
    const yaml = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "flaky-hunt.yml"), "utf8");
    for (const suite of ["unit", "integration", "e2e-offline", "e2e-adverse"]) expect(yaml).toContain(`--suite=${suite}`);
    expect(yaml.match(/name: flaky-failures-/g)).toHaveLength(4);
    const report = yaml.slice(yaml.indexOf("\n  report:"), yaml.indexOf("\n  watchdog:"));
    expect(report).toContain("pattern: flaky-failures-*");
    expect(report).toContain("FAILURES_DIR: flaky-failures");
    expect(report).toContain("continue-on-error: true");
  });
});
