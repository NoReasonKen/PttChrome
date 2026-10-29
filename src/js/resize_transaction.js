export const RESIZE_TIMEOUT_MS = 6000;

export function resizeDeadline() {
  return performance.now() + RESIZE_TIMEOUT_MS;
}

export function coalesceResize(cols, rows, activeSize) {
  return cols === activeSize.cols && rows === activeSize.rows ? null : { cols, rows };
}

// Each phase owns its repaint coverage, while all phases share one deadline.
export function resizePhase(core, command, isCurrent, accept) {
  const seenRows = new Set();
  const remaining = Math.max(1, command.deadline - performance.now());
  return {
    // Ordinary application repaints omit unchanged rows; request redrawwin.
    fullRepaint: true,
    probe: false,
    timeoutMs: remaining,
    hardTimeoutMs: remaining,
    expect: (snapshot, facts) => {
      for (const row of snapshot?.changedRows || []) {
        if (row >= 0 && row < command.rows) seenRows.add(row);
      }
      if (!isCurrent() || core.buf.cols !== command.cols || core.buf.rows !== command.rows ||
          seenRows.size < command.rows) return false;
      return accept(snapshot, facts);
    },
  };
}
