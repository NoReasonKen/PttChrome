import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseApkBadging, prepareUpdateArtifacts, renderReleaseNotes, writeUpdateArtifacts } from "./release-records.mjs";

export function runReleaseDryRun({ apk, badging, source, versionCode, outputDir }) {
  const manifestText = fs.readFileSync(badging, "utf8");
  const manifest = parseApkBadging(manifestText);
  const record = {
    schemaVersion: 1,
    version: manifest.version,
    tag: `android-fork-v${manifest.version}`,
    publishedAt: null,
    previousRelease: null,
    nativeChanged: true,
    summary: { en: ["CI publication dry run; never publish."], zhTW: ["CI publication dry run; never publish."] },
    commits: [],
  };
  const artifacts = prepareUpdateArtifacts(record, [record], {
    apkBytes: fs.readFileSync(apk),
    badging: manifestText,
    sourceCommit: source,
    versionCode: Number(versionCode),
    notes: renderReleaseNotes(record),
  });
  writeUpdateArtifacts(outputDir, artifacts);
  return artifacts;
}

function main(args) {
  const allowed = new Set(["apk", "badging", "source", "version-code", "output-dir"]);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2);
    if (!args[index]?.startsWith("--") || !allowed.has(key) || !args[index + 1] || args[index + 1].startsWith("--") || Object.hasOwn(options, key)) {
      throw new Error("Expected unique --option value pairs");
    }
    options[key] = args[index + 1];
  }
  for (const key of allowed) {
    if (!options[key]) throw new Error(`Missing --${key}`);
  }
  const { metadata } = runReleaseDryRun({
    apk: options.apk, badging: options.badging, source: options.source,
    versionCode: options["version-code"], outputDir: options["output-dir"],
  });
  console.log(`Publication dry run passed: ${metadata.packageName} ${metadata.version} (${metadata.versionCode}), ${metadata.apk.size} APK bytes. Nothing was published.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Publication dry run failed: ${error.message}`);
    process.exitCode = 1;
  }
}
