import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const instruction = "Stage the intended changes, then run yarn verify:commit --check build before committing.";
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const floatingToolSources = new Set([
  "index.html", "src/css/main.css", "src/js/stack_layer.js", "src/js/term_ui.js",
  "src/js/term_view.js", "src/render/screen.js", "src/render/merge_buttons.js",
]);
const floatingToolSpecs = [
  { project: "offline", spec: "tests/e2e/offline/debug_record.offline.spec.js" },
  { project: "offline", spec: "tests/e2e/offline/lights_on.offline.spec.js" },
  { project: "offline-mobile", spec: "tests/e2e/offline/mobile_debug_home.offline.spec.js" },
  { project: "offline-mobile", spec: "tests/e2e/offline/mobile_float_tools.offline.spec.js" },
];

export function assertOfflineSpecs(root, selections) {
  if (!Array.isArray(selections)) throw new Error("Offline specs must be a list of project/spec selections.");
  for (const selection of selections) {
    const { project, spec } = selection || {};
    if (!["offline", "offline-mobile", "offline-firefox"].includes(project) ||
        typeof spec !== "string" || !/^tests\/e2e\/offline\/[a-zA-Z0-9_./-]+\.offline\.spec\.js$/.test(spec) ||
        spec.split("/").some(part => part === "." || part === "..")) {
      throw new Error("Select an ordinary offline project and an exact tests/e2e/offline/*.offline.spec.js file.");
    }
    const mobile = path.posix.basename(spec).startsWith("mobile_");
    if ((project === "offline-mobile") !== mobile ||
        (project === "offline-firefox" && spec !== "tests/e2e/offline/selection.offline.spec.js")) {
      throw new Error(`Offline project ${project} does not select ${spec}.`);
    }
    let actual;
    try { actual = fs.realpathSync(path.join(root, spec)); }
    catch { throw new Error(`Offline spec does not exist: ${spec}.`); }
    const relative = path.relative(path.join(fs.realpathSync(root), "tests", "e2e", "offline"), actual);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(actual).isFile()) {
      throw new Error(`Offline spec escapes tests/e2e/offline: ${spec}.`);
    }
  }
}

export function requiredOfflineSpecs(root) {
  const changed = git(root, "diff", "--cached", "--name-only", "-z").split("\0");
  return changed.some(file => floatingToolSources.has(file)) ? floatingToolSpecs.map(selection => ({ ...selection })) : [];
}

export function selectOfflineSpecs(root, requested = []) {
  assertOfflineSpecs(root, requested);
  const selected = [...requiredOfflineSpecs(root), ...requested];
  assertOfflineSpecs(root, selected);
  return [...new Map(selected.map(selection => [`${selection.project}:${selection.spec}`, selection])).values()];
}

export function parseOptions(args) {
  const checks = [];
  const offlineSpecs = [];
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1];
    if (!value) throw new Error("Use --check <package-script> or --offline-spec <project>:<spec>.");
    if (args[index] === "--check") checks.push(value);
    else if (args[index] === "--offline-spec") {
      const match = /^([^:]+):(.+)$/.exec(value);
      if (!match) throw new Error("Use --offline-spec <project>:<spec>.");
      offlineSpecs.push({ project: match[1], spec: match[2] });
    } else throw new Error("Use --check <package-script> or --offline-spec <project>:<spec>.");
  }
  return { checks, offlineSpecs };
}

export function snapshot(root) {
  if (git(root, "diff", "--name-only") || git(root, "ls-files", "--others", "--exclude-standard")) {
    throw new Error(`Unstaged or untracked project files would make the tested content differ from the commit. ${instruction}`);
  }
  return { head: git(root, "rev-parse", "HEAD"), tree: git(root, "write-tree") };
}

export function receiptPath(root) {
  return path.join(git(root, "rev-parse", "--absolute-git-dir"), "verification", "commit.json");
}

export function assertChecks(root, checks) {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts || {};
  for (const check of checks) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(check) || !Object.hasOwn(scripts, check) ||
        !/^(?:build|check:[\w:-]+|test:[\w:-]+)$/.test(check) ||
        check === "test:unit" || /^test:e2e(?::(?:headed|ui|live))?$/.test(check)) {
      throw new Error(`Unsupported additional check: ${check}. Select a build/check/non-live test script; live tests and recordings require their separate owner-authorized flow.`);
    }
  }
}

export function verifyReceipt(root) {
  const current = snapshot(root);
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath(root), "utf8")); }
  catch { throw new Error(`No successful validation receipt. ${instruction}`); }
  if (receipt.schemaVersion !== 1 || receipt.unitPassed !== true ||
      receipt.head !== current.head || receipt.tree !== current.tree ||
      !Array.isArray(receipt.checks) || !Number.isFinite(Date.parse(receipt.completedAt))) {
    throw new Error(`Validation receipt is stale or invalid. ${instruction}`);
  }
  assertChecks(root, receipt.checks);
  const offlineSpecs = receipt.offlineSpecs === undefined ? [] : receipt.offlineSpecs;
  assertOfflineSpecs(root, offlineSpecs);
  const completed = new Set(offlineSpecs.map(selection => `${selection.project}:${selection.spec}`));
  if (requiredOfflineSpecs(root).some(selection => !completed.has(`${selection.project}:${selection.spec}`))) {
    throw new Error(`Validation receipt lacks required shared-tool offline coverage. ${instruction}`);
  }
  return receipt;
}

export function runOfflineSpec(root, selection, spawn = spawnSync, environment = process.env) {
  assertOfflineSpecs(root, [selection]);
  const env = { ...environment, PTT_E2E_FRESH_SERVER: "1" };
  // Only the real shared queue authorizes a linked checkout to use port 8080.
  if (queueScript(root) && env.WHEN_IDLE_HELD === "1") env.ALLOW_WORKTREE_E2E = "1";
  const invoke = args => {
    const result = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Offline validation command failed (exit ${result.status ?? "unknown"}).`);
  };
  const cleanup = () => invoke([path.join(root, "scripts", "kill-dev-server.js"), "--own"]);
  // Playwright treats positional file filters as regexes, so escape the exact path.
  const file = path.resolve(root, selection.spec).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  cleanup();
  try {
    invoke([path.join(root, "node_modules", "@playwright", "test", "cli.js"),
      "test", `^${file}$`, `--project=${selection.project}`, "--retries=0"]);
  } finally { cleanup(); }
}

function execute(root, args) {
  if (args[0] === "offline-spec") return runOfflineSpec(root, { project: args[1], spec: args[2] });
  const result = spawnSync("yarn", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`yarn ${args.join(" ")} failed; no validation receipt was saved.`);
}

export function validate(root, checks, run = args => execute(root, args), options = {}) {
  assertChecks(root, checks);
  const offlineSpecs = selectOfflineSpecs(root, options.offlineSpecs);
  snapshot(root);
  const destination = receiptPath(root);
  fs.rmSync(destination, { force: true });
  run(["lint-staged"]);
  const before = snapshot(root);
  if (offlineSpecs.length) console.log(`Offline specs: ${offlineSpecs.map(selection => `${selection.project}:${selection.spec}`).join(", ")}`);
  run(["test:unit"]);
  for (const check of checks) run([check]);
  for (const selection of offlineSpecs) run(["offline-spec", selection.project, selection.spec]);
  const after = snapshot(root);
  if (before.head !== after.head || before.tree !== after.tree) {
    throw new Error(`Content changed during validation; no receipt was saved. ${instruction}`);
  }
  const receipt = { schemaVersion: 1, ...after, unitPassed: true, checks, offlineSpecs, completedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2) + "\n");
  fs.renameSync(temporary, destination);
  return receipt;
}

export function queueScript(root) {
  const primary = git(root, "worktree", "list", "--porcelain").split("\n").find(line => line.startsWith("worktree "))?.slice(9);
  const candidate = primary && path.join(primary, "scripts", "when-idle.local.sh");
  return candidate && fs.existsSync(candidate) ? candidate : null;
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  const verifyOnly = args.length === 1 && args[0] === "--verify-only";
  const options = verifyOnly ? {} : parseOptions(args);
  const checks = options.checks || [];
  if (!verifyOnly) {
    assertChecks(root, checks);
    assertOfflineSpecs(root, options.offlineSpecs);
    const queue = process.platform !== "win32" && queueScript(root);
    if (queue && process.env.WHEN_IDLE_HELD !== "1") {
      const result = spawnSync("bash", [queue, process.execPath, path.resolve(process.argv[1]), ...args], {
        cwd: root, env: { ...process.env, WAIT: process.env.WAIT || "1800" }, stdio: "inherit",
      });
      if (result.error) throw result.error;
      return result.status ?? 1;
    }
  }
  const receipt = verifyOnly ? verifyReceipt(root) : validate(root, checks, undefined, options);
  console.log(`Validation ${verifyOnly ? "receipt accepted" : "completed"} for staged tree ${receipt.tree.slice(0, 12)}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
