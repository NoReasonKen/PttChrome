// Canary evidence belongs to one active agent session and one hook configuration.
// It is a workflow receipt, not a tamper-proof security boundary.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const INPUTS_MANIFEST = ".codex/agent-inputs.json";
const HOOK_FILES = [".codex/hooks.json", ".codex/hooks/guard-bash.sh", "scripts/check-agent-hooks.mjs"];
const CANARY = /^node scripts\/check-agent-hooks\.mjs --canary (allow|block) ([a-f0-9]{32})$/;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const identity = (env) => hash(env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || "");
const hasSession = (env) => !!(env.CODEX_SESSION_ID || env.CODEX_THREAD_ID);

function configuration(root) {
  return hash(HOOK_FILES.map((name) => fs.readFileSync(path.join(root, name))).join("\0"));
}

export function agentHookReceiptPath(root) {
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
  }).trim();
  return path.join(gitDir, "verification", "agent-hook.json");
}

function readReceipt(root) {
  return JSON.parse(fs.readFileSync(agentHookReceiptPath(root), "utf8"));
}

function writeReceipt(root, receipt) {
  const destination = agentHookReceiptPath(root);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
}

function currentReceipt(root, env, now) {
  let receipt;
  try { receipt = readReceipt(root); }
  catch { throw new Error("Canary receipt is missing or unreadable; prepare it again."); }
  if (receipt.schemaVersion !== 1) throw new Error("Canary receipt schema is unsupported; prepare it again.");
  if (!hasSession(env)) throw new Error("Canary process has no session environment.");
  if (receipt.identity !== identity(env)) throw new Error("Canary session identity differs from the prepared session.");
  if (receipt.configuration !== configuration(root)) throw new Error("Canary hook configuration or handler changed; prepare it again.");
  if (!Number.isFinite(receipt.createdAt) || now < receipt.createdAt || now - receipt.createdAt > MAX_AGE_MS)
    throw new Error("Canary evidence expired or has an invalid timestamp; prepare it again.");
  return receipt;
}

export function inspectAgentDocuments(root) {
  let paths;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, INPUTS_MANIFEST), "utf8"));
    paths = manifest?.paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((name) =>
      typeof name !== "string" || !name || name.trim() !== name || /[\\\0\r\n]/.test(name) ||
      path.isAbsolute(name) || path.win32.isAbsolute(name) || /^[a-z]:/i.test(name) ||
      name.split("/").some((part) => part === ".." || part === ".")))
      throw new Error("Invalid input paths.");
  } catch {
    return { ok: false, message: `${INPUTS_MANIFEST} is missing or invalid. Run local worktree setup to restore its checkout-relative input list.` };
  }
  const missing = paths.filter((name) => {
    try {
      const target = path.join(root, name);
      fs.accessSync(target, fs.constants.R_OK);
      const stat = fs.statSync(target);
      return !stat.isFile() && !stat.isDirectory();
    }
    catch { return true; }
  });
  return {
    ok: missing.length === 0,
    message: missing.length ? `Missing or unreadable agent inputs: ${missing.join(", ")}. Run the worktree setup script.` :
      "Configured agent inputs are readable; this does not establish runtime hook enforcement.",
  };
}

export function inspectAgentHooks(root, { env = process.env, now = Date.now() } = {}) {
  const unverified = (message) => ({ ok: false, status: "UNVERIFIED", message });
  try { configuration(root); }
  catch { return unverified("Agent hook configuration is missing or unreadable. File/Git-hook checks do not verify the agent command channel."); }
  try {
    const receipt = currentReceipt(root, env, now);
    if (receipt.blockExecuted)
      return { ok: false, message: "The blocking canary reached the shell. Review hook loading/trust before relying on the agent guard." };
    if (!/^[a-f0-9]{64}$/.test(receipt.allowObserved || "") || receipt.allowExecuted !== true ||
        !/^[a-f0-9]{64}$/.test(receipt.blockObserved || "") ||
        receipt.allowObserved === receipt.blockObserved)
      return unverified("Hook files are readable; both actual-tool canaries have not been observed. Run node scripts/check-agent-hooks.mjs --prepare and issue its two commands through the agent tool.");
    return { ok: true, message: "The allowed canary ran and the blocking canary was intercepted in this agent session with the current hook configuration." };
  } catch {
    return unverified("Hook files are readable; runtime enforcement has no current session-bound evidence. Run node scripts/check-agent-hooks.mjs --prepare and issue its two commands through the agent tool.");
  }
}

export function prepareAgentHookCanaries(root, { env = process.env, now = Date.now() } = {}) {
  if (!hasSession(env)) throw new Error("Prepare canaries inside the agent session being verified.");
  const nonce = randomBytes(16).toString("hex");
  writeReceipt(root, { schemaVersion: 1, nonce, identity: identity(env), configuration: configuration(root), createdAt: now });
  return ["allow", "block"].map((action) => `node scripts/check-agent-hooks.mjs --canary ${action} ${nonce}`);
}

export function observeAgentHookCanary(root, event, { now = Date.now() } = {}) {
  const match = CANARY.exec(event?.tool_input?.command || "");
  if (!match) return { matched: false, code: 0 };
  if (event.hook_event_name !== "PreToolUse" || event.tool_name !== "Bash" ||
      typeof event.session_id !== "string" || !event.session_id ||
      typeof event.tool_use_id !== "string" || !event.tool_use_id || event.tool_use_id.length > 200)
    throw new Error("The canary hook event does not match the prepared agent session.");
  // Hook processes may have no CODEX_* environment. Their original host event
  // supplies the same canonical session identity used by the shell canaries.
  const receipt = currentReceipt(root, { CODEX_THREAD_ID: event.session_id }, now);
  if (receipt.nonce !== match[2]) throw new Error("The canary challenge has changed; prepare it again.");
  receipt[`${match[1]}Observed`] = hash(event.tool_use_id);
  writeReceipt(root, receipt);
  return { matched: true, code: match[1] === "block" ? 2 : 0 };
}

export function executeAgentHookCanary(root, action, nonce, { env = process.env, now = Date.now() } = {}) {
  if (!["allow", "block"].includes(action) || !/^[a-f0-9]{32}$/.test(nonce || ""))
    throw new Error("Use one of the exact canary commands printed by --prepare.");
  const receipt = currentReceipt(root, env, now);
  if (receipt.nonce !== nonce) throw new Error("The canary challenge has changed; prepare it again.");
  receipt[`${action}Executed`] = true;
  writeReceipt(root, receipt);
  return action === "allow" ? { code: 0, message: "Allowed canary executed; check the separate hook evidence with yarn doctor --agent." } :
    { code: 2, message: "NOT_BLOCKED: the harmless blocking canary reached the shell. Runtime guard enforcement is not verified." };
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  if (args.length === 1 && args[0] === "--prepare") {
    console.log("Issue these as separate commands through the actual agent tool, using this checkout as its working directory:");
    for (const command of prepareAgentHookCanaries(root)) console.log(command);
    return 0;
  }
  if (args.length === 1 && args[0] === "--observe") {
    const result = observeAgentHookCanary(root, JSON.parse(fs.readFileSync(0, "utf8")));
    if (result.code === 2) console.error("Blocked: agent-hook canary intercepted before command execution.");
    return result.code;
  }
  if (args.length === 3 && args[0] === "--canary") {
    const result = executeAgentHookCanary(root, args[1], args[2]);
    console.log(result.message);
    return result.code;
  }
  throw new Error("Use --prepare, --canary <allow|block> <nonce>, or --observe (hook handler only).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
