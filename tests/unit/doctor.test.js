import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  parseOptions,
  checkBrowser,
  findAdb,
  deviceSummary,
  checkWeb,
  runDoctor,
} from "../../scripts/doctor.mjs";

describe("doctor options", () => {
  test("keeps optional capabilities opt-in and enables Android for device inventory", () => {
    expect(parseOptions([])).toEqual({
      browser: false,
      android: false,
      web: false,
      device: false,
    });
    expect(parseOptions(["--device", "--web"])).toEqual({
      browser: false,
      android: true,
      web: true,
      device: true,
    });
    expect(() => parseOptions(["--install"])).toThrow("Unknown option");
  });
});

describe("browser capability", () => {
  test("preserves the actionable missing-library line without dumping launch arguments", async () => {
    const error = new Error(
      `browserType.launch failed\n<launching> ${"argument ".repeat(2000)}\n[pid=42] error while loading shared libraries: libasound.so.2: cannot open shared object file\ncall log\n${"noise\n".repeat(300)}`,
    );
    const result = await checkBrowser("chromium", {
      chromium: { launch: vi.fn().mockRejectedValue(error) },
    });
    expect(result.message).toContain("libasound.so.2");
    expect(result.message.length).toBeLessThan(900);
    expect(result.message).not.toContain("<launching>");
  });

  test("uses inline content and always closes a launched browser after page failure", async () => {
    const close = vi.fn();
    const launch = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockRejectedValue(new Error("missing library")),
      close,
    });
    const result = await checkBrowser("chromium", { chromium: { launch } });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("missing library");
    expect(close).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true, timeout: 10000 }),
    );
  });

  test("checks browser rendering without loading a site", async () => {
    const page = {
      setContent: vi.fn(),
      textContent: vi.fn().mockResolvedValue("doctor-ready"),
    };
    const close = vi.fn();
    const result = await checkBrowser("firefox", {
      firefox: {
        launch: vi.fn().mockResolvedValue({ newPage: async () => page, close }),
      },
    });
    expect(result.ok).toBe(true);
    expect(page.setContent).toHaveBeenCalledWith(
      '<p id="doctor">doctor-ready</p>',
      { timeout: 10000 },
    );
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("ADB capability", () => {
  test("uses a verified explicit path with spaces without a shell", () => {
    const run = vi.fn().mockReturnValue({
      ok: true,
      stdout: "Android Debug Bridge version 1.0.41",
    });
    expect(
      findAdb({ env: { ADB: "/tools with spaces/adb.exe" }, run }).command,
    ).toBe("/tools with spaces/adb.exe");
    expect(run).toHaveBeenCalledExactlyOnceWith("/tools with spaces/adb.exe", [
      "version",
    ]);
  });

  test("reports a broken explicit override instead of silently selecting another ADB", () => {
    const run = vi
      .fn()
      .mockReturnValue({ ok: false, stdout: "", message: "timed out" });
    expect(findAdb({ env: { ADB: "/missing/adb" }, run }).ok).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("falls back from the SDK candidate to PATH and Windows ADB in WSL", () => {
    const run = vi.fn((command) => ({
      ok: command === "adb.exe",
      stdout: "Android Debug Bridge version 1.0.41",
    }));
    const result = findAdb({
      env: {},
      wsl: true,
      sdkAdb: "/sdk/platform-tools/adb",
      run,
    });
    expect(result).toMatchObject({ ok: true, command: "adb.exe" });
    expect(run.mock.calls).toEqual([
      ["/sdk/platform-tools/adb", ["version"]],
      ["adb", ["version"]],
      ["adb.exe", ["version"]],
    ]);
  });

  test("distinguishes ready, unauthorized, and offline devices without changing them", () => {
    expect(
      deviceSummary(
        "List of devices attached\na device\nb unauthorized\nc offline\n",
      ),
    ).toMatchObject({ ok: true });
    expect(
      deviceSummary("List of devices attached\nb unauthorized\n").message,
    ).toContain("Allow USB debugging");
    expect(deviceSummary("List of devices attached\nc offline\n").ok).toBe(
      false,
    );
    expect(deviceSummary("List of devices attached\n").ok).toBe(false);
  });
});

describe("web capability", () => {
  let server;
  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  async function listen(status, body) {
    server = http.createServer((req, res) => {
      expect(req.url).toBe("/@vite/client");
      res.writeHead(status).end(body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }

  test("requires a Vite response rather than any open HTTP port", async () => {
    const origin = await listen(200, "export function createHotContext() {}");
    expect((await checkWeb({ origin, wsl: false })).ok).toBe(true);
  });

  test.each([
    [200, "some other service"],
    [404, "createHotContext"],
  ])(
    "rejects an unrelated service or error response (%s)",
    async (status, body) => {
      expect(
        (await checkWeb({ origin: await listen(status, body), wsl: false })).ok,
      ).toBe(false);
    },
  );

  test("checks the Windows side as well when running in WSL", async () => {
    const origin = await listen(200, "createHotContext");
    const run = vi.fn().mockReturnValue({
      ok: false,
      stdout: "",
      message: "connection refused",
    });
    const result = await checkWeb({ origin, wsl: true, run });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Windows");
    expect(run.mock.calls[0][0]).toBe("curl.exe");
    expect(run.mock.calls[0][1]).toContain(`${origin}/@vite/client`);
  });

  test("reports request failures as environment failures", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("request timed out"));
    expect((await checkWeb({ fetcher, wsl: false })).message).toContain(
      "request timed out",
    );
  });
});

describe("doctor result", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pttchrome-doctor-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ packageManager: "yarn@4.17.0" }),
    );
    fs.writeFileSync(path.join(root, "yarn.lock"), "");
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "node_modules/.yarn-state.yml"), "");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const dependencies = () => ({
    nodeVersion: "24.0.0",
    run: vi.fn().mockReturnValue({ ok: true, stdout: "4.17.0" }),
    hooks: vi.fn().mockReturnValue({ ok: true, message: "Hooks enabled." }),
  });

  test("defaults to basic and hooks, without probing browsers, servers, or devices", async () => {
    const deps = dependencies();
    const result = await runDoctor(root, parseOptions([]), deps);
    expect(result.code).toBe(0);
    expect(result.checks.filter((c) => c.status === "SKIP")).toHaveLength(4);
    expect(deps.run.mock.calls).toEqual([["yarn", ["--version"]]]);
  });

  test("fails early readiness for stale dependencies and disabled hooks", async () => {
    fs.rmSync(path.join(root, "node_modules/.yarn-state.yml"));
    const result = await runDoctor(root, parseOptions([]), {
      ...dependencies(),
      hooks: () => ({ ok: false, message: "Run yarn prepare." }),
    });
    expect(result.code).toBe(2);
    expect(
      result.checks.filter((c) => c.status === "FAIL").map((c) => c.name),
    ).toEqual(["Dependencies", "Git hooks"]);
  });

  test("validates Node and the pinned Yarn version independently", async () => {
    const result = await runDoctor(root, parseOptions([]), {
      ...dependencies(),
      nodeVersion: "20.19.0",
      run: () => ({ ok: true, stdout: "1.22.0" }),
    });
    expect(result.code).toBe(2);
    expect(
      result.checks.filter((c) => c.status === "FAIL").map((c) => c.name),
    ).toEqual(["Node", "Yarn"]);
  });

  test.each([
    ["22.0.0", false],
    ["22.11.99", false],
    ["22.12.0", true],
    ["22.13.0", true],
    ["23.0.0", false],
    ["24.0.0", true],
    ["25.0.0", false],
    ["26.0.0", true],
    ["27.0.0", true],
  ])("checks the supported Node boundary for %s", async (nodeVersion, ok) => {
    const result = await runDoctor(root, parseOptions([]), {
      ...dependencies(),
      nodeVersion,
    });
    expect(result.checks.find((check) => check.name === "Node").status).toBe(
      ok ? "PASS" : "FAIL",
    );
    expect(result.code).toBe(ok ? 0 : 2);
  });
});
