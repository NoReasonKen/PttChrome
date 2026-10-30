import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPOSITORY = "https://github.com/NoReasonKen/PttChrome";
export const PACKAGE_NAME = "io.github.noreasonken.pttchrome";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateReleaseRecord(record) {
  requireValue(record?.schemaVersion === 1, "Unsupported release record schema");
  requireValue(VERSION.test(record.version), "A stable release version is required");
  requireValue(record.tag === `android-fork-v${record.version}`, "Release tag does not match its version");
  requireValue(record.sourceCommit == null || SHA.test(record.sourceCommit), "Invalid source commit");
  requireValue(record.versionCode == null || Number.isSafeInteger(record.versionCode) && record.versionCode > 0, "Invalid version code");
  requireValue(record.publishedAt === null || typeof record.publishedAt === "string" && Number.isFinite(Date.parse(record.publishedAt)), "Publication date must be confirmed or null");
  requireValue(!record.publishedAt || SHA.test(record.sourceCommit) && Number.isSafeInteger(record.versionCode) && record.versionCode > 0, "Published records require actual source and version code");
  requireValue(typeof record.nativeChanged === "boolean", "Native-change classification is required");
  for (const language of ["zhTW", "en"]) {
    const summary = record.summary?.[language];
    requireValue(Array.isArray(summary) && summary.length > 0 && summary.every(item => typeof item === "string" && item.trim()), `Missing ${language} release summary`);
  }
  requireValue(Array.isArray(record.commits) && record.commits.every(commit => SHA.test(commit.sha) && typeof commit.subject === "string" && commit.subject.trim()), "Invalid commit details");
  requireValue(new Set(record.commits.map(commit => commit.sha)).size === record.commits.length, "Duplicate release commits");
  const previous = record.previousRelease;
  requireValue(previous === null || previous && VERSION.test(previous.version) && previous.version !== record.version && (previous.sourceCommit == null || SHA.test(previous.sourceCommit)), "Invalid previous release");
  return record;
}

function nativeBaseline(record, records, previousMetadata, currentCode, seen = new Set()) {
  requireValue(!seen.has(record.version), "Cyclic release history");
  seen.add(record.version);
  if (record.nativeChanged) {
    const code = currentCode ?? record.versionCode;
    requireValue(Number.isSafeInteger(code) && code > 0, "Native baseline version code is unavailable");
    return code;
  }
  const previous = records.find(item => item.version === record.previousRelease?.version);
  requireValue(previous, "Previous official release record is missing");
  if (previousMetadata) {
    requireValue(previousMetadata.schemaVersion === 1 && previousMetadata.version === previous.version && previousMetadata.tag === previous.tag && previousMetadata.packageName === PACKAGE_NAME, "Previous metadata identity mismatch");
    const expectedSource = record.previousRelease.sourceCommit ?? previous.sourceCommit;
    requireValue(SHA.test(previousMetadata.sourceCommit) && (!expectedSource || expectedSource === previousMetadata.sourceCommit), "Previous metadata source mismatch");
    requireValue(Number.isSafeInteger(previousMetadata.versionCode) && previousMetadata.versionCode > 0 && (previous.versionCode == null || previous.versionCode === previousMetadata.versionCode), "Previous metadata version mismatch");
    requireValue(Number.isSafeInteger(previousMetadata.nativeVersionCode) && previousMetadata.nativeVersionCode > 0 && previousMetadata.nativeVersionCode <= previousMetadata.versionCode, "Invalid previous native baseline");
    requireValue(!previous.nativeChanged || previousMetadata.nativeVersionCode === previousMetadata.versionCode, "Previous native classification disagrees with its metadata");
    return previousMetadata.nativeVersionCode;
  }
  return nativeBaseline(previous, records, null, undefined, seen);
}

export function createUpdateMetadata(record, records, { versionCode, sourceCommit, apkBytes, previousMetadata = null, minSdk = 26, packageName = PACKAGE_NAME }) {
  records.forEach(validateReleaseRecord);
  validateReleaseRecord(record);
  requireValue(SHA.test(sourceCommit), "The actual release source commit is required");
  requireValue(!record.sourceCommit || record.sourceCommit === sourceCommit, "Release source does not match its record");
  requireValue(Number.isSafeInteger(versionCode) && versionCode > 0 && (record.versionCode == null || record.versionCode === versionCode), "APK version code does not match the release");
  requireValue(apkBytes?.length > 0, "The complete APK is required");
  requireValue(packageName === PACKAGE_NAME, "APK package does not match this fork");
  requireValue(Number.isSafeInteger(minSdk) && minSdk >= 26, "Invalid Android compatibility requirement");
  const previous = records.find(item => item.version === record.previousRelease?.version);
  const previousCode = previousMetadata?.versionCode ?? previous?.versionCode;
  requireValue(previousCode == null || versionCode > previousCode, "APK version code must increase");
  const nativeVersionCode = nativeBaseline(record, records, previousMetadata, versionCode);
  requireValue(nativeVersionCode <= versionCode, "Native baseline is newer than the APK");
  return {
    schemaVersion: 1,
    version: record.version,
    tag: record.tag,
    sourceCommit,
    versionCode,
    packageName,
    minSdk,
    nativeVersionCode,
    apk: {
      url: `${REPOSITORY}/releases/download/${record.tag}/pttchrome.apk`,
      sha256: createHash("sha256").update(apkBytes).digest("hex"),
      size: apkBytes.length,
    },
    summary: record.summary,
  };
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function collectReleaseCommits(record, { cwd = ROOT, sourceCommit, previousSourceCommit } = {}) {
  requireValue(SHA.test(sourceCommit), "Actual release source commit is required");
  const declaredPrevious = record.previousRelease?.sourceCommit;
  requireValue(!declaredPrevious || !previousSourceCommit || declaredPrevious === previousSourceCommit, "Previous release source mismatch");
  const baseline = previousSourceCommit ?? declaredPrevious ?? record.baselineCommit;
  requireValue(SHA.test(baseline), "An official predecessor or first-release baseline is required");
  git(cwd, "merge-base", "--is-ancestor", baseline, sourceCommit);
  const log = git(cwd, "log", "--reverse", "--topo-order", "--no-merges", "--format=%H%x00%s", `${baseline}..${sourceCommit}`);
  if (!log) return [];
  return log.split("\n").map(line => {
    const [sha, subject] = line.split("\0");
    return { sha, subject };
  }).filter(({ sha }) => {
    const changed = git(cwd, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha).split("\n").filter(Boolean);
    const notesOnly = changed.length > 0 && changed.every(file => /^releases\/[^/]+\.(?:json|md)$/.test(file) || /^docs\/release[^/]*\.md$/.test(file));
    return !notesOnly;
  });
}

export function validateReleaseHistory(record, options) {
  validateReleaseRecord(record);
  const actual = collectReleaseCommits(record, options);
  requireValue(JSON.stringify(actual) === JSON.stringify(record.commits), "Tracked release commits do not match the official release range");
}

export function parseApkBadging(text) {
  const packageLine = text.split("\n").find(line => line.startsWith("package:")) ?? "";
  const field = name => new RegExp(`(?:^|\\s)${name}='([^']*)'`).exec(packageLine)?.[1];
  const result = {
    packageName: field("name"),
    versionCode: Number(field("versionCode")),
    version: field("versionName"),
    minSdk: Number(/^(?:minSdkVersion|sdkVersion):'(\d+)'$/m.exec(text)?.[1]),
  };
  requireValue(result.packageName === PACKAGE_NAME && VERSION.test(result.version) && Number.isSafeInteger(result.versionCode) && result.versionCode > 0 && Number.isSafeInteger(result.minSdk) && result.minSdk >= 26, "APK manifest identity or compatibility is invalid");
  return result;
}

export function prepareUpdateArtifacts(record, records, { apkBytes, badging, sourceCommit, versionCode, notes, previousMetadata = null }) {
  validateReleaseRecord(record);
  requireValue(notes === renderReleaseNotes(record), "Tracked release detail is out of date; regenerate and review it before publication");
  const manifest = parseApkBadging(badging);
  requireValue(manifest.version === record.version && manifest.versionCode === versionCode, "Built APK version does not match this release");
  return {
    notes,
    metadata: createUpdateMetadata(record, records, { ...manifest, previousMetadata, sourceCommit, apkBytes }),
  };
}

export function writeUpdateArtifacts(directory, { metadata, notes }) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "release-notes.md"), notes);
  fs.writeFileSync(path.join(directory, "update.json"), JSON.stringify(metadata, null, 2) + "\n");
}

export function loadReleaseRecords(directory = path.join(ROOT, "releases")) {
  const records = fs.readdirSync(directory).filter(file => /^\d+\.\d+\.\d+\.json$/.test(file)).map(file => validateReleaseRecord(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"))));
  requireValue(new Set(records.map(record => record.version)).size === records.length, "Duplicate release versions");
  return records;
}

export function synchronizePublication(record, official, metadata, sourceCommit) {
  validateReleaseRecord(record);
  requireValue(official?.tag === record.tag && official.draft === false && official.prerelease === false && typeof official.publishedAt === "string" && Number.isFinite(Date.parse(official.publishedAt)), "A published stable release is required");
  requireValue(SHA.test(sourceCommit) && (!record.sourceCommit || record.sourceCommit === sourceCommit), "Publication source does not match its tag");
  let versionCode = record.versionCode;
  if (metadata) {
    requireValue(metadata.schemaVersion === 1 && metadata.tag === record.tag && metadata.version === record.version && metadata.packageName === PACKAGE_NAME && metadata.sourceCommit === sourceCommit, "Published metadata identity mismatch");
    requireValue(Number.isSafeInteger(metadata.versionCode) && metadata.versionCode > 0 && (versionCode == null || versionCode === metadata.versionCode), "Published metadata version mismatch");
    versionCode = metadata.versionCode;
  } else {
    requireValue(record.sourceCommit && Number.isSafeInteger(versionCode) && versionCode > 0, "Published APK metadata is required for a new release");
  }
  return validateReleaseRecord({ ...record, sourceCommit, versionCode, publishedAt: official.publishedAt });
}

function githubHeaders() {
  const headers = { Accept: "application/vnd.github+json" };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function syncPublication(record) {
  const response = await fetch(`https://api.github.com/repos/NoReasonKen/PttChrome/releases/tags/${record.tag}`, { headers: githubHeaders(), signal: AbortSignal.timeout(30000) });
  requireValue(response.ok, `Cannot verify publication (HTTP ${response.status})`);
  const item = await response.json();
  const official = { tag: item.tag_name, draft: item.draft, prerelease: item.prerelease, publishedAt: item.published_at };
  const sourceCommit = git(ROOT, "rev-parse", "--verify", `${record.tag}^{commit}`);
  const metadataResponse = await fetch(`${REPOSITORY}/releases/download/${record.tag}/update.json`, { signal: AbortSignal.timeout(30000) });
  requireValue(metadataResponse.ok || metadataResponse.status === 404, `Cannot verify published metadata (HTTP ${metadataResponse.status})`);
  const metadata = metadataResponse.ok ? await metadataResponse.json() : null;
  const updated = synchronizePublication(record, official, metadata, sourceCommit);
  fs.writeFileSync(path.join(ROOT, "releases", `${record.version}.json`), JSON.stringify(updated, null, 2) + "\n");
}

async function officialPredecessor(record, records, cwd) {
  const response = await fetch("https://api.github.com/repos/NoReasonKen/PttChrome/releases?per_page=100", { headers: githubHeaders(), signal: AbortSignal.timeout(30000) });
  requireValue(response.ok, `Cannot verify official releases (HTTP ${response.status})`);
  const releases = await response.json();
  const prior = releases.filter(item => !item.draft && !item.prerelease && item.tag_name !== record.tag && item.published_at).sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
  if (!record.previousRelease) {
    requireValue(!prior, "First-release record cannot omit an existing official predecessor");
    return {};
  }
  requireValue(prior?.tag_name === `android-fork-v${record.previousRelease.version}`, "The record does not identify the preceding official release");
  const previous = records.find(item => item.version === record.previousRelease.version);
  requireValue(previous, "Previous official release record is missing");
  const previousSourceCommit = git(cwd, "rev-parse", "--verify", `${previous.tag}^{commit}`);
  requireValue(!previous.sourceCommit || previous.sourceCommit === previousSourceCommit, "Previous tag source does not match its record");
  const metadataResponse = await fetch(`${REPOSITORY}/releases/download/${previous.tag}/update.json`, { signal: AbortSignal.timeout(30000) });
  if (metadataResponse.status === 404) {
    requireValue(previous.versionCode != null, "Previous release metadata is required");
    return { previousSourceCommit };
  }
  requireValue(metadataResponse.ok, `Cannot verify previous metadata (HTTP ${metadataResponse.status})`);
  const previousMetadata = await metadataResponse.json();
  requireValue(previousMetadata.sourceCommit === previousSourceCommit, "Previous metadata is not bound to its official tag");
  return { previousSourceCommit, previousMetadata };
}

async function main(args) {
  const [command, ...rest] = args;
  requireValue(["notes", "assets", "verify", "sync-publication"].includes(command), "Use notes, assets, verify or sync-publication");
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    requireValue(rest[index]?.startsWith("--") && rest[index + 1] && !rest[index + 1].startsWith("--"), "Expected --option value pairs");
    options[rest[index].slice(2)] = rest[index + 1];
  }
  const records = loadReleaseRecords();
  if (command === "verify") {
    for (const item of records) {
      if (options.version && item.version !== options.version) continue;
      const sourceCommit = item.sourceCommit ?? (options.source && git(ROOT, "rev-parse", "--verify", `${options.source}^{commit}`));
      validateReleaseHistory(item, { cwd: ROOT, sourceCommit });
      loadReleaseNotes(item);
    }
    console.log("Release records match their source history.");
    return;
  }
  const record = records.find(item => item.version === options.version);
  requireValue(record, "No tracked record for this release version");
  if (command === "sync-publication") {
    await syncPublication(record);
    return;
  }
  const notes = renderReleaseNotes(record);
  if (command === "notes") {
    fs.writeFileSync(options.output ?? path.join(ROOT, "releases", `${record.version}.md`), notes);
    return;
  }
  const trackedNotes = loadReleaseNotes(record);
  requireValue(options.source && options.apk && options.badging && options["output-dir"] && options["version-code"], "Assets require source, apk, badging, output-dir and version-code");
  const sourceCommit = git(ROOT, "rev-parse", "--verify", `${options.source}^{commit}`);
  const tagCommit = git(ROOT, "rev-parse", "--verify", `${record.tag}^{commit}`);
  requireValue(sourceCommit === tagCommit, "Release source does not match the actual tag");
  const predecessor = await officialPredecessor(record, records, ROOT);
  validateReleaseHistory(record, { cwd: ROOT, sourceCommit, previousSourceCommit: predecessor.previousSourceCommit });
  const artifacts = prepareUpdateArtifacts(record, records, {
    ...predecessor, sourceCommit,
    apkBytes: fs.readFileSync(options.apk),
    badging: fs.readFileSync(options.badging, "utf8"),
    versionCode: Number(options["version-code"]),
    notes: trackedNotes,
  });
  writeUpdateArtifacts(options["output-dir"], artifacts);
}

export function renderReleaseNotes(record) {
  validateReleaseRecord(record);
  const source = `${REPOSITORY}/tree/${record.tag}`;
  return [
    `PttChrome Fork Android ${record.version}`,
    "",
    "## Highlights",
    "",
    ...record.summary.en.map((item) => `- ${item}`),
    "",
    "## Changes",
    "",
    ...record.commits.map(({ sha, subject }) => `- [${sha.slice(0, 8)}](${REPOSITORY}/commit/${sha}) ${subject}`),
    "",
    "## Installation and source",
    "",
    "Download **pttchrome.apk** and install it over the existing PttChrome Fork app without uninstalling first. Reading-page improvements also reach existing installations using the production page.",
    "",
    `- [Installation guide](${REPOSITORY}/blob/${record.tag}/docs/android-app.md)`,
    `- [Complete corresponding source](${source})`,
    `- [Source archive](${REPOSITORY}/archive/refs/tags/${record.tag}.tar.gz)`,
    "- License: GPL-2.0-only. The license text is attached as **LICENSE**.",
    "",
  ].join("\n");
}

export function loadReleaseNotes(record, directory = path.join(ROOT, "releases")) {
  validateReleaseRecord(record);
  const notes = fs.readFileSync(path.join(directory, `${record.version}.md`), "utf8");
  requireValue(notes === renderReleaseNotes(record), "Tracked release detail is out of date; regenerate and review it before publication");
  return notes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Release preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
