import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCiObserver, acknowledgeCi } from '../../scripts/ci-watch-state.mjs';

let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-observer-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

test('records detection separately from acknowledgement and omits unneeded run data', () => {
  const file = path.join(directory, 'state.json');
  let time = '2026-10-31T00:00:00Z';
  const observer = createCiObserver(file, { now: () => time });
  observer.observe({ sha: 'a'.repeat(40), branch: 'dev', runs: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'success', updated_at: '2026-10-31T00:00:10Z', html_url: 'https://example.test/run', unnecessary: 'not stored' }] });
  time = '2026-10-31T00:00:30Z';
  const result = observer.finish(0);
  expect(result.detectionDelayMs).toBe(20_000);
  expect(result.runs[0]).not.toHaveProperty('unnecessary');
  const acknowledged = acknowledgeCi(file, { now: () => '2026-10-31T00:01:00Z' });
  expect(acknowledged.resumeDelayMs).toBe(30_000);
  expect(acknowledgeCi(file, { now: () => '2026-10-31T00:02:00Z' }).acknowledgedAt).toBe(acknowledged.acknowledgedAt);
});

test('cannot acknowledge pending CI or infer completion time from incomplete runs', () => {
  const file = path.join(directory, 'state.json');
  const observer = createCiObserver(file);
  expect(() => acknowledgeCi(file)).toThrow('no terminal outcome');
  observer.observe({ sha: 'b'.repeat(40), branch: 'dev', runs: [{ status: 'in_progress', updated_at: '2026-10-31T00:00:00Z' }] });
  const result = observer.finish(2);
  expect(result.status).toBe('error');
  expect(result.completedAt).toBeNull();
  expect(result.detectionDelayMs).toBeNull();
});

test('reports failure and leaves negative clock differences unknown', () => {
  const file = path.join(directory, 'state.json');
  const observer = createCiObserver(file, { now: () => '2026-10-31T00:00:00Z' });
  observer.observe({ sha: 'c'.repeat(40), branch: 'dev', runs: [{ status: 'completed', conclusion: 'failure', updated_at: '2026-10-31T00:00:10Z' }] });
  expect(observer.finish(1)).toMatchObject({ status: 'failure', detectionDelayMs: null });
});

test('a no-wait snapshot of running CI is not a terminal failure to acknowledge', () => {
  const file = path.join(directory, 'state.json');
  const observer = createCiObserver(file);
  observer.observe({ sha: 'd'.repeat(40), branch: 'dev', runs: [{ status: 'in_progress' }] });
  const state = observer.finish(1, { snapshotOnly: true });
  expect(state.status).toBe('running');
  expect(state.detectedAt).toBeUndefined();
  expect(() => acknowledgeCi(file)).toThrow('no terminal outcome');
});

test('a no-wait snapshot still records a completed failure or a monitoring error', () => {
  const file = path.join(directory, 'state.json');
  const observer = createCiObserver(file);
  observer.observe({ sha: 'e'.repeat(40), branch: 'dev', runs: [{ status: 'completed', conclusion: 'failure' }] });
  expect(observer.finish(1, { snapshotOnly: true }).status).toBe('failure');
  const broken = createCiObserver(file);
  expect(broken.finish(2, { snapshotOnly: true }).status).toBe('error');
});
