// CI scopes share the ordinary Playwright projects, fixtures and worker policy.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const OFFLINE_E2E_GROUPS = {
  desktop: ["offline", "offline-firefox"],
  "mobile-ui": ["offline-mobile"],
  "mobile-stack": ["offline-mobile"],
};

export function offlineGroupForFile(file) {
  const name = file.replaceAll("\\", "/").replace(/^tests\/e2e\/offline\//, "");
  if (!name.endsWith(".spec.js")) return null;
  // Match the existing projects: only top-level mobile_* specs are mobile.
  if (name.includes("/")) return "desktop";
  if (name.startsWith("mobile_stack_")) return "mobile-stack";
  return name.startsWith("mobile_") ? "mobile-ui" : "desktop";
}

export function groupArguments(group, files) {
  const projects = OFFLINE_E2E_GROUPS[group];
  if (!projects) throw new Error(`Unknown offline group: ${group}`);
  const selected = files.filter((file) => offlineGroupForFile(file) === group);
  if (!selected.length) throw new Error(`Empty offline group: ${group}`);
  // File filters are regexes. Anchor the escaped paths so similarly named specs
  // cannot enter two scopes; accept both path separators for local Windows use.
  const escaped = selected.map((file) => file.split(/[\\/]/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\\\/]"));
  return [...projects.map((project) => `--project=${project}`), `(?:${escaped.join("|")})$`];
}

export function run(argv) {
  const groups = argv.filter((arg) => arg.startsWith("--group="));
  if (groups.length !== 1) throw new Error("Select exactly one --group=<name>.");
  const group = groups[0].slice("--group=".length);
  const dir = path.join(root, "tests/e2e/offline");
  const files = fs.readdirSync(dir, { recursive: true })
    .filter((file) => file.endsWith(".spec.js"))
    .map((file) => `tests/e2e/offline/${file}`).sort();
  const args = groupArguments(group, files);
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/playwright/cli.js"), "test", ...args,
    ...argv.filter((arg) => !arg.startsWith("--group=")),
  ], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
