// Firefox project 對 dev server 的連線必須是決定性的：關掉 IPv4 快速備援。
//
// 症狀：offline-firefox（selection.offline.spec.js）在 Windows 上每輪隨機紅幾條，
// 紅的子集每次都不同，錯誤全是 `page.goto: NS_ERROR_CONNECTION_REFUSED`，dev server
// 全程活著、PID 不變（不是「前面全綠、之後整批同錯」那種 dev server 被砍）。
// 成因：Windows 上 vite 只綁 IPv6 `[::1]:8080`，Firefox 解析 `localhost` 的 happy-eyeballs
// （`network.http.fast-fallback-to-IPv4`）在負載下 IPv6 連線稍慢時就並行開 IPv4 備援，
// 打到沒人聽的 `127.0.0.1:8080` 拿到 refused，整個導航直接失敗。Chromium 不會。
// 實測（8 個 Firefox 並行 × 8 次完整 load）：localhost 8/128 refused、[::1] 0/64；
// 關掉該 pref 後 localhost 0/192。
// 不改 baseURL 成 `[::1]`：Linux（CI）上 vite 綁的是 127.0.0.1，那樣反而全滅。
//
// 純靜態，不開瀏覽器 ⇒ 放 unit（比照 tests/unit/e2e_offline_no_network.test.js）。
import config from "../../playwright.config.js";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const configUrl = new URL("../../playwright.config.js", import.meta.url);
const configSource = fs.readFileSync(configUrl, "utf8");
const requireFromConfig = createRequire(configUrl);

function loadConfigFor(options = {}) {
  const { platform, uid, ci, home } = {
    platform: "linux", uid: 0, ci: "true", home: "/root", ...options,
  };
  const env = {
    VITEST: "true",
    CI: ci,
    HOME: "/github/home",
    MOZ_DISABLE_CONTENT_SANDBOX: "0",
    FIREFOX_TEST_SETTING: "preserved",
  };
  const userInfo = vi.fn(() => ({ homedir: home }));
  const context = {
    module: { exports: {} },
    process: { env, platform, getuid: uid == null ? undefined : () => uid, argv: [] },
    require: (id) => id === "node:os" ? { userInfo } : requireFromConfig(id),
  };
  vm.runInNewContext(configSource, context, { filename: "playwright.config.js" });
  const project = context.module.exports.projects.find((entry) => entry.name === "offline-firefox");
  return { launchEnv: project.use.launchOptions.env, env, userInfo };
}

const isFirefox = (p) =>
  ((p.use || {}).defaultBrowserType || (p.use || {}).browserName) === "firefox";
const firefoxProjects = config.projects.filter(isFirefox);

describe("Firefox launch home in CI containers", () => {
  test.each(["/root", "/custom/root-home"])(
    "root Linux CI uses the account home %s only for Firefox",
    (home) => {
      const { launchEnv, env, userInfo } = loadConfigFor({ home });
      expect(launchEnv.HOME).toBe(home);
      expect(userInfo).toHaveBeenCalledTimes(1);
      expect(env.HOME).toBe("/github/home");
      expect(launchEnv.MOZ_DISABLE_CONTENT_SANDBOX).toBe("1");
      expect(launchEnv.FIREFOX_TEST_SETTING).toBe("preserved");
    }
  );

  test.each([
    { name: "non-root Linux CI", uid: 1001 },
    { name: "local Linux root", ci: undefined },
    { name: "explicitly disabled CI", ci: "false" },
    { name: "Windows CI without getuid", platform: "win32", uid: null },
    { name: "macOS CI", platform: "darwin" },
  ])("$name preserves the inherited home", (options) => {
    const { launchEnv, env, userInfo } = loadConfigFor(options);
    expect(launchEnv.HOME).toBe(env.HOME);
    expect(userInfo).not.toHaveBeenCalled();
    expect(launchEnv.MOZ_DISABLE_CONTENT_SANDBOX).toBe("1");
  });
});

describe("Firefox e2e：連 dev server 不走 IPv4 快速備援", () => {
  test("至少有一個 Firefox project（清單改名不得靜默讓這支變空轉）", () => {
    expect(firefoxProjects.map((p) => p.name)).toContain("offline-firefox");
  });

  test.each(firefoxProjects.map((p) => p.name))(
    "%s 必須關掉 network.http.fast-fallback-to-IPv4",
    (name) => {
      const p = firefoxProjects.find((x) => x.name === name);
      const prefs = ((p.use.launchOptions || {}).firefoxUserPrefs) || {};
      expect(
        prefs["network.http.fast-fallback-to-IPv4"],
        `${name} 沒關 IPv4 快速備援 ⇒ Windows 上 page.goto 偶發 NS_ERROR_CONNECTION_REFUSED`
      ).toBe(false);
    }
  );
});
