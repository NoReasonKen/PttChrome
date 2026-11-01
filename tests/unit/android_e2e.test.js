// Android 模擬器 e2e 設施的純函式守護（不碰 adb、不開模擬器）。設計見 docs/android-e2e.md。
//
// 要鎖住的幾件事：
//   - 只會選到模擬器：開發機常同時連著實機（無線 adb），測試會斷網、清 Chrome 資料；
//   - 環境問題 → exit 2、真失敗 → exit 1，兩者混在一起時以真失敗為準（不可被蓋掉）；
//   - `--if-changed` 名單裡的路徑都還存在（改名不得讓它靜默變成「永遠略過」）；
//   - live project 不會順手把 android spec 抓去跑。
import fs from "fs";
import path from "path";
import config from "../../playwright.config.js";
import androidEnv from "../e2e/android/android_env.js";
import { ANDROID_E2E_GLOBS, globToRegExp, matchAndroidE2e } from "../../scripts/android-e2e-needed.mjs";
import {
  ANDROID_E2E_GROUPS,
  apkBuildPlan,
  classifyInstrumentation,
  classifyReport,
  combineVerdicts,
  groupPlan,
  parseArgs,
} from "../../scripts/run-android-e2e.mjs";

const { ENV_ERROR_TAG, pickEmulatorSerial, toDevicePoint, parseAdbDevices } = androidEnv;
const ROOT = path.resolve(__dirname, "../..");

describe("pickEmulatorSerial：只碰模擬器", () => {
  const phone = "adb-XXXX._adb-tls-connect._tcp";
  test("實機＋一台模擬器 ⇒ 選模擬器", () => {
    expect(pickEmulatorSerial([phone, "emulator-5554"], {})).toBe("emulator-5554");
  });
  test("只有實機 ⇒ 不選", () => {
    expect(pickEmulatorSerial([phone], {})).toBeNull();
    expect(pickEmulatorSerial(["R5CT1234567"], {})).toBeNull();
  });
  test("兩台模擬器 ⇒ 不猜（要 ANDROID_SERIAL）", () => {
    expect(pickEmulatorSerial(["emulator-5554", "emulator-5556"], {})).toBeNull();
    expect(pickEmulatorSerial(["emulator-5554", "emulator-5556"], { ANDROID_SERIAL: "emulator-5556" })).toBe("emulator-5556");
  });
  test("ANDROID_SERIAL 指定但不在線上 ⇒ 不退回自動挑", () => {
    expect(pickEmulatorSerial(["emulator-5554"], { ANDROID_SERIAL: "emulator-5556" })).toBeNull();
  });
});

describe("座標與 adb 輸出", () => {
  test("toDevicePoint：CSS px × DPR ＋ WebView 原點", () => {
    expect(toDevicePoint({ x: 0, y: 330 }, 2.625, { x: 160, y: 44 })).toEqual({ x: 420, y: 446 });
  });
  test("parseAdbDevices 只收 state=device", () => {
    const out = "List of devices attached\nemulator-5554\tdevice product:sdk\nemulator-5556\toffline\nabc\tunauthorized\n\n";
    expect(parseAdbDevices(out)).toEqual(["emulator-5554"]);
  });
});

describe("classifyReport：0／1／2 的依據", () => {
  const report = (results, extra = {}) => ({
    suites: [{ specs: [{ tests: [{ results }] }] }],
    errors: [],
    stats: { expected: results.filter((r) => r.status === "passed").length },
    ...extra,
  });
  const envErr = { message: `Error: ${ENV_ERROR_TAG} 觸控落點偏移` };
  const realErr = { message: "Error: expect(received).toBe(expected)" };

  test("全過 ⇒ pass", () => {
    expect(classifyReport(report([{ status: "passed" }]))).toBe("pass");
  });
  test("失敗全是環境錯誤 ⇒ env", () => {
    expect(classifyReport(report([{ status: "failed", errors: [envErr] }]))).toBe("env");
  });
  test("REGRESSION 防線：環境錯誤混真失敗 ⇒ fail（不可被蓋掉）", () => {
    expect(
      classifyReport(report([{ status: "failed", errors: [envErr] }, { status: "failed", errors: [realErr] }]))
    ).toBe("fail");
    expect(classifyReport(report([{ status: "timedOut", errors: [realErr] }]))).toBe("fail");
  });
  test("worker fixture 掛掉（頂層 errors）帶標記 ⇒ env；不帶 ⇒ fail", () => {
    expect(classifyReport(report([], { errors: [envErr] }))).toBe("env");
    expect(classifyReport(report([], { errors: [realErr] }))).toBe("fail");
  });
  test("沒有報告、一條都沒跑 ⇒ env（不可以當綠）", () => {
    expect(classifyReport(null)).toBe("env");
    expect(classifyReport(report([]))).toBe("env");
  });
});

describe("裝置資訊 log 的解析", () => {
  test("parseImageRevision 取 Pkg.Revision；沒有 ⇒ null", () => {
    expect(androidEnv.parseImageRevision("Pkg.Desc=Google APIs\r\nPkg.Revision=14\r\n")).toBe("14");
    expect(androidEnv.parseImageRevision("Pkg.Desc=x")).toBe(null);
  });
  test("parseVersionName 取第一個 versionName；沒有 ⇒ null", () => {
    const dump = "Packages:\n  Package [com.android.chrome]\n    versionCode=567 minSdk=29\n    versionName=113.0.5672.136\n    versionName=110.0.1\n";
    expect(androidEnv.parseVersionName(dump)).toBe("113.0.5672.136");
    expect(androidEnv.parseVersionName("")).toBe(null);
  });
});

// APK spec 用它判「App 在前景／被丟到背景／外部瀏覽器起來了」。
describe("parseResumedPackage：前景 App", () => {
  test("Android 14 的 topResumedActivity", () => {
    const dump =
      "  Task display areas in top down Z order:\n" +
      "    topResumedActivity=ActivityRecord{3d2a1b u0 com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity t15}\n" +
      "    mResumedActivity: ActivityRecord{3d2a1b u0 com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity t15}\n";
    expect(androidEnv.parseResumedPackage(dump)).toBe("com.android.chrome");
  });
  test("舊格式 mResumedActivity: 也認；debug APK 的套件名帶 .debug", () => {
    const dump = "  mResumedActivity: ActivityRecord{9f u0 io.github.noreasonken.pttchrome.debug/io.github.abccbaandy.pttchrome.MainActivity t3}";
    expect(androidEnv.parseResumedPackage(dump)).toBe(androidEnv.APK_PKG);
  });
  test("沒有前景 Activity ⇒ null", () => {
    expect(androidEnv.parseResumedPackage("topResumedActivity=null")).toBe(null);
    expect(androidEnv.parseResumedPackage("")).toBe(null);
    expect(androidEnv.parseResumedActivity("")).toBe(null);
  });
  // 回歸：外部連結那條只等「前景是 Chrome」，Chrome 的跳板（疊在 App 的 task 裡）一出現就
  // 成立 ⇒ 立刻叫回 App，0.2s 後 Chrome 才在自己的 task 開分頁把 App 蓋掉。要能分 task。
  test("parseResumedActivity 帶 task 編號：分得出跳板與 Chrome 自己的 task", () => {
    const trampoline =
      "    topResumedActivity=ActivityRecord{6a u0 com.android.chrome/com.google.android.apps.chrome.IntentDispatcher t144}";
    const tab = "    topResumedActivity=ActivityRecord{3d u0 com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity t145}";
    expect(androidEnv.parseResumedActivity(trampoline)).toEqual({ pkg: "com.android.chrome", task: 144 });
    expect(androidEnv.parseResumedActivity(tab)).toEqual({ pkg: "com.android.chrome", task: 145 });
  });
});

// debug APK 的 dev server 設定要對上 AppSettings.kt 的檔名與 key（改名＝APK 靜默載正式站）。
describe("APK dev server 設定", () => {
  const kt = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/io/github/abccbaandy/pttchrome/AppSettings.kt"), "utf8");
  test("檔名 app_settings、key dev_server_enabled 與 AppSettings.kt 一致", () => {
    expect(kt).toMatch(/FILE = "app_settings"/);
    expect(kt).toMatch(/KEY_DEV_ENABLED = "dev_server_enabled"/);
    expect(androidEnv.APK_DEV_PREFS_XML).toContain("name='dev_server_enabled' value='true'");
    expect(fs.readFileSync(path.join(ROOT, "tests/e2e/android/fixtures.js"), "utf8")).toMatch(/shared_prefs\/app_settings\.xml/);
  });
  test("預設 dev 網址就是 localhost:8080（adb reverse 接的那個埠）", () => {
    const ps = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/io/github/abccbaandy/pttchrome/PageSource.kt"), "utf8");
    expect(ps).toMatch(/DEFAULT_DEV_URL = "http:\/\/localhost:8080\/"/);
  });
  test("the debug package and activity follow the application ID and retained namespace", () => {
    const gradle = fs.readFileSync(path.join(ROOT, "android/app/build.gradle.kts"), "utf8");
    const applicationId = gradle.match(/applicationId = "([^"]+)"/)[1];
    const namespace = gradle.match(/namespace = "([^"]+)"/)[1];
    const suffix = gradle.match(/applicationIdSuffix = "([^"]+)"/)[1];
    expect(applicationId).toBe("io.github.noreasonken.pttchrome");
    expect(androidEnv.APK_PKG).toBe(applicationId + suffix);
    expect(androidEnv.APK_ACTIVITY).toBe(`${androidEnv.APK_PKG}/${namespace}.MainActivity`);
  });
});

describe("fork production identity", () => {
  test("the reading page, native bridge origin, and App Links host stay aligned", () => {
    const config = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/io/github/abccbaandy/pttchrome/AppConfig.kt"), "utf8");
    const manifest = fs.readFileSync(path.join(ROOT, "android/app/src/main/AndroidManifest.xml"), "utf8");
    const strings = fs.readFileSync(path.join(ROOT, "android/app/src/main/res/values/strings.xml"), "utf8");
    const page = new URL(config.match(/PAGE_URL = "([^"]+)"/)[1]);
    const origin = config.match(/PAGE_ORIGIN = "([^"]+)"/)[1];
    expect(page.href).toBe("https://noreasonken.github.io/PttChrome/");
    expect(origin).toBe(page.origin);
    expect(manifest).toContain(`android:host="${page.hostname}"`);
    expect(manifest).not.toContain('android:host="abccbaandy.github.io"');
    expect(strings).toContain(`${origin}/.well-known/assetlinks.json`);
    expect(strings).not.toContain("https://abccbaandy.github.io/.well-known/assetlinks.json");
  });
});

// 回歸：CI 冷開機後桌面 ANR，返回鍵把 App 丟到背景時桌面接不回前景。開跑前等系統穩定、
// 失敗時附 ANR 段落；這三個解析錯了，等待會白等或永遠不停、診斷會是空的。
describe("系統穩定等待與 ANR 診斷的解析", () => {
  test("cpuIdlePercent：idle＋iowait 算閒，取兩次差值", () => {
    const a = "cpu  100 0 100 700 100 0 0 0 0 0\n";
    const b = "cpu  150 0 150 750 150 0 0 0 0 0\n"; // 差：busy 100、idle+iowait 100
    expect(androidEnv.cpuIdlePercent(a, b)).toBe(50);
  });
  test("cpuIdlePercent：讀不到或沒前進 ⇒ null（不准當成 0% 閒而白等，也不准當成閒）", () => {
    expect(androidEnv.cpuIdlePercent("", "cpu 1 1 1 1\n")).toBeNull();
    expect(androidEnv.cpuIdlePercent("cpu 1 1 1 1\n", "cpu 1 1 1 1\n")).toBeNull();
  });
  test("parseHomePackage：取最後一行的 pkg", () => {
    const out = "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\n" +
      "com.google.android.apps.nexuslauncher/.NexusLauncherActivity\n";
    expect(androidEnv.parseHomePackage(out)).toBe("com.google.android.apps.nexuslauncher");
    expect(androidEnv.parseHomePackage("No activity found")).toBeNull();
  });
  test("anrExcerpt：從「ANR in」切段，多則分開；沒有 ⇒ 空字串", () => {
    const log = [
      "E ActivityManager: something else",
      "E ActivityManager: ANR in com.google.android.apps.nexuslauncher",
      "E ActivityManager: Reason: Input dispatching timed out",
      "E ActivityManager: Load: 8.1 / 6.0 / 3.2",
      "E ActivityManager: ANR in com.android.systemui",
      "E ActivityManager: Reason: Broadcast",
    ].join("\n");
    const out = androidEnv.anrExcerpt(log);
    expect(out.split("\n\n")).toHaveLength(2);
    expect(out).toContain("Load: 8.1");
    expect(out).not.toContain("something else");
    expect(androidEnv.anrExcerpt("E ActivityManager: fine")).toBe("");
  });
});

describe("parseArgs", () => {
  test("--if-changed 預設 base 為 origin/dev；其餘透傳", () => {
    expect(parseArgs(["--if-changed", "--grep", "x"])).toMatchObject({ ifChanged: "origin/dev", passthrough: ["--grep", "x"] });
    expect(parseArgs(["--if-changed=HEAD~3", "--no-boot", "--keep-emulator"])).toMatchObject({
      ifChanged: "HEAD~3",
      boot: false,
      keepEmulator: true,
    });
  });
  test("--no-build；預設要建", () => {
    expect(parseArgs([]).build).toBe(true);
    expect(parseArgs(["--no-build"])).toMatchObject({ build: false, passthrough: [] });
  });
  test("--group selects one CI group; an unknown name is an error", () => {
    expect(parseArgs([]).group).toBeNull();
    expect(parseArgs(["--group=chrome", "--grep", "x"])).toMatchObject({ group: "chrome", passthrough: ["--grep", "x"] });
    expect(() => parseArgs(["--group=nope"])).toThrow(/nope/);
  });
});

// CI runs each group on its own emulator. A spec missing from every group would silently
// stop running in CI; a spec in two groups would run twice.
describe("Android e2e groups", () => {
  const dir = path.join(ROOT, "tests/e2e/android");
  const specs = fs.readdirSync(dir).filter((n) => n.endsWith(".android.spec.js"));
  test("every Android spec belongs to exactly one group", () => {
    const grouped = Object.values(ANDROID_E2E_GROUPS).flatMap((g) => g.specs);
    expect([...grouped].sort()).toEqual([...specs].sort());
  });
  test("a group runs its own spec files; no group runs every spec", () => {
    expect(groupPlan(null)).toEqual({ specs: [], apk: true, instrumented: true });
    const chrome = groupPlan("chrome");
    expect(chrome.apk).toBe(false);
    expect(chrome.instrumented).toBe(false);
    expect(chrome.specs).toContain("tests/e2e/android/select_mode.android.spec.js");
    const apk = groupPlan("apk");
    expect(apk).toMatchObject({ apk: true, instrumented: true });
    expect(apk.specs).toContain("tests/e2e/android/credentials.android.spec.js");
  });
});

// `am instrument -w -r` output. Gradle's connectedDebugAndroidTest once reported
// BUILD SUCCESSFUL after failing to install the APK, so zero tests must never pass.
describe("classifyInstrumentation", () => {
  const status = (code) => `INSTRUMENTATION_STATUS: test=t\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
  const run = (codes, tail) =>
    codes.map((c) => status(1) + status(c)).join("") + tail + "\nINSTRUMENTATION_CODE: -1\n";
  test("all tests passed", () => {
    expect(classifyInstrumentation(run([0, 0, 0], "OK (3 tests)"))).toEqual({ verdict: "pass", passed: 3, failed: 0 });
  });
  test("a failure or an error is a real failure", () => {
    expect(classifyInstrumentation(run([0, -2], "FAILURES!!!\nTests run: 2,  Failures: 1")).verdict).toBe("fail");
    expect(classifyInstrumentation(run([-1], "FAILURES!!!")).verdict).toBe("fail");
  });
  test("a crashed test process is a real failure", () => {
    const out = status(1) + "INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0\n";
    expect(classifyInstrumentation(out).verdict).toBe("fail");
  });
  test("zero executed tests, skipped-only runs and missing instrumentation are not a pass", () => {
    expect(classifyInstrumentation(run([], "OK (0 tests)")).verdict).toBe("env");
    expect(classifyInstrumentation(run([-3, -4], "OK (0 tests)")).verdict).toBe("env");
    expect(classifyInstrumentation("INSTRUMENTATION_FAILED: x/androidx.test.runner.AndroidJUnitRunner\n").verdict).toBe("env");
    expect(classifyInstrumentation("").verdict).toBe("env");
  });
});

describe("combineVerdicts", () => {
  test("a real failure wins over an environment problem; both beat a pass", () => {
    expect(combineVerdicts(["pass", "pass"])).toBe("pass");
    expect(combineVerdicts(["pass", "env"])).toBe("env");
    expect(combineVerdicts(["env", "fail"])).toBe("fail");
  });
});

// 回歸：本機原本不建 APK，直接裝 build 輸出目錄裡的舊檔 ⇒ apk spec 測的是舊 code。
describe("apkBuildPlan：每輪先建 APK", () => {
  test("本機預設要建；Windows 走 shell＋絕對路徑的 gradlew.bat（整條一個字串）", () => {
    const android = path.join(ROOT, "android");
    expect(apkBuildPlan(parseArgs([]), {}, "win32")).toEqual({
      cmd: `"${path.join(android, "gradlew.bat")}" assembleDebug assembleDebugAndroidTest`,
      args: [],
      cwd: android,
      shell: true,
    });
    expect(apkBuildPlan(parseArgs([]), {}, "linux")).toEqual({
      cmd: path.join(android, "gradlew"),
      args: ["assembleDebug", "assembleDebugAndroidTest"],
      cwd: android,
      shell: false,
    });
  });
  test("a group without APK specs builds nothing", () => {
    expect(apkBuildPlan(parseArgs(["--group=chrome"]), {}, "linux")).toBeNull();
    expect(apkBuildPlan(parseArgs(["--group=apk"]), {}, "linux").args).toEqual([
      "assembleDebug",
      "assembleDebugAndroidTest",
    ]);
  });
  test("CI 已指定 ANDROID_E2E_APK 或 --no-build ⇒ 不建", () => {
    expect(apkBuildPlan(parseArgs([]), { ANDROID_E2E_APK: "/x/app-debug.apk" }, "linux")).toBeNull();
    expect(apkBuildPlan(parseArgs(["--no-build"]), {}, "win32")).toBeNull();
  });
});

describe("--if-changed 名單", () => {
  test("glob 語意：** 跨目錄、* 不跨 /", () => {
    expect(globToRegExp("src/components/ContextMenu/**").test("src/components/ContextMenu/a/b.jsx")).toBe(true);
    expect(globToRegExp("src/*.js").test("src/a/b.js")).toBe(false);
    expect(globToRegExp("src/css/main.css").test("src/css/mainXcss")).toBe(false);
  });
  test("相關檔案命中、無關檔案不命中、Windows 路徑正規化", () => {
    expect(
      matchAndroidE2e([
        "src/js/context_menu_items.js",
        "src\\components\\ContextMenu\\index.jsx",
        "src/components/MobileToolbar/index.jsx",
        "tests/e2e/android/fixtures.js",
        "src/js/term_view.js",
        "docs/mobile.md",
      ])
    ).toEqual([
      "src/js/context_menu_items.js",
      "src/components/ContextMenu/index.jsx",
      "src/components/MobileToolbar/index.jsx",
      "tests/e2e/android/fixtures.js",
    ]);
  });
  test("名單裡的每個路徑都還存在（改名不得讓它靜默變成永遠略過）", () => {
    for (const g of ANDROID_E2E_GLOBS) {
      const p = g.endsWith("/**") ? g.slice(0, -3) : g;
      expect(fs.existsSync(path.join(ROOT, p)), g).toBe(true);
    }
  });
});

describe("playwright.config：android project", () => {
  const android = config.projects.find((p) => p.name === "android");
  test("存在、只收 android/ 底下的 spec、worker 不會被放大（名稱不得以 offline 開頭）", () => {
    expect(android).toBeTruthy();
    expect(android.testMatch).toBe("android/**/*.android.spec.js");
  });
  test("live project 排除 android/（否則 yarn test:e2e 會去找模擬器）", () => {
    const live = config.projects.find((p) => p.name === "live");
    expect(live.testIgnore).toContain("android/**");
  });
});

// 這兩行刪掉不會讓任何東西編譯失敗，只會讓整輪變成偶發 exit 2（畫面被系統對話框蓋住、
// UIAutomator 讀不到 WebView），而且要冷開機才比較容易遇到。理由見 fixtures.js 註解。
describe("android fixture：擋畫面的對話框", () => {
  const src = fs.readFileSync(path.join(ROOT, "tests/e2e/android/fixtures.js"), "utf8");
  test("pm clear 之後預先授權通知（否則 Android 13+ 跳權限推廣對話框）", () => {
    expect(src).toMatch(/pm clear \$\{CHROME\}; pm grant \$\{CHROME\} android\.permission\.POST_NOTIFICATIONS/);
  });
  test("關掉系統錯誤對話框（模擬器軟體 GPU 上 Chrome 的 GPU 程序會當，跳「keeps stopping」）", () => {
    expect(src).toMatch(/settings put global hide_error_dialogs 1/);
  });
  // CI spike 20 輪有 3 輪：開機後、fixture 設 hide_error_dialogs 之前 Pixel Launcher 就 ANR，
  // 對話框已經掛在畫面上 —— 這個設定只擋之後的，不收已顯示的。順序要先設再關：反過來
  // 的話，兩步之間冒出的 ANR 照樣會顯示。
  test("設完 hide_error_dialogs 再廣播 CLOSE_SYSTEM_DIALOGS，收掉設定前就跳出來的 ANR 對話框", () => {
    const hide = src.indexOf("settings put global hide_error_dialogs 1");
    const close = src.indexOf("am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS");
    expect(close).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(hide);
  });
  test("launchBrowser 有自己的逾時，卡住時歸類為環境問題", () => {
    expect(src).toMatch(/LAUNCH_TIMEOUT_MS/);
    expect(src).toMatch(/Promise\.race\(\[\s*android\.device\.launchBrowser/);
  });
});

// UIAutomator 的 device.wait 等的是「UI 變化」：目標在 wait 開始前就已經出現、之後畫面
// 不再變時，畫面上明明有它也會等滿逾時（實測 Copy 工具列）。一律 expect.poll(device.info)。
describe("android spec：不准用 device.wait", () => {
  const dir = path.join(ROOT, "tests/e2e/android");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    test(f, () => {
      const code = fs
        .readFileSync(path.join(dir, f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*\/\//.test(l))
        .join("\n");
      expect(code).not.toMatch(/\bdevice\s*\.\s*wait\s*\(/);
    });
  }
});

// CI jobs: the exit code alone decides red or green. The spike's continue-on-error plus
// writing the exit code to a file would keep the job green on assertion failures; without
// KVM the emulator takes 13–20 minutes to boot and adb keeps going offline.
describe("test.yml: Android e2e groups", () => {
  const yaml = fs.readFileSync(path.join(ROOT, ".github/workflows/test.yml"), "utf8");
  const m = /\n {2}test-e2e-android-group:\n([\s\S]*?)(?=\n {2}[A-Za-z][\w-]*:\n)/.exec(yaml);
  const body = m ? m[1] : "";
  test("one matrix cell per group, each running its group straight through the runner", () => {
    const groups = /group: \[([^\]]*)\]/.exec(body)[1].split(",").map((g) => g.trim());
    expect(groups.sort()).toEqual(Object.keys(ANDROID_E2E_GROUPS).sort());
    expect(body).toMatch(/script: node scripts\/run-android-e2e\.mjs --no-boot --group=\$\{\{ matrix\.group \}\}\s*$/m);
    expect(body).not.toMatch(/continue-on-error/);
    expect(body).not.toMatch(/e2e\.exit|\|\| true/);
  });
  // A second Gradle build inside the emulator step re-signed the APK, its install failed,
  // and Gradle still reported success. The runner installs the APKs built here instead.
  test("instrumented tests use the APKs built before the emulator, never a second Gradle build", () => {
    expect(body).toMatch(/gradlew --no-daemon assembleDebug assembleDebugAndroidTest/);
    expect(body).not.toMatch(/connected\w*AndroidTest/);
    expect(body).toMatch(/ANDROID_E2E_APK: .*app-debug\.apk/);
    expect(body).toMatch(/ANDROID_E2E_TEST_APK: .*app-debug-androidTest\.apk/);
    expect(body).toContain("android/app/build/outputs/androidTest-results/");
  });
  test("only the APK group sets up Java and builds", () => {
    const steps = body.split(/\n {6}- /);
    for (const marker of ["actions/setup-java@", "gradle/actions/setup-gradle@", "name: Build debug APK"]) {
      const step = steps.find((st) => st.includes(marker));
      expect(step, marker).toBeDefined();
      expect(step, marker).toMatch(/^\s*if: matrix\.group == 'apk'\s*$/m);
    }
    expect(ANDROID_E2E_GROUPS.apk.apk).toBe(true);
  });
  test("開模擬器前先開 KVM 權限", () => {
    const kvm = body.indexOf("udevadm trigger --name-match=kvm");
    const emu = body.indexOf("android-emulator-runner@");
    expect(kvm).toBeGreaterThan(-1);
    expect(emu).toBeGreaterThan(kvm);
  });
  // 系統映像每輪現抓偶爾拿到壞 zip（模擬器沒開機就紅）⇒ 開模擬器前先從 cache 還原，
  // 且 cache 的路徑／key 要跟 emulator-runner 實際裝的映像一致，不然還原了也白還原。
  test("開模擬器前先從 cache 還原同一個系統映像", () => {
    const cache = body.indexOf("actions/cache@");
    const emu = body.indexOf("android-emulator-runner@");
    expect(cache).toBeGreaterThan(-1);
    expect(emu).toBeGreaterThan(cache);
    const api = /api-level: (\d+)/.exec(body)[1];
    const target = /target: (\S+)/.exec(body)[1];
    const arch = /arch: (\S+)/.exec(body)[1];
    expect(body).toContain(`system-images/android-${api}/${target}/${arch}`);
    expect(body).toMatch(new RegExp(`key: android-sysimg-${api}-${target}-${arch}-`));
  });
  test("the APK build runs before the emulator starts", () => {
    const build = body.indexOf("assembleDebug");
    const emu = body.indexOf("android-emulator-runner@");
    expect(build).toBeGreaterThan(-1);
    expect(emu).toBeGreaterThan(build);
  });
});
