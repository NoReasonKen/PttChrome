// 從 Flaky Hunt 各重複 job 的 log 撈出「哪條 test 紅了」，讓 issue 留言直接帶失敗內容，
// 不必再下載整份 job log（~12 MB）才找得到。每個 job 在失敗時跑：
//   node scripts/flaky-hunt-failures.mjs <playwright|vitest> <logfile> --suite=NAME [--shard=LABEL|--round=N] >> flaky-failures/NAME.ndjson
// 一行一筆 JSON；report job 下載全部 ndjson 後由 scripts/flaky-hunt-report.mjs 彙整成留言。
//
// 為什麼掃 log 而不用 Playwright JSON／vitest json reporter：
//   - 逆境 e2e 一個 bucket 會起好幾個 playwright 進程（scripts/run-adverse-e2e.mjs），共用同一個
//     JSON 輸出檔會互相覆蓋；
//   - vitest 的 json 不帶 project 名，看不出是 node 還是 browser；
//   - 兩個 reporter 的失敗摘要格式穩定，且 job 本來就會印（解析不到時留言退回只有結果一行，不會更糟）。
// 只用 node 內建模組：report job 只 sparse-checkout 少數檔案。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 拿掉 ANSI 色碼與 GitHub API 下載的 log 才有的時間戳前綴。
export function normalizeLog(text) {
  return String(text)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ""));
}

// 失敗原因取第一個非空行；Playwright 的 `Error: ` 與 vitest 的 `AssertionError: ` 都在那一行。
function firstErrorLine(lines, from, limit = 8) {
  for (let i = from; i < Math.min(lines.length, from + limit); i++) {
    const t = lines[i].trim();
    if (t) return t.length > 240 ? `${t.slice(0, 237)}...` : t;
  }
  return "";
}

// Playwright list reporter 的失敗摘要：
//   `  1) [offline-mobile] › tests/e2e/offline/x.offline.spec.js:90:3 › describe › title `
//   `` ／ `    Error: ...`
export function parsePlaywrightLog(text, { suite, shard } = {}) {
  const lines = normalizeLog(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^ {2}\d+\) (.+?)[ ─]*$/.exec(lines[i]);
    if (!h) continue;
    const m = /^(?:\[([^\]]+)\] › )?(\S+?):(\d+):\d+ › (.+?)(?: \(retry #\d+\))?$/.exec(h[1]);
    if (!m) continue;
    out.push({
      kind: "playwright",
      suite,
      project: m[1] || "",
      file: m[2],
      line: Number(m[3]),
      title: m[4],
      error: firstErrorLine(lines, i + 1),
      where: shard ? `shard ${shard}` : "",
    });
  }
  return out;
}

// vitest 的失敗摘要：` FAIL   unit-browser (chromium)  tests/unit/x.test.js > describe > test` ／ `AssertionError: ...`。
// 同一輪內相同的 FAIL 行只算一次（即時輸出與最後摘要可能各印一次）。
export function parseVitestLog(text, { suite, round } = {}) {
  const lines = normalizeLog(text);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const h = /^ FAIL +(.+?)\s*$/.exec(lines[i]);
    if (!h) continue;
    const m = /^(?:(.+?) {2,})?(\S+\.(?:test|spec)\.[cm]?[jt]sx?)(?: > (.+?))?(?: \[ \S+ \])?$/.exec(h[1]);
    if (!m) continue;
    const key = h[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: "vitest",
      suite,
      project: m[1] || "",
      file: m[2],
      title: m[3] || "",
      error: firstErrorLine(lines, i + 1),
      where: round ? `round ${round}` : "",
    });
  }
  return out;
}

function main(argv) {
  const [kind, logFile, ...rest] = argv;
  const opts = Object.fromEntries(
    rest.map((a) => /^--([a-z]+)=(.*)$/s.exec(a)).filter(Boolean).map((m) => [m[1], m[2]]),
  );
  if (!["playwright", "vitest"].includes(kind) || !logFile) {
    console.error("usage: flaky-hunt-failures.mjs <playwright|vitest> <logfile> --suite=NAME [--shard=X] [--round=N]");
    process.exit(2);
  }
  if (!fs.existsSync(logFile)) return; // job 在跑測試前就掛了：沒有東西可撈
  const text = fs.readFileSync(logFile, "utf8");
  const found = kind === "playwright" ? parsePlaywrightLog(text, opts) : parseVitestLog(text, opts);
  for (const f of found) console.log(JSON.stringify(f));
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main(process.argv.slice(2));
