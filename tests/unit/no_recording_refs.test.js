// Documentation, comments, and test names must remain useful to future sessions;
// see AGENTS.md. User captures are private, so their names and timestamps are
// dead pointers. Describe the facts or reference a cassette stored in the repo.
//
// This is a static unit check, like tests/unit/no_test_retry.test.js.
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const DIRS = ["src", "tests", "docs", "scripts", "tools", "android", "proxy"];
const TOP = ["AGENTS.md", "CLAUDE.md", "README.md"];
const SKIP_DIR = new Set(["node_modules", "build", ".gradle", "__recordings__", "cassettes", "3rd_script"]);
const TEXT = /\.(m?[jt]sx?|cjs|md|css|html|kt|java|sh|ya?ml)$/;
// These tests exercise the downloaded filename format itself.
const ALLOW = new Set([
  "android/app/src/test/java/io/github/abccbaandy/pttchrome/FileSaveTest.kt",
  "tests/unit/debug_record_control.test.js",
]);
const REF = /ptt-debug-\d{8}-\d{6}/;

function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel + "/" + ent.name;
    if (ent.isDirectory()) {
      if (!SKIP_DIR.has(ent.name)) walk(r, out);
    } else if (TEXT.test(ent.name)) out.push(r);
  }
  return out;
}

test("repository files do not reference private recording filenames", () => {
  const files = [...DIRS.flatMap((d) => walk(d, [])), ...TOP.filter((f) => fs.existsSync(path.join(ROOT, f)))];
  expect(files.length).toBeGreaterThan(100);
  const hits = [];
  for (const f of files) {
    if (ALLOW.has(f)) continue;
    fs.readFileSync(path.join(ROOT, f), "utf8")
      .split("\n")
      .forEach((line, i) => REF.test(line) && hits.push(`${f}:${i + 1}: ${line.trim()}`));
  }
  expect(hits).toEqual([]);
});

test("the guard detects concrete filenames and allows generic patterns", () => {
  // Split the concrete filename so the repository scan does not match it.
  expect(REF.test("// Capture ptt-" + "debug-20261021-190835: misplaced card")).toBe(true);
  expect(REF.test("Recording filename pattern: `ptt-debug-*` (not tracked)")).toBe(false);
});
