import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function elapsed(later, earlier) {
  const difference = Date.parse(later) - Date.parse(earlier);
  return Number.isFinite(difference) && difference >= 0 ? difference : null;
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.${process.pid}.partial`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function createCiObserver(file, { now = () => new Date().toISOString() } = {}) {
  let state = { schemaVersion: 1, status: 'waiting', startedAt: now(), runs: [] };
  saveState(file, state);
  return {
    observe({ sha, branch, runs }) {
      state = {
        ...state, sha, branch, observedAt: now(), status: 'running',
        runs: runs.map(run => ({ id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, updatedAt: run.updated_at, url: run.html_url })),
      };
      saveState(file, state);
    },
    finish(exitCode, { snapshotOnly = false } = {}) {
      const detectedAt = now();
      const completed = state.runs.length > 0 && state.runs.every(run => run.status === 'completed');
      if (snapshotOnly && exitCode === 1 && !completed) {
        state = { ...state, exitCode, observedAt: detectedAt };
        saveState(file, state);
        return state;
      }
      const dates = state.runs.map(run => run.updatedAt).filter(value => Number.isFinite(Date.parse(value)));
      const completedAt = completed && dates.length === state.runs.length ? dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;
      state = {
        ...state, status: exitCode === 0 ? 'success' : exitCode === 1 ? 'failure' : 'error', exitCode, detectedAt, completedAt,
        detectionDelayMs: completedAt ? elapsed(detectedAt, completedAt) : null,
      };
      saveState(file, state);
      return state;
    },
  };
}

export function acknowledgeCi(file, { now = () => new Date().toISOString() } = {}) {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.schemaVersion !== 1 || !['success', 'failure', 'error'].includes(state.status) || !state.detectedAt) {
    throw new Error('CI has no terminal outcome to acknowledge');
  }
  if (state.acknowledgedAt) return state;
  state.acknowledgedAt = now();
  state.resumeDelayMs = elapsed(state.acknowledgedAt, state.detectedAt);
  saveState(file, state);
  return state;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== '--ack' || !process.argv[3] || process.argv.length !== 4) throw new Error('Use --ack <state-file>');
    const state = acknowledgeCi(process.argv[3]);
    console.log(JSON.stringify({ sha: state.sha, status: state.status, detectionDelayMs: state.detectionDelayMs, resumeDelayMs: state.resumeDelayMs }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
