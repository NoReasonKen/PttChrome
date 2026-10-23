import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scriptPath = path.resolve("scripts/kill-dev-server.js");
const source = fs.readFileSync(scriptPath, "utf8");

// Execute the CLI entry point, including process inspection, stopping, and status reporting.
function runCleanup({
  platform = "linux",
  ownOnly = false,
  worktree = false,
  ownPid = "123",
  listeners = ["123"],
  command = `node /workspace/${"nested/".repeat(30)}node_modules/vite/bin/vite.js --host`,
  executable = "/usr/bin/node",
  queryError = false,
  inspectError = false,
  killError = false,
  staysListening = false,
  noMatchExit = false,
} = {}) {
  let active = [...listeners];
  const stopped = [];
  const output = [];
  const errors = [];
  const calls = [];
  const commandOptions = [];
  const proc = {
    platform,
    argv: ["node", scriptPath, ...(ownOnly ? ["--own"] : [])],
    exitCode: 0,
    exit(code) { this.exitCode = code; },
    kill(pid, signal) {
      if (signal === 0) return;
      stop(String(pid));
    },
  };
  function stop(pid) {
    if (killError) throw new Error("Permission denied");
    stopped.push(pid);
    if (!staysListening) active = active.filter((value) => value !== pid);
  }
  function execute(file, args = [], options = {}) {
    args = Array.isArray(args) ? args : [];
    calls.push([file, args]);
    commandOptions.push(options);
    const text = [file, ...args].join(" ");
    if (/lsof|netstat/.test(text)) {
      if (queryError) throw Object.assign(new Error("query unavailable"), { code: "ENOENT" });
      if (noMatchExit && !active.length) throw Object.assign(new Error("no matches"), { status: 1, stdout: "", stderr: "" });
      return platform === "win32"
        ? active.map((pid) => `TCP [::1]:8080 [::]:0 LISTENING ${pid}`).join("\n")
        : active.join("\n");
    }
    if (/ps|powershell/.test(text)) {
      if (inspectError) throw new Error("inspection unavailable");
      if (file === "powershell" && text.includes("ConvertTo-Json")) {
        return JSON.stringify({ Name: path.basename(executable) === "node" ? "node.exe" : "java.exe", CommandLine: command });
      }
      if (file === "ps" && args.includes("comm=")) return executable;
      return /ps/.test(text) && !text.includes("-ww") ? command.slice(0, 80) : command;
    }
    if (/taskkill|kill/.test(text)) {
      stop(text.match(/(?:\/PID|kill -9)\s+(\d+)/)?.[1]);
      return "";
    }
    throw new Error(`Unexpected command: ${text}`);
  }
  const module = { exports: {} };
  const requireMock = (name) => {
    if (name === "child_process") return { execSync: execute, execFileSync: execute };
    if (name === "fs") return {
      readFileSync: () => {
        if (ownPid === null) throw Object.assign(new Error("no PID file"), { code: "ENOENT" });
        return ownPid;
      },
      realpathSync: () => executable,
    };
    if (name === "path") return path;
    if (name === "./worktree") return { isLinkedWorktree: () => worktree };
    throw new Error(`Unexpected require: ${name}`);
  };
  requireMock.main = module;
  vm.runInNewContext(source, {
    require: requireMock,
    module,
    __dirname: path.dirname(scriptPath),
    process: proc,
    console: { log: (message) => output.push(message), error: (message) => errors.push(message) },
    Atomics: { wait: () => {} },
    SharedArrayBuffer,
    Int32Array,
  });
  return { stopped, output, errors, calls, commandOptions, exitCode: proc.exitCode };
}

describe("development-server cleanup CLI", () => {
  test("stops a Node/Vite listener with a command longer than the terminal width", () => {
    const result = runCleanup();
    expect(result.stopped).toEqual(["123"]);
    expect(result.exitCode).toBe(0);
    expect(result.output.join("\n")).toContain("killed");
  });

  test("recognizes a Vite process title through its Node executable", () => {
    const result = runCleanup({ command: "vite (v8.0.0)" });
    expect(result.stopped).toEqual(["123"]);
    expect(result.exitCode).toBe(0);
  });

  test("reports a stop failure without claiming that the server was killed", () => {
    const result = runCleanup({ command: "node vite", killError: true });
    expect(result.exitCode).toBe(1);
    expect(result.output.join("\n")).not.toContain("killed");
    expect(result.errors.join("\n")).toContain("Permission denied");
  });

  test("reports a listener that survives the stop command", () => {
    const result = runCleanup({ command: "node vite", staysListening: true });
    expect(result.exitCode).toBe(1);
    expect(result.output.join("\n")).not.toContain("killed");
  });

  test("reports missing listener-query tools instead of treating failure as no listeners", () => {
    const result = runCleanup({ queryError: true });
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toContain("query unavailable");
    expect(result.stopped).toEqual([]);
  });

  test("reports failed process inspection without stopping an unidentified listener", () => {
    const result = runCleanup({ inspectError: true });
    expect(result.exitCode).toBe(1);
    expect(result.stopped).toEqual([]);
  });

  test("leaves an unrelated service untouched", () => {
    const result = runCleanup({ executable: "/usr/bin/java", command: "java -jar vite.jar" });
    expect(result.exitCode).toBe(0);
    expect(result.stopped).toEqual([]);
  });

  test("does not identify an unrelated Node command from the word invite", () => {
    const result = runCleanup({ command: "node /workspace/invite/server.js" });
    expect(result.exitCode).toBe(0);
    expect(result.stopped).toEqual([]);
  });

  test("own mode leaves another checkout's listener untouched", () => {
    const result = runCleanup({ ownOnly: true, ownPid: "999" });
    expect(result.exitCode).toBe(0);
    expect(result.stopped).toEqual([]);
  });

  test("own mode stops only the recorded listener", () => {
    const result = runCleanup({ ownOnly: true, listeners: ["123", "456"] });
    expect(result.exitCode).toBe(0);
    expect(result.stopped).toEqual(["123"]);
  });

  test("reports an owned listener that no longer identifies as Node/Vite without stopping it", () => {
    const result = runCleanup({ ownOnly: true, executable: "/usr/bin/java", command: "java server.jar" });
    expect(result.exitCode).toBe(1);
    expect(result.stopped).toEqual([]);
    expect(result.errors.join("\n")).toContain("recorded");
  });

  test("linked worktrees automatically restrict cleanup to their recorded PID", () => {
    const result = runCleanup({ worktree: true, ownPid: "999" });
    expect(result.exitCode).toBe(0);
    expect(result.stopped).toEqual([]);
  });

  test("own mode is a no-op without a recorded PID", () => {
    const result = runCleanup({ ownOnly: true, ownPid: null, queryError: true });
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.stopped).toEqual([]);
  });

  test("succeeds silently when no server is listening", () => {
    const result = runCleanup({ listeners: [] });
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual([]);
  });

  test("accepts lsof's empty status 1 as no matching listener", () => {
    const result = runCleanup({ listeners: [], noMatchExit: true });
    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("checks the executable on macOS when Vite uses a process title", () => {
    const result = runCleanup({ platform: "darwin", command: "vite (v8.0.0)" });
    expect(result.exitCode).toBe(0);
    expect(result.stopped).toEqual(["123"]);
  });

  test("rejects an invalid recorded PID without inspecting or stopping listeners", () => {
    const result = runCleanup({ ownOnly: true, ownPid: "123; other-command" });
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.stopped).toEqual([]);
  });

  test("stops an IPv6 listener on Windows using separate command arguments", () => {
    const result = runCleanup({ platform: "win32" });
    expect(result.exitCode).toBe(0);
    expect(result.stopped).toEqual(["123"]);
    expect(result.calls).toContainEqual(["taskkill", ["/PID", "123", "/T", "/F"]]);
  });

  test("does not stop a Windows service merely because its arguments mention Node and Vite", () => {
    const result = runCleanup({ platform: "win32", executable: "/usr/bin/java", command: "java node vite" });
    expect(result.exitCode).toBe(0);
    expect(result.stopped).toEqual([]);
  });

  test("reports a Windows taskkill failure without claiming success", () => {
    const result = runCleanup({ platform: "win32", killError: true });
    expect(result.exitCode).toBe(1);
    expect(result.output.join("\n")).not.toContain("killed");
  });

  test.each(["linux", "win32"])("bounds every OS command on %s with a finite timeout", (platform) => {
    const result = runCleanup({ platform });
    expect(result.exitCode).toBe(0);
    expect(result.commandOptions.length).toBeGreaterThan(0);
    for (const options of result.commandOptions) {
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(5000);
    }
  });
});
