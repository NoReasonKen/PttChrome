import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reportFailedJobs } from "../../scripts/ci-status.mjs";

const repo = "example/client";
const run = { id: 12, name: "Test", head_sha: "a".repeat(40), run_attempt: 1, status: "in_progress" };
const job = { id: 34, name: "test / offline", status: "completed", conclusion: "failure" };
let directory;
let cacheFile;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "ci-failure-dedup-"));
  cacheFile = path.join(directory, "state.json.failures.json");
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fixture({ jobs = [job], log = "AssertionError: expected true, received false" } = {}) {
  const write = vi.fn();
  const request = vi.fn(async url => url.endsWith("/logs") ? log : { jobs });
  return { repo, cacheFile, write, request };
}
const logRequests = options => options.request.mock.calls.filter(([url]) => url.endsWith("/logs"));

test("repeated snapshots fetch and print a failed job once while other work runs", async () => {
  const options = fixture();
  const runs = [run, { ...run, id: 56, name: "CodeQL", status: "in_progress" }];
  // CodeQL is still running and has no failed job.
  options.request.mockImplementation(async url => url.endsWith("/56/jobs") ? { jobs: [] } :
    url.endsWith("/logs") ? "AssertionError: expected true" : { jobs: [job] });
  expect(await reportFailedJobs(runs, options)).toEqual([]);
  const printed = options.write.mock.calls.length;
  // A new invocation reads persisted metadata, as the local polling wrapper does.
  expect(await reportFailedJobs(runs, { ...options })).toEqual([]);
  expect(logRequests(options)).toHaveLength(1);
  expect(options.write).toHaveBeenCalledTimes(printed);
  expect(options.request.mock.calls.filter(([url]) => url.endsWith("/jobs"))).toHaveLength(4);
});

test("new attempts, jobs, runs, sources and repositories get their own diagnostics", async () => {
  const options = fixture();
  await reportFailedJobs([run], options);
  for (const changed of [
    { ...run, run_attempt: 2 },
    { ...run, id: 13 },
    { ...run, head_sha: "b".repeat(40) },
  ]) await reportFailedJobs([changed], options);
  await reportFailedJobs([run], { ...options, repo: "example/other" });
  options.request.mockImplementation(async url => url.endsWith("/logs") ? "Error: another failure" :
    { jobs: [job, { ...job, id: 35 }] });
  await reportFailedJobs([run], options);
  expect(logRequests(options)).toHaveLength(6);
});

test("a cached infrastructure diagnosis remains available for the existing retry policy", async () => {
  const integration = { ...job, name: "test / test-integration" };
  const options = fixture({ jobs: [integration], log: "firestore emulator not ready in 60000ms" });
  const expected = [{ runId: run.id, name: integration.name }];
  expect(await reportFailedJobs([run], options)).toEqual(expected);
  expect(await reportFailedJobs([run], options)).toEqual(expected);
  expect(logRequests(options)).toHaveLength(1);
});

test("an unavailable log is retried on the next snapshot instead of being hidden", async () => {
  const options = fixture();
  let unavailable = true;
  options.request.mockImplementation(async url => {
    if (!url.endsWith("/logs")) return { jobs: [job] };
    if (unavailable) throw new Error("log not ready");
    return "AssertionError: actual test failure";
  });
  await reportFailedJobs([run], options);
  unavailable = false;
  await reportFailedJobs([run], options);
  await reportFailedJobs([run], options);
  expect(logRequests(options)).toHaveLength(2);
  expect(options.write).toHaveBeenCalledWith("AssertionError: actual test failure");
});

test("an HTTP 404 from the real API adapter remains retryable until the log is available", async () => {
  vi.stubEnv("GH_TOKEN", "test-token");
  let unavailable = true;
  const fetch = vi.fn(async url => {
    if (!url.endsWith("/logs")) return new Response(JSON.stringify({ jobs: [job] }));
    return unavailable
      ? new Response("Not Found", { status: 404, statusText: "Not Found" })
      : new Response("AssertionError: delayed job log");
  });
  vi.stubGlobal("fetch", fetch);
  const options = { repo, cacheFile, write: vi.fn() };
  await reportFailedJobs([run], options);
  expect(fs.existsSync(cacheFile)).toBe(false);
  unavailable = false;
  await reportFailedJobs([run], options);
  await reportFailedJobs([run], options);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/logs"))).toHaveLength(2);
  expect(options.write).toHaveBeenCalledWith("AssertionError: delayed job log");
});

test.each(["{broken", JSON.stringify({ schemaVersion: 99, reported: {} })])(
  "unreadable or unsupported metadata cannot suppress a failure: %s", async contents => {
    fs.writeFileSync(cacheFile, contents);
    const options = fixture();
    await reportFailedJobs([run], options);
    await reportFailedJobs([run], options);
    expect(logRequests(options)).toHaveLength(1);
  },
);

test("metadata stores no raw or summarized logs and output retains credential redaction", async () => {
  const options = fixture({ log: "AssertionError: unique-log-detail\npassword: private-canary" });
  await reportFailedJobs([run], options);
  const stored = fs.readFileSync(cacheFile, "utf8");
  expect(stored).not.toContain("unique-log-detail");
  expect(stored).not.toContain("private-canary");
  expect(options.write.mock.calls.flat().join("\n")).toContain("[REDACTED]");
  expect(options.write.mock.calls.flat().join("\n")).not.toContain("private-canary");
});

test("a standalone status check without a cache still prints its failure", async () => {
  const options = fixture();
  delete options.cacheFile;
  await reportFailedJobs([run], options);
  await reportFailedJobs([run], options);
  expect(logRequests(options)).toHaveLength(2);
});
