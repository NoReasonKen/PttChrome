import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { assertChecks, assertOfflineSpecs, parseOptions, receiptPath, requiredOfflineSpecs,
  runOfflineSpec, selectOfflineSpecs, snapshot, validate, verifyReceipt } from "../../scripts/verify-commit.mjs";

const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "commit-validation-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Validation Test");
  git(root, "config", "user.email", "validation@example.invalid");
  const hooks = path.join(root, ".git", "empty-hooks");
  fs.mkdirSync(hooks);
  git(root, "config", "core.hooksPath", hooks);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "example", "test:unit": "example", "test:e2e": "example", "test:e2e:offline": "example", "record:scenarios": "example" } }));
  fs.writeFileSync(path.join(root, "source.txt"), "initial\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Initial fixture");
  fs.writeFileSync(path.join(root, "source.txt"), "changed\n");
  git(root, "add", "source.txt");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function addFixture(file) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), "fixture\n");
  git(root, "add", file);
  return file;
}

const lights = { project: "offline", spec: "tests/e2e/offline/lights_on.offline.spec.js" };
function addToolFixtures() {
  for (const spec of ["debug_record", "lights_on", "mobile_debug_home", "mobile_float_tools"])
    addFixture(`tests/e2e/offline/${spec}.offline.spec.js`);
  addFixture("src/render/merge_buttons.js");
}

test("formats first and validates the formatted staged content before issuing a receipt", () => {
  const calls = [];
  const before = snapshot(root).tree;
  validate(root, ["build"], args => {
    calls.push(args);
    if (args[0] === "lint-staged") {
      fs.writeFileSync(path.join(root, "source.txt"), "formatted\n");
      git(root, "add", "source.txt");
    }
  });
  expect(calls).toEqual([["lint-staged"], ["test:unit"], ["build"]]);
  expect(verifyReceipt(root).tree).not.toBe(before);
  expect(git(root, "log", "--format=%s")).toBe("Initial fixture");
});

test("a failure removes any old receipt and never authorizes a commit", () => {
  validate(root, [], () => {});
  expect(() => validate(root, ["build"], args => {
    if (args[0] === "build") throw new Error("Build failed");
  })).toThrow("Build failed");
  expect(fs.existsSync(receiptPath(root))).toBe(false);
  expect(() => verifyReceipt(root)).toThrow("No successful validation receipt");
});

test("staged changes during validation invalidate the entire run", () => {
  expect(() => validate(root, [], args => {
    if (args[0] === "test:unit") {
      fs.writeFileSync(path.join(root, "source.txt"), "edited during unit run\n");
      git(root, "add", "source.txt");
    }
  })).toThrow("Content changed during validation");
  expect(fs.existsSync(receiptPath(root))).toBe(false);
});

test.each(["staged", "unstaged", "untracked", "head"])("a %s change after validation prevents receipt reuse", kind => {
  validate(root, [], () => {});
  if (kind === "head") {
    git(root, "commit", "-qm", "Validated fixture commit");
  } else if (kind === "untracked") {
    fs.writeFileSync(path.join(root, "new.txt"), "untracked\n");
  } else {
    fs.writeFileSync(path.join(root, "source.txt"), "changed again\n");
    if (kind === "staged") git(root, "add", "source.txt");
  }
  expect(() => verifyReceipt(root)).toThrow(/stale|Unstaged or untracked/);
});

test("unstaged work is rejected before formatting without stashing or staging it", () => {
  fs.writeFileSync(path.join(root, "source.txt"), "unrelated unstaged edit\n");
  const run = vi.fn();
  expect(() => validate(root, [], run)).toThrow("Unstaged or untracked");
  expect(run).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(root, "source.txt"), "utf8")).toBe("unrelated unstaged edit\n");
});

test.each(["test:e2e", "record:scenarios", "build;echo", "unknown", "test:unit"])("additional check %s is rejected before execution", check => {
  expect(() => assertChecks(root, [check])).toThrow("Unsupported additional check");
});

test("receipts belong to the individual checkout's Git directory", () => {
  validate(root, [], () => {});
  expect(receiptPath(root)).toBe(path.join(root, ".git", "verification", "commit.json"));
  expect(verifyReceipt(root).unitPassed).toBe(true);
});

test("explicit offline selections run after unit/check coverage and are recorded exactly once", () => {
  addFixture(lights.spec);
  const calls = [];
  const options = parseOptions(["--check", "build", "--offline-spec", `${lights.project}:${lights.spec}`,
    "--offline-spec", `${lights.project}:${lights.spec}`]);
  validate(root, options.checks, args => calls.push(args), options);
  expect(calls).toEqual([["lint-staged"], ["test:unit"], ["build"], ["offline-spec", lights.project, lights.spec]]);
  expect(verifyReceipt(root).offlineSpecs).toEqual([lights]);
});

test("shared tools select desktop and mobile consumer regressions without selecting the whole suite", () => {
  addToolFixtures();
  expect(requiredOfflineSpecs(root)).toEqual([
    { project: "offline", spec: "tests/e2e/offline/debug_record.offline.spec.js" },
    lights,
    { project: "offline-mobile", spec: "tests/e2e/offline/mobile_debug_home.offline.spec.js" },
    { project: "offline-mobile", spec: "tests/e2e/offline/mobile_float_tools.offline.spec.js" },
  ]);
  const calls = [];
  validate(root, [], args => calls.push(args));
  expect(calls.filter(args => args[0] === "offline-spec")).toHaveLength(4);
  expect(verifyReceipt(root).offlineSpecs).toEqual(requiredOfflineSpecs(root));
  const receipt = JSON.parse(fs.readFileSync(receiptPath(root), "utf8"));
  receipt.offlineSpecs = [lights];
  fs.writeFileSync(receiptPath(root), JSON.stringify(receipt));
  expect(() => verifyReceipt(root)).toThrow("lacks required shared-tool offline coverage");
});

test("existing receipts without offline selections remain valid for unrelated changes", () => {
  validate(root, [], () => {});
  const receipt = JSON.parse(fs.readFileSync(receiptPath(root), "utf8"));
  delete receipt.offlineSpecs;
  fs.writeFileSync(receiptPath(root), JSON.stringify(receipt));
  expect(verifyReceipt(root).unitPassed).toBe(true);
  expect(requiredOfflineSpecs(root)).toEqual([]);
});

test.each([
  { project: "live", spec: lights.spec },
  { project: "offline-triage", spec: lights.spec },
  { project: "offline", spec: "tests/e2e/core.spec.js" },
  { project: "offline", spec: "tests/e2e/offline/../../../outside.offline.spec.js" },
  { project: "offline", spec: "tests/e2e/offline/*.offline.spec.js" },
  { project: "offline", spec: `${lights.spec};echo` },
  { project: "offline", spec: "--project=live" },
  { project: "offline-mobile", spec: lights.spec },
  { project: "offline-firefox", spec: lights.spec },
])("offline selection $project:$spec is rejected before any execution", selection => {
  addFixture(lights.spec);
  const run = vi.fn();
  expect(() => validate(root, [], run, { offlineSpecs: [selection] })).toThrow(/ordinary offline|does not select/);
  expect(run).not.toHaveBeenCalled();
});

test("a symlink cannot select a spec outside the offline directory", () => {
  fs.mkdirSync(path.join(root, "tests/e2e/offline"), { recursive: true });
  fs.symlinkSync(path.join(root, "source.txt"), path.join(root, lights.spec));
  expect(() => assertOfflineSpecs(root, [lights])).toThrow("escapes tests/e2e/offline");
});

test("a symlinked offline directory cannot make an external spec eligible", () => {
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "outside-offline-"));
  try {
    fs.writeFileSync(path.join(external, "lights_on.offline.spec.js"), "fixture\n");
    fs.mkdirSync(path.join(root, "tests/e2e"), { recursive: true });
    fs.symlinkSync(external, path.join(root, "tests/e2e/offline"), "junction");
    expect(() => assertOfflineSpecs(root, [lights])).toThrow("escapes tests/e2e/offline");
  } finally { fs.rmSync(external, { recursive: true, force: true }); }
});

test("missing files and malformed selection lists fail without running tests", () => {
  expect(() => assertOfflineSpecs(root, [lights])).toThrow("does not exist");
  expect(() => assertOfflineSpecs(root, null)).toThrow("must be a list");
  expect(() => parseOptions(["--offline-spec", "offline"])).toThrow("<project>:<spec>");
  expect(() => parseOptions(["--project", "live"])).toThrow("Use --check");
});

test("mobile and Firefox selections follow their actual project file contracts", () => {
  const mobile = { project: "offline-mobile", spec: addFixture("tests/e2e/offline/mobile_float_tools.offline.spec.js") };
  const firefox = { project: "offline-firefox", spec: addFixture("tests/e2e/offline/selection.offline.spec.js") };
  expect(selectOfflineSpecs(root, [mobile, firefox])).toEqual([mobile, firefox]);
  expect(() => assertOfflineSpecs(root, [{ ...mobile, project: "offline" }])).toThrow("does not select");
});

test("an offline failure invalidates the previous receipt", () => {
  addFixture(lights.spec);
  validate(root, [], () => {});
  expect(() => validate(root, [], args => {
    if (args[0] === "offline-spec") throw new Error("Offline failed");
  }, { offlineSpecs: [lights] })).toThrow("Offline failed");
  expect(fs.existsSync(receiptPath(root))).toBe(false);
});

test("the offline runner selects this checkout's CLI and cleans up on both success and failure", () => {
  addFixture(lights.spec);
  for (const exit of [0, 1]) {
    const spawn = vi.fn((_file, args) => ({ status: args.includes("test") ? exit : 0 }));
    if (exit) expect(() => runOfflineSpec(root, lights, spawn, {})).toThrow("Offline validation command failed");
    else runOfflineSpec(root, lights, spawn, {});
    const [before, testRun, after] = spawn.mock.calls;
    expect(before[1]).toEqual([path.join(root, "scripts", "kill-dev-server.js"), "--own"]);
    expect(after[1]).toEqual(before[1]);
    expect(testRun[0]).toBe(process.execPath);
    expect(testRun[1][0]).toBe(path.join(root, "node_modules", "@playwright", "test", "cli.js"));
    expect(new RegExp(testRun[1][2]).test(path.resolve(root, lights.spec))).toBe(true);
    expect(new RegExp(testRun[1][2]).test(path.resolve(root, lights.spec) + ".other")).toBe(false);
    expect(testRun[1]).toContain("--project=offline");
    expect(testRun[2].env.PTT_E2E_FRESH_SERVER).toBe("1");
    expect(testRun[2].env.ALLOW_WORKTREE_E2E).toBeUndefined();
  }
});

test("only the existing shared queue authorizes the runner's worktree override", () => {
  addFixture(lights.spec);
  const spawn = vi.fn(() => ({ status: 0 }));
  runOfflineSpec(root, lights, spawn, { CI: "true", WHEN_IDLE_HELD: "1" });
  expect(spawn.mock.calls[1][2].env.ALLOW_WORKTREE_E2E).toBeUndefined();
  addFixture("scripts/when-idle.local.sh");
  spawn.mockClear();
  runOfflineSpec(root, lights, spawn, { WHEN_IDLE_HELD: "1" });
  expect(spawn.mock.calls[1][2].env.ALLOW_WORKTREE_E2E).toBe("1");
});

test("commit validation requests a fresh server while ordinary Playwright use retains its default", () => {
  const require = createRequire(import.meta.url);
  const configPath = require.resolve("../../playwright.config.js");
  try {
    for (const [flag, expected] of [["1", false], ["0", true]]) {
      vi.stubEnv("VITEST", "true");
      vi.stubEnv("PTT_E2E_FRESH_SERVER", flag);
      delete require.cache[configPath];
      expect(require(configPath).webServer.reuseExistingServer).toBe(expected);
    }
  } finally {
    delete require.cache[configPath];
    vi.unstubAllEnvs();
  }
});
