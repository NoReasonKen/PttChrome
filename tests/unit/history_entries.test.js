import {
  HISTORY_RECENT_LIMIT,
  HISTORY_PINNED_LIMIT,
  HISTORY_AUTO_PIN_USES,
  normalizeHistory,
  historyOrder,
  pinRoom,
  rememberHistoryEntry,
  pinHistoryEntries,
  unpinHistoryEntries,
  moveHistoryEntries,
  removeHistoryEntries,
} from "../../src/js/history_entries";

const boards = { caseInsensitive: true };
const entries = (texts) => ({
  pinned: [],
  recent: texts.map((text) => ({ text, uses: 1 })),
});
const pinned = (texts) => ({
  pinned: texts.map((text) => ({ text, auto: false })),
  recent: [{ text: "recent", uses: 3 }],
});

test("normalization removes malformed entries and keeps the first identity across sections", () => {
  expect(normalizeHistory({
    pinned: [{ text: "Keep", auto: true }, { text: "Keep" }, null, { text: "" }],
    recent: [{ text: "Keep", uses: 8 }, { text: "one", uses: -1 }, { text: "two", uses: 2.5 }],
  })).toEqual({
    pinned: [{ text: "Keep", auto: true }],
    recent: [{ text: "one", uses: 0 }, { text: "two", uses: 0 }],
  });
  expect(normalizeHistory(null)).toEqual({ pinned: [], recent: [] });
});

test("search identities remain case-sensitive while board identities do not", () => {
  const input = { pinned: [{ text: "C_Chat", auto: false }], recent: [{ text: "c_chat", uses: 4 }] };
  expect(historyOrder(input)).toEqual(["C_Chat", "c_chat"]);
  expect(historyOrder(input, boards)).toEqual(["C_Chat"]);
  expect(normalizeHistory(input, boards).recent).toEqual([]);
});

test("deduplication precedes section limits, preserving the existing search normalization rule", () => {
  const input = pinned(Array.from({ length: 11 }, (_, i) => "p" + i));
  input.recent = [{ text: "p10", uses: 2 }, { text: "r", uses: 1 }];
  const normalized = normalizeHistory(input);
  expect(normalized.pinned).toHaveLength(HISTORY_PINNED_LIMIT);
  expect(normalized.recent).toEqual([{ text: "r", uses: 1 }]);
});

test("remembering trims input, moves an existing recent entry first and increments its uses", () => {
  const input = entries(["Stock", "C_Chat"]);
  expect(rememberHistoryEntry(input, " c_chat ", boards).recent).toEqual([
    { text: "c_chat", uses: 2 }, { text: "Stock", uses: 1 },
  ]);
  expect(rememberHistoryEntry(input, "   ", boards)).toEqual(input);
  const exact = rememberHistoryEntry(input, "c_chat");
  expect(exact.recent.map((entry) => entry.text)).toEqual(["c_chat", "Stock", "C_Chat"]);
});

test("recent entries are bounded without displacing pinned entries", () => {
  let history = pinned(["keep"]);
  for (let i = 0; i < 14; ++i) history = rememberHistoryEntry(history, "r" + i);
  expect(history.pinned).toEqual([{ text: "keep", auto: false }]);
  expect(history.recent).toHaveLength(HISTORY_RECENT_LIMIT);
  expect(history.recent[0].text).toBe("r13");
  expect(history.recent.at(-1).text).toBe("r4");
});

test("the tenth use automatically pins the identity and later uses leave it unchanged", () => {
  let history = null;
  for (let i = 0; i < HISTORY_AUTO_PIN_USES - 1; ++i) {
    history = rememberHistoryEntry(history, i % 2 ? "c_chat" : "C_Chat", boards);
  }
  expect(history.recent[0].uses).toBe(9);
  history = rememberHistoryEntry(history, "C_CHAT", boards);
  expect(history).toEqual({ pinned: [{ text: "C_CHAT", auto: true }], recent: [] });
  expect(rememberHistoryEntry(history, "c_chat", boards)).toEqual(history);
});

test("manual pinning follows recent order and rejects a whole batch that does not fit", () => {
  const input = pinned(Array.from({ length: 9 }, (_, i) => "p" + i));
  input.recent = entries(["B", "A"]).recent;
  expect(pinRoom(input)).toBe(1);
  expect(pinHistoryEntries(input, ["A", "B"])).toEqual(input);
  const one = pinHistoryEntries(input, ["a", "missing"], boards);
  expect(one.pinned.at(-1)).toEqual({ text: "A", auto: false });
  expect(pinRoom(one)).toBe(0);
  expect(pinHistoryEntries(entries(["B", "A"]), ["A", "B"]).pinned)
    .toEqual([{ text: "B", auto: false }, { text: "A", auto: false }]);
});

test("full pinned capacity postpones automatic pinning until another use after room opens", () => {
  let history = pinned(Array.from({ length: 10 }, (_, i) => "p" + i));
  for (let i = 0; i < 11; ++i) history = rememberHistoryEntry(history, "hot");
  expect(history.recent[0]).toEqual({ text: "hot", uses: 11 });
  expect(history.pinned).toHaveLength(10);
  history = unpinHistoryEntries(history, ["p0"]);
  expect(history.recent.some((entry) => entry.text === "hot")).toBe(true);
  history = rememberHistoryEntry(history, "hot");
  expect(history.pinned.at(-1)).toEqual({ text: "hot", auto: true });
});

test("unpinning follows pinned order, resets uses and enforces the recent limit", () => {
  const input = pinned(["A", "B"]);
  input.recent = entries(Array.from({ length: 10 }, (_, i) => "r" + i)).recent;
  const next = unpinHistoryEntries(input, ["b", "a"], boards);
  expect(next.pinned).toEqual([]);
  expect(next.recent.slice(0, 2)).toEqual([{ text: "A", uses: 0 }, { text: "B", uses: 0 }]);
  expect(next.recent).toHaveLength(10);
  expect(next.recent.at(-1).text).toBe("r7");
});

test("moving selected pins keeps their relative order and leaves recent entries untouched", () => {
  const input = pinned(["A", "B", "C", "D", "E"]);
  expect(moveHistoryEntries(input, ["b", "d"], -1, boards).pinned.map((entry) => entry.text))
    .toEqual(["B", "A", "D", "C", "E"]);
  const down = moveHistoryEntries(input, ["A", "B", "E"], 1);
  expect(down.pinned.map((entry) => entry.text)).toEqual(["C", "A", "B", "D", "E"]);
  expect(down.recent).toEqual(input.recent);
});

test("case-insensitive removal deletes both sections without changing unrelated entries", () => {
  const input = pinned(["Stock", "Test"]);
  input.recent = entries(["C_Chat", "Steam"]).recent;
  expect(removeHistoryEntries(input, ["STOCK", "c_chat"], boards)).toEqual({
    pinned: [{ text: "Test", auto: false }],
    recent: [{ text: "Steam", uses: 1 }],
  });
  expect(removeHistoryEntries(input, ["STOCK"])).toEqual(input);
});

test("all operations return independent data and require no storage", () => {
  const input = pinned(["A", "B"]);
  Object.freeze(input.pinned[0]);
  Object.freeze(input.pinned[1]);
  Object.freeze(input.recent[0]);
  Object.freeze(input.pinned);
  Object.freeze(input.recent);
  Object.freeze(input);
  const operations = [
    (history) => normalizeHistory(history),
    (history) => rememberHistoryEntry(history, "new"),
    (history) => pinHistoryEntries(history, ["recent"]),
    (history) => unpinHistoryEntries(history, ["A"]),
    (history) => moveHistoryEntries(history, ["B"], -1),
    (history) => removeHistoryEntries(history, ["A"]),
  ];
  for (const operation of operations) {
    const next = operation(input);
    expect(next).not.toBe(input);
    expect(next.pinned).not.toBe(input.pinned);
    expect(next.recent).not.toBe(input.recent);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  }
  expect(historyOrder(input)).toEqual(["A", "B", "recent"]);
});
