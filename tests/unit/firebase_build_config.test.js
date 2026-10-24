import configFactory from "../../vite.config.mjs";
import { build } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

afterEach(() => vi.unstubAllEnvs());

test("injects only the configured browser key and excludes App Check debug bypasses from production", () => {
  vi.stubEnv("FIREBASE_API_KEY", "public-browser-test-key");
  vi.stubEnv("APPCHECK_DEBUG_TOKEN", "private-debug-test-token");
  const config = configFactory({ command: "build", mode: "production" });
  expect(config.define["process.env.FIREBASE_API_KEY"]).toBe('"public-browser-test-key"');
  expect(config.define["process.env.APPCHECK_DEBUG_TOKEN"]).toBe("undefined");
  expect(JSON.stringify(config)).not.toContain("private-debug-test-token");
});

test("rejects a production build without the configured browser key", () => {
  vi.stubEnv("FIREBASE_API_KEY", "");
  expect(() => configFactory({ command: "build", mode: "production" }))
    .toThrow("FIREBASE_API_KEY is required");
});

test("keeps offline development available without a cloud key", () => {
  vi.stubEnv("FIREBASE_API_KEY", "");
  vi.stubEnv("APPCHECK_DEBUG_TOKEN", "development-only-test-token");
  const config = configFactory({ command: "serve", mode: "development" });
  expect(config.define["process.env.FIREBASE_API_KEY"]).toBe('""');
  expect(config.define["process.env.APPCHECK_DEBUG_TOKEN"]).toBe('"development-only-test-token"');
});

test("the built client uses the supplied browser key and excludes the debug bypass canary", async () => {
  const browserKey = "client-build-browser-canary";
  const debugToken = "client-build-private-debug-canary";
  vi.stubEnv("FIREBASE_API_KEY", browserKey);
  vi.stubEnv("APPCHECK_DEBUG_TOKEN", debugToken);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pttchrome-client-build-"));
  try {
    const config = configFactory({ command: "build", mode: "production" });
    await build({
      ...config,
      configFile: false,
      logLevel: "silent",
      build: {
        ...config.build,
        outDir,
        sourcemap: true,
        lib: {
          entry: {
            config: path.resolve("src/js/firebase_config.js"),
            sync: path.resolve("src/js/pref_sync.js"),
          },
          formats: ["es"],
          fileName: (_format, name) => name + ".mjs",
        },
      },
    });
    const files = fs.readdirSync(outDir, { recursive: true })
      .filter(file => /\.(?:m?js|map)$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(fs.readFileSync(path.join(outDir, file), "utf8")).not.toContain(debugToken);
    }
    const configUrl = pathToFileURL(path.join(outDir, "config.mjs")).href;
    const value = execFileSync(process.execPath, [
      "--input-type=module", "-e",
      "const { FIREBASE_CONFIG } = await import(" + JSON.stringify(configUrl) + "); process.stdout.write(FIREBASE_CONFIG.apiKey);",
    ], { encoding: "utf8" });
    expect(value).toBe(browserKey);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}, 20000);
