// Stop Node/Vite listeners on port 8080 without stopping unrelated services.
// --own restricts cleanup to the PID recorded by this checkout's Vite config;
// linked worktrees always use that restriction. Missing servers are a no-op,
// while failed inspection or stopping returns a nonzero exit status.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isLinkedWorktree } = require('./worktree');

const DEV_SERVER_PIDFILE = path.resolve(__dirname, '..', 'node_modules', '.cache', 'pttchrome-dev-server.pid');

const PORT = 8080;
const isWin = process.platform === 'win32';

function run(file, args) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  }).toString().trim();
}

// 解析「正在 listen PORT 的 PID」清單（純函式，unit test 守護：
// tests/unit/kill_dev_server_parse.test.js）。
//   netstat 行範例（Windows）：
//     TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    12345
//     TCP    [::1]:8080      [::]:0       LISTENING    12345
//   lsof（非 Windows，已加 -t -sTCP:LISTEN）：一行一個 PID。
//
// **本機位址一定要連 IPv6 一起看**：Vite 在 Windows 只綁 `[::1]:8080`，而
// `netstat -ano -p tcp` 只列 IPv4 → 舊版在這裡回空清單，`yarn kill:dev` 靜默
// 沒殺到任何東西（腳本一律 exit 0，連錯誤都不會冒出來）。故改用不帶 `-p` 的
// `netstat -ano`（IPv4+IPv6 全列），並在這裡自行篩 TCP/LISTENING。
function parseListeningPids(out, port, { lsof = false } = {}) {
  const pids = new Set();
  for (const raw of String(out).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (lsof) {
      if (/^[1-9]\d*$/.test(line)) pids.add(line);
      continue;
    }
    if (!/^TCP\b/i.test(line)) continue;
    if (!/\bLISTENING\b/i.test(line)) continue;
    const cols = line.split(/\s+/);
    // 本機位址（cols[1]）的埠必須正好是 port——用整行比對會誤中遠端位址與
    // 「18080 / 80800」這種相鄰數字。
    const local = cols[1] || '';
    if (local.slice(local.lastIndexOf(':') + 1) !== String(port)) continue;
    const pid = cols[cols.length - 1];
    if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }
  return [...pids];
}

// 從 listen 中的 PID 挑出要砍的（純函式，守護 tests/unit/kill_dev_server_parse.test.js）。
// ownOnly 時只留 pidfile 記的那一個；pidfile 不存在 ⇒ 本 checkout 沒起過 server ⇒ 一個都不砍。
function selectPidsToKill(pids, { ownOnly = false, ownPid = null } = {}) {
  if (!ownOnly) return pids;
  if (!ownPid) return [];
  return pids.filter((pid) => String(pid) === String(ownPid).trim());
}

function readOwnPid() {
  try {
    const pid = fs.readFileSync(DEV_SERVER_PIDFILE, 'utf8').trim();
    if (!/^[1-9]\d*$/.test(pid)) throw new Error('Invalid development-server PID file');
    return pid;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function findListeningPids() {
  if (isWin) return parseListeningPids(run('netstat', ['-ano']), PORT);
  try {
    return parseListeningPids(run('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN']), PORT, { lsof: true });
  } catch (error) {
    // lsof exits 1 with empty output when no matching listener exists.
    if (error.status === 1 && !String(error.stdout || '').trim() && !String(error.stderr || '').trim()) return [];
    throw error;
  }
}

function isDevServer(pid) {
  if (isWin) {
    const out = run('powershell', [
      '-NoProfile', '-Command',
      `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object Name,CommandLine | ConvertTo-Json -Compress`,
    ]);
    const details = JSON.parse(out);
    return /^node(?:\.exe)?$/i.test(details.Name) && hasViteCommand(details.CommandLine || '');
  }
  // Unlimited width keeps Vite visible even under long dependency paths.
  const command = run('ps', ['-ww', '-p', pid, '-o', 'args=']);
  // Linux exposes the real executable even when Node changes its process title.
  const executable = process.platform === 'linux'
    ? fs.realpathSync(`/proc/${pid}/exe`)
    : run('ps', ['-ww', '-p', pid, '-o', 'comm=']);
  return /(?:^|[\\/])node(?:\.exe)?$/i.test(executable) && hasViteCommand(command);
}

function hasViteCommand(command) {
  return /(?:^|[\\/\s"])vite(?:\.js)?(?:[\\/\s"]|$)/i.test(command);
}

function kill(pid) {
  if (isWin) run('taskkill', ['/PID', pid, '/T', '/F']);
  else process.kill(Number(pid), 'SIGKILL');
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!findListeningPids().includes(pid)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`Development server still listens on :${PORT} (pid ${pid})`);
}

function main() {
  let pids;
  const ownOnly = process.argv.includes('--own') || isLinkedWorktree();
  try {
    const ownPid = ownOnly ? readOwnPid() : null;
    if (ownOnly && !ownPid) return 0;
    pids = selectPidsToKill(findListeningPids(), { ownOnly, ownPid });
  } catch (e) {
    console.error(`Unable to inspect development servers: ${e.message}`);
    return 1;
  }

  let exitCode = 0;
  for (const pid of pids) {
    try {
      if (isDevServer(pid)) {
        kill(pid);
        console.log(`killed stale dev server on :${PORT} (pid ${pid})`);
      } else if (ownOnly) {
        console.error(`The recorded development-server PID is listening but is not Node/Vite (pid ${pid}); leaving it untouched`);
        exitCode = 1;
      } else {
        console.log(`Leaving unrelated listener on :${PORT} untouched (pid ${pid})`);
      }
    } catch (e) {
      console.error(`Unable to stop development server (pid ${pid}): ${e.message}`);
      exitCode = 1;
    }
  }
  return exitCode;
}

// Importing parser helpers must not execute cleanup.
if (require.main === module) {
  process.exitCode = main();
}

module.exports = { parseListeningPids, selectPidsToKill, DEV_SERVER_PIDFILE };
