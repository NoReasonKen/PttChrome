import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { collectReleaseCommits } from "../../scripts/release-records.mjs";

test("official release boundaries ignore intermediate tags and note-only preparation", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "release-history-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      encoding: "utf8",
    }).trim();
  const commit = (file, content, subject) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), content);
    git("add", file);
    git("commit", "-m", subject);
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Release fixture");
    git("config", "user.email", "release@example.invalid");
    git("config", "commit.gpgSign", "false");
    git("config", "tag.gpgSign", "false");
    const base = commit("app.js", "initial", "initial release");
    const first = commit("app.js", "first", "fix: preserve search results");
    git("tag", "intermediate-build");
    const second = commit("app.js", "second", "fix: preserve article rotation");
    commit("releases/0.2.0.json", "{}", "docs: prepare structured release notes");
    const source = commit(
      "releases/0.2.0.md",
      "Release detail",
      "docs: prepare release notes",
    );
    const commits = collectReleaseCommits(
      { previousRelease: { version: "0.1.0", sourceCommit: base } },
      { cwd, sourceCommit: source },
    );
    expect(commits).toEqual([
      { sha: first, subject: "fix: preserve search results" },
      { sha: second, subject: "fix: preserve article rotation" },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
