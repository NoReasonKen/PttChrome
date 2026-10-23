import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { inspectGitHooks } from "../../scripts/check-git-hooks.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const temporary = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pttchrome-hooks-"));
  temporary.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  fs.mkdirSync(path.join(root, ".husky"));
  fs.copyFileSync(
    path.join(ROOT, ".husky/pre-commit"),
    path.join(root, ".husky/pre-commit"),
  );
  return root;
}

function install(root) {
  execFileSync(
    process.execPath,
    [path.join(ROOT, "node_modules/husky/bin.js")],
    { cwd: root },
  );
}

afterEach(() => {
  for (const root of temporary.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

test("reports an unconfigured checkout with an actionable setup command", () => {
  const result = inspectGitHooks(fixture(), { env: {} });
  expect(result.ok).toBe(false);
  expect(result.message).toContain("yarn prepare");
});

test("accepts installed hooks and rejects a deleted Husky runner", () => {
  const root = fixture();
  install(root);
  expect(inspectGitHooks(root, { env: {} }).ok).toBe(true);
  fs.rmSync(path.join(root, ".husky/_/h"));
  expect(inspectGitHooks(root, { env: {} }).ok).toBe(false);
});

test("reports disabled hooks even when wrappers exist", () => {
  const root = fixture();
  install(root);
  const result = inspectGitHooks(root, { env: { HUSKY: "0" } });
  expect(result.ok).toBe(false);
  expect(result.message).toContain("HUSKY=0");
});

test("the installed pre-commit hook blocks an actual commit with a NUL byte", () => {
  const root = fixture();
  install(root);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(
    path.join(ROOT, "scripts/edit-guard.mjs"),
    path.join(root, "scripts/edit-guard.mjs"),
  );
  fs.writeFileSync(
    path.join(root, "invalid.js"),
    'export const value = "\0";\n',
  );
  execFileSync("git", ["add", "invalid.js"], { cwd: root });
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=Hook Test",
      "-c",
      "user.email=hook@example.invalid",
      "commit",
      "-m",
      "Check hook enforcement",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        HUSKY: "1",
        XDG_CONFIG_HOME: path.join(root, "config"),
      },
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toMatch(/NUL/);
});
