// Readiness checks only: never start the application or change a connected device.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkLocalDeps, installTargets } from "./check-remote-commits.mjs";
import { inspectGitHooks } from "./check-git-hooks.mjs";

const require = createRequire(import.meta.url);
const { sdkTool } = require("../tests/e2e/android/android_env.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WSL = process.platform === "linux" && /microsoft/i.test(os.release());

export function parseOptions(argv) {
  const options = { browser: false, android: false, web: false, device: false };
  for (const arg of argv) {
    const key = arg.replace(/^--/, "");
    if (!arg.startsWith("--") || !Object.hasOwn(options, key))
      throw new Error(`Unknown option: ${arg}`);
    options[key] = true;
  }
  if (options.device) options.android = true;
  return options;
}

export function runCommand(command, args) {
  // Only this fixed command needs cmd.exe; caller-provided executable paths never use a shell.
  const windowsYarn = process.platform === "win32" && command === "yarn";
  const result = spawnSync(
    windowsYarn ? process.env.ComSpec || "cmd.exe" : command,
    windowsYarn ? ["/d", "/s", "/c", "yarn --version"] : args,
    { encoding: "utf8", timeout: 10000, windowsHide: true, shell: false },
  );
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout || "",
    message:
      result.error?.message || result.stderr?.trim() || `exit ${result.status}`,
  };
}

function browserFailure(error) {
  const lines = String(error.message || error).split(/\r?\n/);
  const actionable = lines.find((line) =>
    /error while loading shared libraries|Executable doesn't exist|Host system is missing dependencies|ENOENT|spawn UNKNOWN/.test(
      line,
    ),
  );
  return (
    actionable ||
    lines.find((line) => line.trim()) ||
    "Browser launch failed."
  )
    .trim()
    .slice(0, 500);
}

export async function checkBrowser(name, playwright) {
  let browser;
  let result;
  try {
    const options = { headless: true, timeout: 10000 };
    if (name === "firefox") {
      options.env = { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" };
      options.firefoxUserPrefs = {
        "network.http.fast-fallback-to-IPv4": false,
      };
    }
    browser = await playwright[name].launch(options);
    const page = await browser.newPage();
    await page.setContent('<p id="doctor">doctor-ready</p>', {
      timeout: 10000,
    });
    if (
      (await page.textContent("#doctor", { timeout: 10000 })) !== "doctor-ready"
    )
      throw new Error("Inline page content was not rendered.");
    result = {
      ok: true,
      message: `${name} launches and renders inline content.`,
    };
  } catch (error) {
    result = {
      ok: false,
      message: `${name}: ${browserFailure(error)} Check docs/local-env-troubleshooting.md; missing browser binaries need yarn playwright install ${name}, and missing system libraries need yarn playwright install-deps ${name}.`,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        result = {
          ok: false,
          message: `${name} could not close: ${browserFailure(error)}`,
        };
      }
    }
  }
  return result;
}

export function findAdb({
  env = process.env,
  wsl = IS_WSL,
  sdkAdb = sdkTool("adb", env),
  run = runCommand,
} = {}) {
  const candidates = env.ADB
    ? [env.ADB]
    : [
        ...new Set(
          [sdkAdb, "adb", ...(wsl ? ["adb.exe"] : [])].filter(Boolean),
        ),
      ];
  for (const command of candidates) {
    const result = run(command, ["version"]);
    if (result.ok && /Android Debug Bridge version/.test(result.stdout))
      return {
        ok: true,
        command,
        message: result.stdout.trim().split(/\r?\n/)[0],
      };
  }
  return {
    ok: false,
    message:
      "ADB is unavailable. Install Android Platform Tools and add adb to PATH, or set ADB to its executable path (adb.exe in WSL). Check an explicit ADB override before retrying.",
  };
}

export function deviceSummary(text) {
  const states = String(text)
    .split(/\r?\n/)
    .map((line) => /^\S+\s+(device|unauthorized|offline)\b/.exec(line)?.[1])
    .filter(Boolean);
  const counts = ["device", "unauthorized", "offline"]
    .map(
      (state) =>
        `${state}: ${states.filter((value) => value === state).length}`,
    )
    .join(", ");
  const ready = states.includes("device");
  const hint = states.includes("unauthorized")
    ? " Allow USB debugging on the phone."
    : " Connect and authorize a phone or start your emulator separately.";
  return {
    ok: ready,
    message: `${counts}.${ready ? " No device was selected or changed." : hint}`,
  };
}

export async function checkWeb({
  origin = "http://127.0.0.1:8080",
  wsl = IS_WSL,
  run = runCommand,
  fetcher = fetch,
} = {}) {
  const url = `${origin}/@vite/client`;
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok || !(await response.text()).includes("createHotContext"))
      throw new Error("Port does not serve the Vite client.");
    if (wsl) {
      const windows = run("curl.exe", [
        "--silent",
        "--show-error",
        "--fail",
        "--max-time",
        "5",
        "--noproxy",
        "*",
        url,
      ]);
      if (!windows.ok || !windows.stdout.includes("createHotContext"))
        return {
          ok: false,
          message:
            "Windows cannot reach the Vite client on IPv4 localhost. Check Windows/WSL localhost forwarding and run yarn start --host separately.",
        };
    }
    return {
      ok: true,
      message: `Vite responds on IPv4 localhost${wsl ? " from WSL and Windows" : ""}. Phone connectivity is not verified.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `${error.message} Start yarn start --host separately, then retry --web.`,
    };
  }
}

export async function runDoctor(
  root,
  options,
  {
    nodeVersion = process.versions.node,
    run = runCommand,
    hooks = inspectGitHooks,
    browserCheck = checkBrowser,
    webCheck = checkWeb,
    env = process.env,
  } = {},
) {
  const checks = [];
  const add = (name, result) =>
    checks.push({
      name,
      status: result.ok ? "PASS" : "FAIL",
      message: result.message,
    });
  const skip = (name, flag) =>
    checks.push({ name, status: "SKIP", message: `Enable with ${flag}.` });
  const [nodeMajor, nodeMinor] = nodeVersion.split(".").map(Number);
  add("Node", {
    ok:
      (nodeMajor === 22 && nodeMinor >= 12) ||
      nodeMajor === 24 ||
      nodeMajor >= 26,
    message: `Node ${nodeVersion}; this toolchain requires 22.12+ within Node 22, Node 24, or Node 26+ (24 recommended).`,
  });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const expectedYarn = /^yarn@([^+]+)/.exec(manifest.packageManager || "")?.[1];
  const yarn = run("yarn", ["--version"]);
  add("Yarn", {
    ok: yarn.ok && !!expectedYarn && yarn.stdout.trim() === expectedYarn,
    message: yarn.ok
      ? `Yarn ${yarn.stdout.trim()}; expected ${expectedYarn || "a pinned packageManager"}. Run corepack enable if they differ.`
      : `${yarn.message}. Run corepack enable.`,
  });
  const local = checkLocalDeps(root);
  add("Dependencies", {
    ok: !local.yarnInstall,
    message: local.yarnInstall
      ? "Dependencies are missing or older than yarn.lock. Run yarn install --immutable."
      : "Installed dependencies are current with yarn.lock.",
  });
  add("Git hooks", hooks(root, { env }));

  if (options.browser) {
    if (local.yarnInstall)
      add("Browsers", {
        ok: false,
        message: "Update dependencies before checking browsers.",
      });
    else {
      if (local.missingBrowsers.length)
        add("Browser downloads", {
          ok: false,
          message: `Missing ${local.missingBrowsers.join(", ")}. Run yarn playwright install ${installTargets(local.missingBrowsers).join(" ")}.`,
        });
      try {
        const playwright = createRequire(path.join(root, "package.json"))(
          "playwright",
        );
        for (const name of ["chromium", "firefox"])
          add(name, await browserCheck(name, playwright));
      } catch (error) {
        add("Browsers", {
          ok: false,
          message: `${error.message}. Run yarn install --immutable.`,
        });
      }
    }
  } else skip("Browsers", "--browser");

  if (options.android) {
    const adb = findAdb({ env, run });
    add("ADB", adb);
    if (options.device) {
      if (!adb.ok)
        add("Devices", {
          ok: false,
          message: "ADB is required to list devices.",
        });
      else {
        const devices = run(adb.command, ["devices"]);
        add(
          "Devices",
          devices.ok
            ? deviceSummary(devices.stdout)
            : { ok: false, message: devices.message },
        );
      }
    } else skip("Devices", "--device");
  } else {
    skip("ADB", "--android");
    skip("Devices", "--device");
  }
  if (options.web) add("Web", await webCheck({ run }));
  else skip("Web", "--web");
  return {
    code: checks.some((check) => check.status === "FAIL") ? 2 : 0,
    checks,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const result = await runDoctor(ROOT, parseOptions(process.argv.slice(2)));
    for (const check of result.checks)
      console.log(`[${check.status}] ${check.name}: ${check.message}`);
    process.exitCode = result.code;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
