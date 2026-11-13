// Shared immutable rules for a local history's pinned and recent entries.
// Storage and the event that counts as a use belong to each feature's adapter.
export const HISTORY_RECENT_LIMIT = 10;
export const HISTORY_PINNED_LIMIT = 10;
export const HISTORY_AUTO_PIN_USES = 10;

const validText = text => typeof text === 'string' && !!text;
const identity = (text, options) => options.caseInsensitive ? text.toLowerCase() : text;

function selectedKeys(texts, options) {
  return new Set((Array.isArray(texts) ? texts : []).filter(validText).map(text => identity(text, options)));
}

// Deduplication precedes truncation, including across both sections. A pinned
// entry always wins over a recent entry with the same identity.
export function normalizeHistory(history, options = {}) {
  const source = history && typeof history === 'object' ? history : {};
  const seen = new Set();
  const entries = (list, convert) => {
    const result = [];
    for (const entry of Array.isArray(list) ? list : []) {
      if (!entry || !validText(entry.text)) continue;
      const key = identity(entry.text, options);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(convert(entry));
    }
    return result;
  };
  return {
    pinned: entries(source.pinned, entry => ({ text: entry.text, auto: entry.auto === true }))
      .slice(0, HISTORY_PINNED_LIMIT),
    recent: entries(source.recent, entry => ({
      text: entry.text,
      uses: Number.isInteger(entry.uses) && entry.uses > 0 ? entry.uses : 0,
    })).slice(0, HISTORY_RECENT_LIMIT),
  };
}

export function historyOrder(history, options = {}) {
  const next = normalizeHistory(history, options);
  return next.pinned.map(entry => entry.text).concat(next.recent.map(entry => entry.text));
}

export function pinRoom(history, options = {}) {
  return HISTORY_PINNED_LIMIT - normalizeHistory(history, options).pinned.length;
}

export function rememberHistoryEntry(history, text, options = {}) {
  const next = normalizeHistory(history, options);
  const value = String(text == null ? '' : text).trim();
  if (!value) return next;
  const key = identity(value, options);
  if (next.pinned.some(entry => identity(entry.text, options) === key)) return next;
  const previous = next.recent.find(entry => identity(entry.text, options) === key);
  const uses = (previous ? previous.uses : 0) + 1;
  next.recent = [{ text: value, uses }, ...next.recent.filter(entry => identity(entry.text, options) !== key)]
    .slice(0, HISTORY_RECENT_LIMIT);
  return uses >= HISTORY_AUTO_PIN_USES ? pinEntries(next, [value], true, options) : next;
}

function pinEntries(history, texts, auto, options) {
  const next = normalizeHistory(history, options);
  const selected = selectedKeys(texts, options);
  const picked = next.recent.filter(entry => selected.has(identity(entry.text, options)));
  if (!picked.length || next.pinned.length + picked.length > HISTORY_PINNED_LIMIT) return next;
  next.recent = next.recent.filter(entry => !selected.has(identity(entry.text, options)));
  next.pinned.push(...picked.map(entry => ({ text: entry.text, auto })));
  return next;
}

export function pinHistoryEntries(history, texts, options = {}) {
  return pinEntries(history, texts, false, options);
}

export function unpinHistoryEntries(history, texts, options = {}) {
  const next = normalizeHistory(history, options);
  const selected = selectedKeys(texts, options);
  const back = next.pinned
    .filter(entry => selected.has(identity(entry.text, options)))
    .map(entry => ({ text: entry.text, uses: 0 }));
  if (!back.length) return next;
  next.pinned = next.pinned.filter(entry => !selected.has(identity(entry.text, options)));
  next.recent = [...back, ...next.recent].slice(0, HISTORY_RECENT_LIMIT);
  return next;
}

export function moveHistoryEntries(history, texts, delta, options = {}) {
  const next = normalizeHistory(history, options);
  const selected = selectedKeys(texts, options);
  const list = next.pinned;
  const picked = index => selected.has(identity(list[index].text, options));
  for (let step = 0; step < list.length; ++step) {
    const index = delta < 0 ? step : list.length - 1 - step;
    const target = index + delta;
    if (!picked(index) || target < 0 || target >= list.length || picked(target)) continue;
    [list[index], list[target]] = [list[target], list[index]];
  }
  return next;
}

export function removeHistoryEntries(history, texts, options = {}) {
  const next = normalizeHistory(history, options);
  const selected = selectedKeys(texts, options);
  const keep = entry => !selected.has(identity(entry.text, options));
  next.pinned = next.pinned.filter(keep);
  next.recent = next.recent.filter(keep);
  return next;
}
