import configFactory from "../../vite.config.mjs";

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
