// A failed check is a bug, never a designed fallback (#155): the debug
// recording logs every one under the same tag, so a recording lists them all.
export const BUG_TAG = 'bug';

export function reportBug(core, source, reason, info) {
  const rec = core && core.debugRecorder;
  if (rec) rec.log(BUG_TAG, Object.assign({ source: source, reason: reason }, info));
}
