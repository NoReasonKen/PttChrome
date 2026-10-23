import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function inspectGitHooks(root, { env = process.env } = {}) {
  const repair = "Run yarn prepare in this checkout.";
  if (env.HUSKY === "0")
    return {
      ok: false,
      message: `HUSKY=0 disables commit checks. Unset it. ${repair}`,
    };
  try {
    const configured = execFileSync(
      "git",
      ["config", "--get", "core.hooksPath"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      },
    ).trim();
    if (path.resolve(root, configured) !== path.join(root, ".husky/_")) {
      return {
        ok: false,
        message: `Git is not using this checkout's Husky hooks. ${repair}`,
      };
    }
    for (const file of [
      ".husky/pre-commit",
      ".husky/_/pre-commit",
      ".husky/_/h",
    ]) {
      fs.accessSync(path.join(root, file), fs.constants.R_OK);
    }
    if (process.platform !== "win32")
      fs.accessSync(path.join(root, ".husky/_/pre-commit"), fs.constants.X_OK);
    return {
      ok: true,
      message: "Git pre-commit checks are enabled for this checkout.",
    };
  } catch {
    return {
      ok: false,
      message: `Git hooks are not installed completely. ${repair}`,
    };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = inspectGitHooks(process.cwd());
  console.log(result.message);
  process.exitCode = result.ok ? 0 : 2;
}
