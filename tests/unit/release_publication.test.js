import fs from "node:fs";
import path from "node:path";
import { loadReleaseRecords } from "../../scripts/release-records.mjs";

const root = path.resolve(__dirname, "../..");

test("historical records identify the first fork baseline and the actual previous release", () => {
  const records = loadReleaseRecords();
  expect(records.map((record) => record.version).sort()).toEqual([
    "0.1.0",
    "0.2.0",
  ]);
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
