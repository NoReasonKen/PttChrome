import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadReleaseRecords, loadReleaseNotes, renderReleaseNotes } from "../../scripts/release-records.mjs";

const root = path.resolve(__dirname, "../..");

test("published detail is tracked beside each release record", () => {
  for (const record of loadReleaseRecords()) {
    expect(loadReleaseNotes(record)).toContain("## Changes");
    expect(loadReleaseNotes(record)).toContain(record.commits[0].sha);
  }
});

test("publication refuses missing or outdated detail instead of silently replacing reviewed text", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-detail-"));
  const record = loadReleaseRecords()[0];
  try {
    expect(() => loadReleaseNotes(record, directory)).toThrow();
    fs.writeFileSync(path.join(directory, `${record.version}.md`), renderReleaseNotes(record));
    expect(() => loadReleaseNotes({ ...record, summary: { ...record.summary, en: ["New user-visible improvement"] } }, directory)).toThrow("out of date");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("historical records identify the first fork baseline and the actual previous release", () => {
  const records = loadReleaseRecords();
  expect(records.map((record) => record.version)).toEqual(expect.arrayContaining([
    "0.1.0",
    "0.2.0",
  ]));
  const first = records.find((record) => record.version === "0.1.0");
  const second = records.find((record) => record.version === "0.2.0");
  expect(first.previousRelease).toBeNull();
  expect(first.baselineCommit).toBe("f2896b2d2573677ab49026d17c33b57b87cdcbf5");
  expect(second.previousRelease).toEqual({
    version: "0.1.0",
    sourceCommit: first.sourceCommit,
  });
  expect(second.nativeChanged).toBe(false);
});

test("a stable release is exposed only after signed APK metadata and notes are ready", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/android.yml"),
    "utf8",
  );
  expect(workflow.indexOf("name: Verify release signature")).toBeLessThan(
    workflow.indexOf("name: Prepare update artifacts"),
  );
  expect(workflow.indexOf("name: Prepare update artifacts")).toBeLessThan(
    workflow.indexOf("name: Publish release"),
  );
  expect(workflow).toContain("--badging apk-badging.txt");
  expect(workflow).toContain("pttchrome.apk LICENSE update.json");
  expect(workflow).toContain("            --draft ");
  expect(workflow).toContain("--draft=false --latest");
  expect(workflow).toContain("fetch-depth: 0");
});
