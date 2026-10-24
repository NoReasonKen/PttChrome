// Tracked files must not point at files that exist only on a developer's machine.
// Agent instructions, briefings and handoffs are local-only (see the .gitignore
// section below), so a link or mention that works locally is a dead pointer in
// CI and for every other reader. Checked against `git ls-files`, not the
// working tree, because the ignored files exist locally and would hide the break.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const LOCAL_SECTION = "# Developer- and agent-facing files kept local";
// Files that must name the local-only paths: the ignore list itself, a check
// that reads them when present, and this test.
const MAY_NAME_LOCAL = new Set([
  ".gitignore",
  "tests/unit/no_recording_refs.test.js",
  "tests/unit/no_untracked_refs.test.js",
]);

// Entries of the .gitignore local-only section, as repository-relative paths.
export function localOnlyEntries(gitignore) {
  const lines = gitignore.split("\n");
  const start = lines.findIndex((l) => l.startsWith(LOCAL_SECTION));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    if (!line.startsWith("#")) out.push(line.replace(/^\//, ""));
  }
  return out;
}

// Relative Markdown links in `file` whose targets are not tracked.
export function untrackedLinks(file, text, tracked, trackedDirs) {
  const bad = [];
  for (const [, raw] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z+.-]*:|^#|^\//i.test(raw)) continue;
    const target = decodeURI(raw.split("#")[0].split("?")[0]).replace(/:\d+(-\d+)?$/, "");
    // Placeholders such as `](url)` in examples are not paths.
    if (!target || !/[./]/.test(target)) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target)).replace(/\/$/, "");
    // Leaving the repository (README's `../../issues`) targets GitHub, not a file.
    if (resolved.startsWith("..")) continue;
    if (!tracked.has(resolved) && !trackedDirs.has(resolved)) bad.push(`${file} -> ${raw}`);
  }
  return bad;
}

// Mentions of local-only paths in a tracked file's text.
export function localMentions(file, text, entries) {
  return entries
    .filter((entry) => text.includes(entry.replace(/\/$/, "")))
    .map((entry) => `${file} mentions ${entry}`);
}

function trackedFiles() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean);
  const dirs = new Set();
  for (const f of files) {
    for (let d = path.posix.dirname(f); d !== "."; d = path.posix.dirname(d)) dirs.add(d);
  }
  return { files: new Set(files), dirs };
}

const isText = (f) => /\.(md|m?[jt]sx?|cjs|css|html|kt|java|sh|ya?ml|json)$/.test(f);

describe("negative controls", () => {
  const tracked = new Set(["docs/a.md", "docs/b.md", "README.md"]);
  const dirs = new Set(["docs"]);

  test("a link to an untracked file is reported; tracked, external and placeholder links are not", () => {
    const text = "[ok](b.md) [dir](../docs/) [gone](agents/topics.md) [gh](../../issues) [web](https://x.y) [ph](url)";
    expect(untrackedLinks("docs/a.md", text, tracked, dirs)).toEqual(["docs/a.md -> agents/topics.md"]);
  });

  test("local-only section entries are parsed and mentions are found", () => {
    const entries = localOnlyEntries(`x/\n\n${LOCAL_SECTION} (see AGENTS.md)\n/AGENTS.md\n/docs/agents/\n\n/other\n`);
    expect(entries).toEqual(["AGENTS.md", "docs/agents/"]);
    expect(localMentions("src/a.js", "// see docs/agents/topics.md", entries)).toEqual(["src/a.js mentions docs/agents/"]);
  });
});

test("tracked files neither link to nor name local-only files", () => {
  const { files, dirs } = trackedFiles();
  const entries = localOnlyEntries(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"));
  expect(entries).toContain("AGENTS.md");
  const problems = [];
  for (const f of files) {
    if (!isText(f) || !fs.existsSync(path.join(ROOT, f))) continue;
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (f.endsWith(".md")) problems.push(...untrackedLinks(f, text, files, dirs));
    if (!MAY_NAME_LOCAL.has(f)) problems.push(...localMentions(f, text, entries));
  }
  expect(problems).toEqual([]);
});
