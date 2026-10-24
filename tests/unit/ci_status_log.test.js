import { isKnownFlaky, summarizeJobLog } from "../../scripts/ci-status.mjs";

test("keeps the failed test and assertion before artifact-upload output", () => {
  const log = [
    "Running 20 tests using 4 workers",
    "  1) [offline-mobile] article position restores after preview loading",
    "    Error: expect(received).toBeCloseTo(expected)",
    "    Expected: 201.5",
    "    Received: 201.03",
    "    at tests/e2e/offline/mobile_reading_restore.offline.spec.js:110:7",
    ...Array.from({ length: 80 }, (_, i) => `Uploading artifact chunk ${i}`),
    "Artifact uploaded successfully",
  ].join("\n");
  const result = summarizeJobLog(log);
  expect(result).toContain("article position restores after preview loading");
  expect(result).toContain("Expected: 201.5");
  expect(result).toContain("Received: 201.03");
  expect(result).toContain("mobile_reading_restore.offline.spec.js:110:7");
  expect(result).toContain("Artifact uploaded successfully");
  expect(result).not.toContain("Uploading artifact chunk 20");
});

test("retains setup and unit failures, with a tail fallback for unfamiliar output", () => {
  for (const failure of [
    "##[error]Process completed with exit code 1.",
    "AssertionError: expected 1 to be 2",
    "Error: browserType.launch: Firefox cannot start",
    "FAIL tests/unit/reading_position.test.js > preserves the image row fraction",
  ]) {
    expect(summarizeJobLog([failure, ...Array(80).fill("cleanup")].join("\n"))).toContain(failure);
  }
  expect(summarizeJobLog("first\nsecond\nlast")).toBe("first\nsecond\nlast");
  expect(summarizeJobLog("")).toBe("");
});

test("bounds many failures and giant lines instead of printing the complete log", () => {
  const log = Array.from({ length: 300 }, (_, i) => `Error: failure ${i} ${"x".repeat(4000)}`).join("\n");
  const result = summarizeJobLog(log);
  expect(result.length).toBeLessThanOrEqual(24000);
  expect(result).toContain("failure 0");
  expect(result).toContain("failure 299");
  expect(result.split("\n").length).toBeLessThanOrEqual(160);
  expect(result).toContain("omitted");
});

test("keeps both ends of an unusually long failure line", () => {
  const result = summarizeJobLog(`Error: request failed ${"x".repeat(4000)} received status 403`);
  expect(result.length).toBeLessThanOrEqual(180);
  expect(result).toContain("Error: request failed");
  expect(result).toContain("received status 403");
  expect(result).toContain("line truncated");
});

test("retains emulator startup diagnosis and removes terminal color codes", () => {
  const log = [
    "\u001b[31mFAIL\u001b[0m emulator startup",
    "firestore emulator not ready in 60000ms",
    ...Array(80).fill("Uploading artifact"),
  ].join("\n");
  const result = summarizeJobLog(log);
  expect(result).toContain("FAIL emulator startup");
  expect(result).not.toContain("\u001b");
  expect(isKnownFlaky("test / test-integration", result)).toBe(true);
});

test("redacts credentials before selecting error excerpts or their tail", () => {
  const token = ["ghp", "_", "a".repeat(36)].join("");
  const oauth = ["ya29", ".", "b".repeat(36)].join("");
  const log = [
    `Error: request failed Authorization: Bearer ${token}`,
    `Error: response ${token.slice(0, 12)}\u001b[31m${token.slice(12)}\u001b[0m`,
    `FIREBASE_API_KEY="${"browser-canary-value"}"`,
    ["client_secret", "oauth-canary&retry=false"].join("="),
    `access_token=${oauth}`,
    ["APPCHECK_DEBUG_TOKEN", "debug-canary-value"].join("="),
    `-----BEGIN ${"PRIVATE KEY"}-----`,
    "private-key-body-canary",
    `-----END ${"PRIVATE KEY"}-----`,
    ...Array(80).fill("Uploading artifact"),
    ["password", "password-canary-value"].join(": "),
  ].join("\n");
  const result = summarizeJobLog(log);
  for (const value of [token, oauth, "browser-canary-value", "oauth-canary", "debug-canary-value", "private-key-body-canary", "password-canary-value"]) {
    expect(result).not.toContain(value);
  }
  expect(result).toContain("[REDACTED]");
  expect(result).toContain("retry=false");
});
