// Android 模擬器 e2e 的執行器（`yarn test:e2e:android`）。設計見 docs/android-e2e.md。
//
//   1. （--if-changed[=<base>]）沒改到相關檔案 ⇒ 印「略過」exit 0（名單：android-e2e-needed.mjs）
//   2. 建 debug APK（`android/gradlew assembleDebug`，增量建置，沒改動只要幾秒）：apk spec
//      裝的是 android_env.apkPath 那份檔案，不重建就會拿舊 APK 測新 code。env ANDROID_E2E_APK
//      已指定（CI 自己 build 過）或 --no-build ⇒ 跳過。
//   3. 找模擬器：已經有一台在跑就用它；沒有就用 AVD `pttchrome_e2e`（原生 Pixel 6）開一台，
//      沒有 AVD 就建
//   4. playwright test --project=android，依 JSON 報告分類結論
//   5. When the run includes the APK group, install the built app and instrumented test APKs
//      and run `am instrument`. CI used Gradle's connectedDebugAndroidTest here, which rebuilt
//      and re-signed the app, failed to install it and still reported success.
//   6. 自己開的模擬器自己關（--keep-emulator 留著，下一輪省開機時間）
//
// exit code（刻意分三種，比照 scripts/run-adverse-e2e.mjs）：
//   0 全綠／略過｜1 有真失敗｜2 環境沒準備好、未取得有效結論（不可以當綠）
// --no-boot：只用已經在跑的模擬器（CI：emulator-runner 已經開好）。
// --no-build：不建 APK，直接用現有的那份（只在確定 android/ 沒改動、要省幾秒時用）。
// --group=<name>: run one ANDROID_E2E_GROUPS entry (CI runs each group on its own emulator).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { androidE2eNeeded } from "./android-e2e-needed.mjs";

const require = createRequire(import.meta.url);
const env = require("../tests/e2e/android/android_env.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules", "playwright", "cli.js");
const BOOT_TIMEOUT_MS = 300000;
// The raw `am instrument` output, uploaded with the CI failure artifacts.
const INSTRUMENTATION_RESULTS = path.join(ROOT, "android/app/build/outputs/androidTest-results/am-instrument");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 純函式（unit 守護：tests/unit/android_e2e.test.js）----

// CI splits the specs across parallel emulators. The APK group needs the debug APK and runs
// the instrumented tests; the Chrome group only drives the emulator's Chrome. Every
// *.android.spec.js belongs to exactly one group (tests/unit/android_e2e.test.js).
export const ANDROID_E2E_GROUPS = {
  apk: {
    apk: true,
    instrumented: true,
    specs: ["apk.android.spec.js", "app_updates.android.spec.js", "credentials.android.spec.js"],
  },
  chrome: {
    apk: false,
    instrumented: false,
    specs: [
      "list_card_blacklist.android.spec.js",
      "mobile_chrome.android.spec.js",
      "mobile_input.android.spec.js",
      "select_mode.android.spec.js",
    ],
  },
};

// What one run covers. Without a group it runs every spec, so it needs the APK and the
// instrumented tests too; spec paths go to playwright as file filters.
export function groupPlan(group) {
  if (!group) return { specs: [], apk: true, instrumented: true };
  const g = ANDROID_E2E_GROUPS[group];
  return { specs: g.specs.map((f) => `tests/e2e/android/${f}`), apk: g.apk, instrumented: g.instrumented };
}

export function parseArgs(argv) {
  const opts = { ifChanged: null, keepEmulator: false, boot: true, build: true, group: null, passthrough: [] };
  for (const arg of argv) {
    const m = /^--if-changed(?:=(.+))?$/.exec(arg);
    const g = /^--group=(.+)$/.exec(arg);
    if (m) opts.ifChanged = m[1] || "origin/dev";
    else if (g) {
      if (!ANDROID_E2E_GROUPS[g[1]]) {
        throw new Error(`[環境] unknown --group=${g[1]} (known: ${Object.keys(ANDROID_E2E_GROUPS).join(", ")})`);
      }
      opts.group = g[1];
    }
    else if (arg === "--keep-emulator") opts.keepEmulator = true;
    else if (arg === "--no-boot") opts.boot = false;
    else if (arg === "--no-build") opts.build = false;
    else opts.passthrough.push(arg);
  }
  return opts;
}

// 這輪要不要建 APK、怎麼建。null ＝ 不建。
// Windows 的 .bat 只能經 shell 執行：給**絕對路徑**（cmd.exe 不保證在 cwd 找執行檔，實測
// 'gradlew.bat' 不是內部或外部命令）、整條組成一個字串（args 陣列＋shell 會觸發 DEP0190）。
export function apkBuildPlan(opts, processEnv = process.env, platform = process.platform) {
  const plan = groupPlan(opts.group);
  if (!opts.build || !plan.apk || processEnv.ANDROID_E2E_APK) return null;
  const cwd = path.join(ROOT, "android");
  const tasks = plan.instrumented ? ["assembleDebug", "assembleDebugAndroidTest"] : ["assembleDebug"];
  if (platform === "win32") {
    return { cmd: `"${path.join(cwd, "gradlew.bat")}" ${tasks.join(" ")}`, args: [], cwd, shell: true };
  }
  return { cmd: path.join(cwd, "gradlew"), args: tasks, cwd, shell: false };
}

// playwright JSON 報告 → 'pass' | 'fail' | 'env'。
// 失敗的測試**全部**都是環境錯誤（ENV_ERROR_TAG）才算 env；混到任何一條真斷言紅就是 fail，
// 不能讓環境問題把真失敗蓋掉。沒有報告（playwright 本身起不來）＝ env。
export function classifyReport(report) {
  if (!report || !Array.isArray(report.suites)) return "env";
  const failed = [];
  const walk = (suite) => {
    for (const s of suite.suites || []) walk(s);
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        for (const r of t.results || []) {
          if (r.status === "failed" || r.status === "timedOut") failed.push(r);
        }
      }
    }
  };
  report.suites.forEach(walk);
  const errors = report.errors || [];
  if (!failed.length && !errors.length) return report.stats && report.stats.expected > 0 ? "pass" : "env";
  const isEnv = (e) => String((e && e.message) || "").includes(env.ENV_ERROR_TAG);
  const allEnv =
    failed.every((r) => (r.errors || [r.error]).some(isEnv)) && errors.every(isEnv);
  return allEnv ? "env" : "fail";
}

// `am instrument -w -r` output → { verdict, passed, failed }. Status codes come from
// AndroidJUnitRunner: 1 start, 0 pass, -1 error, -2 failure, -3 ignored, -4 assumption failure.
// A run with no passing test is never a pass: missing instrumentation, an empty test APK
// and a skipped-only run all leave no evidence ('env').
export function classifyInstrumentation(output) {
  const codes = [...String(output).matchAll(/^INSTRUMENTATION_STATUS_CODE: (-?\d+)/gm)].map((m) => Number(m[1]));
  const passed = codes.filter((c) => c === 0).length;
  const failed = codes.filter((c) => c === -1 || c === -2).length;
  const crashed = /^INSTRUMENTATION_RESULT: shortMsg=/m.test(output);
  const finished = /^INSTRUMENTATION_CODE: /m.test(output);
  let verdict = "pass";
  if (failed || crashed || /FAILURES!!!/.test(output)) verdict = "fail";
  else if (!finished || /^INSTRUMENTATION_FAILED/m.test(output) || !passed) verdict = "env";
  return { verdict, passed, failed };
}

// Several verdicts → one. A real failure must never hide behind an environment problem.
export function combineVerdicts(verdicts) {
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("env")) return "env";
  return "pass";
}

// ---- 環境 ----

function adb(args, opts = {}) {
  return spawnSync(env.sdkTool("adb"), args, { encoding: "utf8", ...opts });
}

function adbSerials() {
  const r = adb(["devices"]);
  if (r.error || r.status !== 0) return null;
  return env.parseAdbDevices(r.stdout);
}

function avdExists(emulator) {
  const r = spawnSync(emulator, ["-list-avds"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.split(/\r?\n/).includes(env.AVD_NAME);
}

function systemImageInstalled() {
  const dir = path.join(env.sdkRoot(), ...env.SYSTEM_IMAGE.split(";"));
  return fs.existsSync(dir);
}

// 一行版本資訊：Chrome／映像不同版時行為可能不同（GPU 當機、選取把手），CI 出事先對這行。
// host 端映像 revision 只代表 SDK 裝的那份；已在跑的模擬器以 fingerprint 為準。查不到印「?」，不擋測試。
function logDeviceInfo(serial) {
  const sh = (...args) => {
    const r = adb(["-s", serial, "shell", ...args]);
    return r.status === 0 ? r.stdout.trim() : "";
  };
  let revision = null;
  try {
    revision = env.parseImageRevision(
      fs.readFileSync(path.join(env.sdkRoot(), ...env.SYSTEM_IMAGE.split(";"), "source.properties"), "utf8")
    );
  } catch (e) {}
  const chrome = env.parseVersionName(sh("dumpsys", "package", "com.android.chrome"));
  console.log(
    `裝置：${serial}｜${sh("getprop", "ro.build.fingerprint") || "?"}｜` +
      `映像 ${env.SYSTEM_IMAGE} r${revision || "?"}｜Chrome ${chrome || "?"}`
  );
}

function createAvd() {
  const avdmanager = env.sdkTool("avdmanager");
  if (!avdmanager) return false;
  // .bat 會把 `;` 當參數分隔 ⇒ Windows 上整串要加引號，並走 shell（其他平台不能加，會變字面引號）
  const win = process.platform === "win32";
  const image = win ? `"${env.SYSTEM_IMAGE}"` : env.SYSTEM_IMAGE;
  const r = spawnSync(
    win ? `"${avdmanager}"` : avdmanager,
    ["create", "avd", "-n", env.AVD_NAME, "-k", image, "-d", env.AVD_DEVICE],
    { encoding: "utf8", input: "no\n", shell: win }
  );
  return r.status === 0;
}

async function bootEmulator(before) {
  const emulator = env.sdkTool("emulator");
  const child = spawn(
    emulator,
    ["-avd", env.AVD_NAME, "-no-snapshot", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect"],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let serial = null;
  while (Date.now() < deadline) {
    if (!serial) {
      const now = adbSerials() || [];
      serial = now.find((s) => /^emulator-\d+$/.test(s) && !before.includes(s)) || null;
    }
    if (serial) {
      const r = adb(["-s", serial, "shell", "getprop", "sys.boot_completed"]);
      if (r.status === 0 && r.stdout.trim() === "1") return serial;
    }
    await sleep(2000);
  }
  if (serial) adb(["-s", serial, "emu", "kill"]);
  return null;
}

function runPlaywright(serial, passthrough) {
  const reportFile = path.join(os.tmpdir(), `android-e2e-${process.pid}.json`);
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [PLAYWRIGHT_CLI, "test", "--project=android", "--reporter=list,json", ...passthrough],
      {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, ANDROID_SERIAL: serial, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
      }
    );
    child.on("close", (code) => {
      let report = null;
      try {
        report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
        fs.unlinkSync(reportFile);
      } catch (e) {}
      resolve({ code, report });
    });
  });
}

// Installs the APKs this job already built, so the app under test keeps the signature the
// Playwright specs installed (-d: a spec may have left a higher-version APK installed).
function runInstrumentation(serial) {
  const apk = env.apkPath();
  const testApk = env.testApkPath();
  for (const file of [apk, testApk]) {
    if (!fs.existsSync(file)) {
      console.error(`[環境] instrumented tests: missing ${file} (build assembleDebug assembleDebugAndroidTest)`);
      return "env";
    }
  }
  for (const args of [["install", "-r", "-t", "-d", "-g", apk], ["install", "-r", "-t", testApk]]) {
    const r = adb(["-s", serial, ...args]);
    if (r.status !== 0) {
      console.error(`[環境] instrumented tests: adb ${args.join(" ")} failed\n${r.stdout}${r.stderr}`);
      return "env";
    }
  }
  console.log(`Instrumented tests (${env.APK_TEST_PKG})…`);
  const r = adb(["-s", serial, "shell", "am", "instrument", "-w", "-r", `${env.APK_TEST_PKG}/${env.INSTRUMENTATION_RUNNER}`]);
  const output = `${r.stdout || ""}${r.stderr || ""}`;
  const result = classifyInstrumentation(output);
  fs.mkdirSync(INSTRUMENTATION_RESULTS, { recursive: true });
  fs.writeFileSync(path.join(INSTRUMENTATION_RESULTS, "am-instrument.txt"), output);
  adb(["-s", serial, "uninstall", env.APK_TEST_PKG]);
  if (result.verdict === "pass") console.log(`Instrumented tests: ${result.passed} passed.`);
  else if (result.verdict === "fail") console.error(`${output}\nInstrumented tests: ${result.failed} failed.`);
  else console.error(`${output}\n[環境] instrumented tests: no test passed, so there is no evidence.`);
  return result.verdict;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.ifChanged) {
    const r = androidE2eNeeded(opts.ifChanged);
    if (!r.needed) {
      console.log(`略過：相對 ${opts.ifChanged} 沒有改到 Android e2e 相關檔案（scripts/android-e2e-needed.mjs）`);
      return 0;
    }
    console.log(r.reason ? `無法判斷改動（${r.reason}）⇒ 照跑` : `命中：${r.matched.join(", ")}`);
  }

  // 先建 APK 再開機：編不過就不必白開一台模擬器。
  const build = apkBuildPlan(opts);
  if (build) {
    console.log("建置 debug APK（gradlew assembleDebug）…");
    const r = spawnSync(build.cmd, build.args, { cwd: build.cwd, shell: build.shell, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(
        `[環境] assembleDebug 失敗（exit ${r.status}${r.error ? `，${r.error.message}` : ""}）：` +
          "android/ 編不過或 JDK／SDK 沒設好，見 docs/android-app.md。未取得測試結論。"
      );
      return 2;
    }
  }

  const before = adbSerials();
  if (!before) {
    console.error(`[環境] 找不到 adb（${env.sdkTool("adb")}）。安裝 Android SDK platform-tools，見 docs/android-e2e.md`);
    return 2;
  }

  let serial = env.pickEmulatorSerial(before, process.env);
  let booted = false;
  if (!serial) {
    const emus = before.filter((s) => /^emulator-\d+$/.test(s));
    if (process.env.ANDROID_SERIAL || emus.length > 1) {
      console.error(`[環境] 無法決定用哪台模擬器（adb：${before.join(", ")}；ANDROID_SERIAL=${process.env.ANDROID_SERIAL || "未設"}）`);
      return 2;
    }
    if (!opts.boot) {
      console.error("[環境] 沒有在跑的模擬器（--no-boot）");
      return 2;
    }
    const emulator = env.sdkTool("emulator");
    if (!emulator) {
      console.error("[環境] 找不到 emulator。`sdkmanager emulator` 後重試，見 docs/android-e2e.md");
      return 2;
    }
    if (!avdExists(emulator)) {
      if (!systemImageInstalled() || !createAvd()) {
        console.error(`[環境] 沒有 AVD ${env.AVD_NAME}，也建不起來。先 \`sdkmanager "${env.SYSTEM_IMAGE}"\`，見 docs/android-e2e.md`);
        return 2;
      }
      console.log(`已建立 AVD ${env.AVD_NAME}`);
    }
    console.log(`開機中（${env.AVD_NAME}）…`);
    const t0 = Date.now();
    serial = await bootEmulator(before);
    if (!serial) {
      console.error(`[環境] 模擬器 ${BOOT_TIMEOUT_MS / 1000}s 內沒開完機（Windows 要開 WHPX，見 docs/android-e2e.md）`);
      return 2;
    }
    booted = true;
    console.log(`開機完成：${serial}（${Math.round((Date.now() - t0) / 1000)}s）`);
  }

  logDeviceInfo(serial);

  try {
    const inst = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "install", "android"], { cwd: ROOT, stdio: "inherit" });
    if (inst.status !== 0) {
      console.error("[環境] playwright install android 失敗");
      return 2;
    }

    const plan = groupPlan(opts.group);
    const { code, report } = await runPlaywright(serial, [...plan.specs, ...opts.passthrough]);
    const verdicts = [code === 0 ? "pass" : classifyReport(report)];
    if (plan.instrumented) verdicts.push(runInstrumentation(serial));
    const verdict = combineVerdicts(verdicts);
    if (verdict === "pass") {
      console.log("結論：全綠。");
      return 0;
    }
    if (verdict === "env") {
      console.error(
        `結論：環境問題（playwright 的失敗全帶 ${env.ENV_ERROR_TAG}，或 instrumented tests 沒有結論），未取得有效結論。`
      );
      return 2;
    }
    console.error("結論：有真失敗。");
    return 1;
  } finally {
    if (booted && !opts.keepEmulator) adb(["-s", serial, "emu", "kill"]);
  }
}

// 只有「直接執行」才跑 main——unit test import 純函式時不可碰 adb 或 exit。
// 收尾用 process.exitCode 而非 process.exit()（見 scripts/ci-status.mjs 的 libuv 註解）。
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e.message);
      process.exitCode = 2;
    }
  );
}
