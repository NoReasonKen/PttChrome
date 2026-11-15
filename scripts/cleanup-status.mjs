import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseWorktrees(text) {
  return text.split('\0\0').filter(Boolean).map((record) => {
    const fields = record.split('\0');
    const value = (key) => fields.find((field) => field.startsWith(`${key} `))?.slice(key.length + 1);
    return { path: value('worktree'), head: value('HEAD'), branch: value('branch')?.replace(/^refs\/heads\//, ''), prunable: fields.some((field) => field === 'prunable' || field.startsWith('prunable ')), locked: fields.some((field) => field === 'locked' || field.startsWith('locked ')) };
  });
}

export function classifyWorktree({ dirty, merged, protectedRoot, inUse, locked }) {
  const blockers = [dirty && 'uncommitted or untracked changes', protectedRoot && 'protected root', inUse && 'in-use root', locked && 'locked'].filter(Boolean);
  if (blockers.length) return `blocked: ${blockers.join(', ')}`;
  return merged ? 'clean and merged: review for archive' : null;
}

export function closingIssueNumbers(prs) {
  return [...new Set(prs.flatMap((pr) => (pr.closingIssuesReferences || []).map((issue) => issue.number)))];
}

export function collectStatus({ run, listDirectories, args = [] }) {
  const protectedRoots = new Set();
  const inUseRoots = new Set();
  let issues = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-issues') issues = false;
    else if (arg === '--json') continue;
    else if (arg === '--protected-root' || arg === '--in-use-root') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} requires a path`);
      (arg === '--protected-root' ? protectedRoots : inUseRoots).add(resolve(args[++i]));
    } else throw new Error(`Unknown option: ${arg}`);
  }
  const git = (...cmd) => run('git', cmd);
  const gh = (...cmd) => run('gh', cmd);
  const worktrees = parseWorktrees(git('worktree', 'list', '--porcelain', '-z'));
  if (!worktrees.length || !worktrees[0].path) throw new Error('No primary worktree returned by git');
  const primary = worktrees[0].path;
  const registered = new Set(worktrees.map((tree) => resolve(tree.path)));
  const prs = issues ? JSON.parse(gh('pr', 'list', '--repo', 'NoReasonKen/PttChrome', '--state', 'merged', '--limit', '60', '--json', 'number,headRefName,headRefOid,closingIssuesReferences')) : [];
  const merged = (ref) => {
    const cherry = git('cherry', 'origin/dev', ref);
    if (!cherry.split('\n').some((line) => line.startsWith('+ '))) return true;
    const candidates = prs.filter((pr) => pr.headRefName === ref.replace(/^origin\//, '') && pr.headRefOid);
    return candidates.length > 0 && candidates.some((pr) => pr.headRefOid === git('rev-parse', ref).trim());
  };
  const lines = [];
  for (const tree of worktrees.slice(1)) {
    const host = { protectedRoot: protectedRoots.has(resolve(tree.path)), inUse: inUseRoots.has(resolve(tree.path)), locked: tree.locked };
    if (tree.prunable) {
      const blockers = classifyWorktree(host);
      lines.push(`worktree ${tree.path}: missing or prunable metadata; review${blockers ? `; ${blockers}` : ''}`);
      continue;
    }
    const dirty = Boolean(git('-C', tree.path, 'status', '--porcelain', '--untracked-files=normal').trim());
    const state = classifyWorktree({ ...host, dirty, merged: merged(tree.branch || tree.head) });
    if (state) lines.push(`worktree ${tree.path} (${tree.branch || 'detached HEAD'}): ${state}`);
  }
  for (const path of listDirectories(primary)) if (!registered.has(resolve(path))) lines.push(`folder ${path} is not a worktree: review`);
  const checkedOut = new Set(worktrees.map((tree) => tree.branch).filter(Boolean));
  for (const [prefix, exclude] of [['refs/heads', ['dev', 'main']], ['refs/remotes/origin', ['origin', 'origin/HEAD', 'origin/dev', 'origin/main']]]) {
    for (const branch of git('for-each-ref', '--format=%(refname:short)', prefix).split('\n').filter(Boolean)) {
      if (!exclude.includes(branch) && merged(branch)) lines.push(`branch ${branch}: ${checkedOut.has(branch) ? 'checked out; review worktree' : 'merged; review'}`);
    }
  }
  const stale = git('remote', 'prune', '--dry-run', 'origin').split('\n').filter((line) => line.includes('[would prune]'));
  if (stale.length) lines.push(`stale remote-tracking refs: ${stale.join(', ')}`);
  if (issues) {
    const open = JSON.parse(gh('issue', 'list', '--repo', 'NoReasonKen/PttChrome', '--state', 'open', '--limit', '200', '--json', 'number,title'));
    const closed = JSON.parse(gh('issue', 'list', '--repo', 'NoReasonKen/PttChrome', '--state', 'closed', '--limit', '100', '--json', 'number,stateReason,labels,title'));
    const closing = new Set(closingIssueNumbers(prs));
    for (const issue of open) if (closing.has(issue.number)) lines.push(`issue #${issue.number} is open despite a merged closing PR: ${issue.title}`);
    for (const issue of closed) if (issue.stateReason === 'COMPLETED' && !issue.labels.some((label) => label.name === 'resolved')) lines.push(`issue #${issue.number} completed without resolved: ${issue.title}`);
  }
  return lines;
}

function listDirectories(primary) {
  const dirs = (parent) => {
    try { return readdirSync(parent, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return [...dirs(dirname(primary)).filter((path) => basename(path).startsWith(`${basename(primary)}-`)), ...dirs(join(primary, '.claude', 'worktrees'))];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const lines = collectStatus({ args: process.argv.slice(2), listDirectories, run: (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) });
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: !lines.length, first: lines[0] || null, items: lines }));
    else console.log(lines.length ? `${lines.join('\n')}\nFirst unfinished: ${lines[0]}` : 'OK: nothing left over');
    process.exitCode = lines.length ? 1 : 0;
  } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 2; }
}
