import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertChecks, receiptPath, snapshot, validate, verifyReceipt } from "../../scripts/verify-commit.mjs";

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
