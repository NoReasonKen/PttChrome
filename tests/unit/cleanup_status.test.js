import { describe, expect, it } from 'vitest';
import { classifyWorktree, closingIssueNumbers, collectStatus, parseWorktrees } from '../../scripts/cleanup-status.mjs';

const porcelain = 'worktree /repo\0HEAD a\0branch refs/heads/dev\0\0worktree /repo space/task\0HEAD b\0detached\0\0';

function fixture(overrides = {}) {
  const run = (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    if (key in overrides) {
      if (overrides[key] instanceof Error) throw overrides[key];
      return overrides[key];
    }
    if (key === 'git worktree list --porcelain -z') return porcelain;
    if (key.includes(' status --porcelain')) return '';
    if (key.startsWith('git cherry ')) return '';
    if (key.startsWith('git for-each-ref ') || key.startsWith('git remote prune ')) return '';
    if (key.startsWith('gh ')) return '[]';
    throw new Error(`Unexpected command ${key}`);
  };
  return { run, listDirectories: () => [], args: ['--no-issues'] };
}

describe('cleanup status', () => {
  it('parses detached worktrees and paths containing spaces', () => {
    expect(parseWorktrees(porcelain)[1]).toMatchObject({ path: '/repo space/task', head: 'b', branch: undefined });
    expect(collectStatus(fixture())).toEqual(['worktree /repo space/task (detached HEAD): clean and merged: review for archive']);
  });
  it('reports dirty, protected, in-use and locked blockers', () => {
    expect(classifyWorktree({ dirty: true, merged: true, protectedRoot: true, inUse: true, locked: true })).toContain('uncommitted or untracked changes, protected root, in-use root, locked');
    expect(collectStatus({ ...fixture({ 'git -C /repo space/task status --porcelain --untracked-files=normal': '?? new' }), args: ['--no-issues', '--protected-root', '/repo space/task'] })[0]).toContain('protected root');
  });
  it('ignores unmerged clean worktrees and reports checked-out merged branches', () => {
    const branched = porcelain.replace('detached', 'branch refs/heads/topic');
    expect(collectStatus(fixture({ 'git worktree list --porcelain -z': branched, 'git cherry origin/dev topic': '+ abc', 'git for-each-ref --format=%(refname:short) refs/heads': 'topic\n' }))).toEqual([]);
    expect(collectStatus(fixture({ 'git worktree list --porcelain -z': branched, 'git for-each-ref --format=%(refname:short) refs/heads': 'topic\n' })).at(-1)).toContain('checked out');
  });
  it('reports prunable metadata without accessing the missing directory', () => {
    const missing = porcelain.replace('detached', 'detached\0prunable gitdir file points to non-existent location');
    expect(collectStatus(fixture({ 'git worktree list --porcelain -z': missing }))[0]).toContain('prunable metadata');
  });
  it('retains known host blockers on missing or prunable worktrees', () => {
    const missing = porcelain.replace('detached', 'detached\0prunable missing\0locked owner');
    const input = fixture({ 'git worktree list --porcelain -z': missing });
    const run = vi.fn(input.run);
    const lines = collectStatus({ ...input, run, args: ['--no-issues', '--protected-root', '/repo space/task', '--in-use-root', '/repo space/task'] });
    expect(lines[0]).toContain('prunable metadata; review; blocked: protected root, in-use root, locked');
    expect(run.mock.calls.some(([command, args]) => command === 'git' && args[0] === '-C')).toBe(false);
  });
  it('uses only GitHub closing references', () => {
    expect(closingIssueNumbers([{ body: 'Refs #3; Part of #4', closingIssuesReferences: [{ number: 5 }] }])).toEqual([5]);
  });
  it('reports open issues only when a merged PR has a closing reference', () => {
    const entries = fixture({
      'git cherry origin/dev b': '+ b',
      'gh pr list --repo NoReasonKen/PttChrome --state merged --limit 60 --json number,headRefName,headRefOid,closingIssuesReferences': JSON.stringify([{ body: 'Refs #3; Part of #4', closingIssuesReferences: [{ number: 5 }] }]),
      'gh issue list --repo NoReasonKen/PttChrome --state open --limit 200 --json number,title': JSON.stringify([{ number: 3, title: 'reference' }, { number: 4, title: 'part' }, { number: 5, title: 'closing' }]),
    });
    entries.args = [];
    expect(collectStatus(entries)).toEqual(['issue #5 is open despite a merged closing PR: closing']);
  });
  it('propagates GitHub query failures', () => {
    const entries = fixture({ 'gh pr list --repo NoReasonKen/PttChrome --state merged --limit 60 --json number,headRefName,headRefOid,closingIssuesReferences': new Error('GitHub unavailable') });
    entries.args = [];
    expect(() => collectStatus(entries)).toThrow('GitHub unavailable');
  });
  it('propagates query failures and reports unregistered folders', () => {
    expect(() => collectStatus(fixture({ 'git cherry origin/dev b': new Error('failure') }))).toThrow('failure');
    expect(collectStatus({ ...fixture({ 'git cherry origin/dev b': '+ b' }), listDirectories: () => ['/repo space/task', '/repo-old'] })).toEqual(['folder /repo-old is not a worktree: review']);
  });
  it('returns no findings for a clean unmerged worktree', () => {
    expect(collectStatus(fixture({ 'git cherry origin/dev b': '+ b' }))).toEqual([]);
  });
  it('requires the exact PR head before calling a squash-merged branch merged', () => {
    const make = (headRefOid) => ({ ...fixture({
      'git worktree list --porcelain -z': porcelain.replace('detached', 'branch refs/heads/topic'),
      'git cherry origin/dev topic': '+ new',
      'git rev-parse topic': 'current\n',
      'gh pr list --repo NoReasonKen/PttChrome --state merged --limit 60 --json number,headRefName,headRefOid,closingIssuesReferences': JSON.stringify([{ headRefName: 'topic', headRefOid }]),
    }), args: [] });
    expect(collectStatus(make('old'))).toEqual([]);
    expect(collectStatus(make('current'))[0]).toContain('clean and merged');
  });
});
