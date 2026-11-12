import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  inspectAgentDocuments, inspectAgentHooks, prepareAgentHookCanaries,
  observeAgentHookCanary, executeAgentHookCanary,
} from "../../scripts/check-agent-hooks.mjs";

// These fixture events exercise evidence validation; they never verify the host's hook loading.
const env = { CODEX_SESSION_ID: "fixture-session", CODEX_THREAD_ID: "fixture-thread", CODEX_VERSION: "fixture-version" };
const now = 10000;
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pttchrome-agent-hooks-"));
  execFileSync("git", ["init", "--quiet", root]);
  fs.mkdirSync(path.join(root, ".codex/hooks"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, ".codex/hooks.json"), "{}");
  fs.writeFileSync(path.join(root, ".codex/hooks/guard-bash.sh"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(root, "scripts/check-agent-hooks.mjs"), "// fixture handler\n");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function prepare() {
  const commands = prepareAgentHookCanaries(root, { env, now });
  return { commands, nonce: commands[0].split(" ").at(-1) };
}

function event(command, toolUse = "allow-tool") {
  return { hook_event_name: "PreToolUse", tool_name: "Bash", session_id: env.CODEX_THREAD_ID,
    tool_use_id: toolUse, tool_input: { command } };
}

function observedPair() {
  const { commands, nonce } = prepare();
  observeAgentHookCanary(root, event(commands[0]), { env, now });
  executeAgentHookCanary(root, "allow", nonce, { env, now });
  observeAgentHookCanary(root, event(commands[1], "block-tool"), { env, now });
  return { commands, nonce };
}

test("reports agent inputs independently from readable hook files", () => {
  expect(inspectAgentDocuments(root)).toMatchObject({ ok: false, message: expect.stringContaining("local worktree setup") });
  fs.mkdirSync(path.join(root, "guidance"));
  for (const name of ["instructions.md", "vocabulary.md"])
    fs.writeFileSync(path.join(root, name), "fixture");
  fs.writeFileSync(path.join(root, ".codex/agent-inputs.json"), JSON.stringify({ paths: ["instructions.md", "vocabulary.md", "guidance"] }));
  expect(inspectAgentDocuments(root).ok).toBe(true);
  expect(inspectAgentHooks(root, { env, now }).status).toBe("UNVERIFIED");
  fs.rmSync(path.join(root, "vocabulary.md"));
  expect(inspectAgentDocuments(root)).toMatchObject({ ok: false, message: expect.stringContaining("vocabulary.md") });
});

test.each([
  null, [], ["instructions.md"], {}, { paths: [] }, { paths: [42] },
  { paths: ["/outside.md"] }, { paths: ["../outside.md"] },
  { paths: ["guidance/../../outside.md"] }, { paths: ["./instructions.md"] },
  { paths: ["C:\\outside.md"] }, { paths: ["C:outside.md"] },
  { paths: ["guidance\\outside.md"] }, { paths: [""] },
])("rejects malformed or non-relative local input manifests (%j)", (manifest) => {
  fs.writeFileSync(path.join(root, ".codex/agent-inputs.json"), JSON.stringify(manifest));
  expect(inspectAgentDocuments(root)).toMatchObject({ ok: false, message: expect.stringContaining("missing or invalid") });
});

test("reports malformed JSON separately from unverified hook configuration", () => {
  fs.writeFileSync(path.join(root, ".codex/agent-inputs.json"), "{");
  expect(inspectAgentDocuments(root).ok).toBe(false);
  fs.rmSync(path.join(root, ".codex/hooks.json"));
  expect(inspectAgentHooks(root, { env, now }).status).toBe("UNVERIFIED");
});

test("does not count canary commands reaching the shell as hook enforcement", () => {
  const { nonce } = prepare();
  expect(executeAgentHookCanary(root, "allow", nonce, { env, now }).code).toBe(0);
  expect(inspectAgentHooks(root, { env, now }).status).toBe("UNVERIFIED");
  expect(executeAgentHookCanary(root, "block", nonce, { env, now })).toMatchObject({ code: 2, message: expect.stringContaining("NOT_BLOCKED") });
  expect(inspectAgentHooks(root, { env, now })).toMatchObject({ ok: false, message: expect.stringContaining("reached the shell") });
});

test("requires the allowed command to run and the blocking command to remain unexecuted", () => {
  const { commands, nonce } = prepare();
  expect(observeAgentHookCanary(root, event(commands[0]), { env, now }).code).toBe(0);
  expect(observeAgentHookCanary(root, event(commands[1], "block-tool"), { env, now }).code).toBe(2);
  expect(inspectAgentHooks(root, { env, now }).status).toBe("UNVERIFIED");
  executeAgentHookCanary(root, "allow", nonce, { env, now });
  expect(inspectAgentHooks(root, { env, now }).ok).toBe(true);
  executeAgentHookCanary(root, "block", nonce, { env, now });
  expect(inspectAgentHooks(root, { env, now }).ok).toBe(false);
});

test("invalidates evidence when the session, hook configuration, or time changes", () => {
  observedPair();
  expect(inspectAgentHooks(root, { env, now }).ok).toBe(true);
  expect(inspectAgentHooks(root, { env: { ...env, CODEX_THREAD_ID: "other-thread" }, now }).status).toBe("UNVERIFIED");
  expect(inspectAgentHooks(root, { env, now: now + 2 * 60 * 60 * 1000 + 1 }).status).toBe("UNVERIFIED");
  fs.appendFileSync(path.join(root, ".codex/hooks/guard-bash.sh"), "# changed\n");
  expect(inspectAgentHooks(root, { env, now }).status).toBe("UNVERIFIED");
});

test("rejects unrelated events and mismatched canary identities", () => {
  const { commands } = prepare();
  expect(observeAgentHookCanary(root, event("node --version"), { env, now })).toEqual({ matched: false, code: 0 });
  for (const override of [{ tool_name: "apply_patch" }, { tool_use_id: "" }, { hook_event_name: "PostToolUse" }]) {
    expect(() => observeAgentHookCanary(root, { ...event(commands[0]), ...override }, { env, now })).toThrow("does not match");
  }
  expect(inspectAgentHooks(root, { env, now }).status).toBe("UNVERIFIED");
  expect(() => executeAgentHookCanary(root, "allow", "0".repeat(32), { env, now })).toThrow("challenge has changed");
});

test("requires two distinct hook tool events and a current agent session", () => {
  const { commands, nonce } = prepare();
  observeAgentHookCanary(root, event(commands[0]), { env, now });
  executeAgentHookCanary(root, "allow", nonce, { env, now });
  observeAgentHookCanary(root, event(commands[1]), { env, now });
  expect(inspectAgentHooks(root, { env, now }).status).toBe("UNVERIFIED");
  expect(inspectAgentHooks(root, { env: {}, now }).status).toBe("UNVERIFIED");
  expect(() => prepareAgentHookCanaries(root, { env: {}, now })).toThrow("inside the agent session");
});

test("uses the original hook event when its process has no session environment", () => {
  const { commands, nonce } = prepare();
  expect(observeAgentHookCanary(root, event(commands[0]), { env: {}, now }).code).toBe(0);
  executeAgentHookCanary(root, "allow", nonce, { env, now });
  expect(observeAgentHookCanary(root, event(commands[1], "block-tool"), { env: {}, now }).code).toBe(2);
  expect(inspectAgentHooks(root, { env, now }).ok).toBe(true);
});

test("rejects a different event session without exposing its identity", () => {
  const { commands } = prepare();
  try {
    observeAgentHookCanary(root, { ...event(commands[0]), session_id: "private-different-value" }, { env: {}, now });
    throw new Error("Expected session mismatch.");
  } catch (error) {
    expect(error.message).toContain("session identity differs");
    expect(error.message).not.toContain("private-different-value");
  }
  expect(inspectAgentHooks(root, { env, now }).status).toBe("UNVERIFIED");
});

test("binds shell commands to the canonical thread with a session fallback", () => {
  const { nonce } = prepare();
  expect(executeAgentHookCanary(root, "allow", nonce, { env: { CODEX_SESSION_ID: env.CODEX_THREAD_ID }, now }).code).toBe(0);
  expect(executeAgentHookCanary(root, "allow", nonce, { env: { ...env, CODEX_SESSION_ID: "changed-process", CODEX_VERSION: "other-version" }, now }).code).toBe(0);
  expect(() => executeAgentHookCanary(root, "allow", nonce, { env: { ...env, CODEX_THREAD_ID: "other-thread" }, now })).toThrow("session identity differs");
});
