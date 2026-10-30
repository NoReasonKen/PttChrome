import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { prepareUpdateArtifacts, renderReleaseNotes } from "../../scripts/release-records.mjs";
import { runReleaseDryRun } from "../../scripts/release-dry-run.mjs";

const source = "a".repeat(40);
const badging = "package: name='io.github.noreasonken.pttchrome' versionCode='42' versionName='0.0.0'\nminSdkVersion:'26'\ntargetSdkVersion:'37'\n";
const record = {
  schemaVersion: 1,
  version: "0.0.0",
  tag: "android-fork-v0.0.0",
  publishedAt: null,
  previousRelease: null,
  nativeChanged: true,
  summary: { en: ["Publication dry run"], zhTW: ["Publication dry run"] },
  commits: [],
};

test("artifact preparation binds the actual manifest, APK bytes and reviewed notes", () => {
  const apkBytes = Buffer.from("APK fixture bytes");
  const notes = renderReleaseNotes(record);
  const artifacts = prepareUpdateArtifacts(record, [record], { apkBytes, badging, sourceCommit: source, versionCode: 42, notes });
  expect(artifacts.notes).toBe(notes);
  expect(artifacts.metadata).toMatchObject({
    version: "0.0.0", versionCode: 42, minSdk: 26, nativeVersionCode: 42,
    sourceCommit: source,
    apk: { size: apkBytes.length, sha256: createHash("sha256").update(apkBytes).digest("hex") },
  });
  expect(() => prepareUpdateArtifacts(record, [record], { apkBytes, badging: badging.replace("versionName='0.0.0'", "versionName='0.0.0-dev'"), sourceCommit: source, versionCode: 42, notes })).toThrow("identity");
  expect(() => prepareUpdateArtifacts(record, [record], { apkBytes, badging, sourceCommit: source, versionCode: 43, notes })).toThrow("version");
  expect(() => prepareUpdateArtifacts(record, [record], { apkBytes, badging, sourceCommit: source, versionCode: 42, notes: "Unreviewed notes" })).toThrow("detail");
});

test("a dry run writes the same asset payload without network access or release-tag mutation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-dry-run-"));
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Network access is forbidden"); });
  try {
    const apk = path.join(directory, "fixture.apk");
    const manifest = path.join(directory, "badging.txt");
    const outputDir = path.join(directory, "output");
    const bytes = Buffer.from("Unsigned production-package APK fixture");
    fs.writeFileSync(apk, bytes);
    fs.writeFileSync(manifest, badging);
    const result = runReleaseDryRun({ apk, badging: manifest, source, versionCode: 42, outputDir });
    const metadata = JSON.parse(fs.readFileSync(path.join(outputDir, "update.json"), "utf8"));
    expect(metadata).toEqual(result.metadata);
    expect(metadata.apk.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(fs.readFileSync(path.join(outputDir, "release-notes.md"), "utf8")).toContain("CI publication dry run; never publish.");
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.readdirSync(directory).sort()).toEqual(["badging.txt", "fixture.apk", "output"]);
  } finally {
    fetch.mockRestore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
