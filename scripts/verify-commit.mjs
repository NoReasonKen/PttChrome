import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const instruction = "Stage the intended changes, then run yarn verify:commit --check build before committing.";
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

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
  return receipt;
}

function execute(root, args) {
  const result = spawnSync("yarn", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`yarn ${args.join(" ")} failed; no validation receipt was saved.`);
}

export function validate(root, checks, run = args => execute(root, args)) {
  assertChecks(root, checks);
  snapshot(root);
  const destination = receiptPath(root);
  fs.rmSync(destination, { force: true });
  run(["lint-staged"]);
  const before = snapshot(root);
  run(["test:unit"]);
  for (const check of checks) run([check]);
  const after = snapshot(root);
  if (before.head !== after.head || before.tree !== after.tree) {
    throw new Error(`Content changed during validation; no receipt was saved. ${instruction}`);
  }
  const receipt = { schemaVersion: 1, ...after, unitPassed: true, checks, completedAt: new Date().toISOString() };
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
  const checks = [];
  if (!verifyOnly) {
    for (let index = 0; index < args.length; index += 2) {
      if (args[index] !== "--check" || !args[index + 1]) throw new Error("Use --check <package-script>, or --verify-only for the commit hook.");
      checks.push(args[index + 1]);
    }
    assertChecks(root, checks);
    const queue = process.platform !== "win32" && queueScript(root);
    if (queue && process.env.WHEN_IDLE_HELD !== "1") {
      const result = spawnSync("bash", [queue, process.execPath, path.resolve(process.argv[1]), ...args], {
        cwd: root, env: { ...process.env, WAIT: process.env.WAIT || "1800" }, stdio: "inherit",
      });
      if (result.error) throw result.error;
      return result.status ?? 1;
    }
  }
  const receipt = verifyOnly ? verifyReceipt(root) : validate(root, checks);
  console.log(`Validation ${verifyOnly ? "receipt accepted" : "completed"} for staged tree ${receipt.tree.slice(0, 12)}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
