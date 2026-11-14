import {
  RECENT_BOARD_HISTORY_KEY,
  LEGACY_RECENT_BOARD_HISTORY_KEY,
  readRecentBoardHistory,
  writeRecentBoardHistory,
} from "../../src/js/recent_board_history";

let stored;
let storage;
beforeEach(() => {
  stored = new Map();
  storage = {
    getItem: vi.fn(key => stored.get(key) ?? null),
    setItem: vi.fn((key, value) => stored.set(key, value)),
  };
  vi.stubGlobal("window", { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

test("migrates v1 once in existing order with unknown visit counts at zero", () => {
  const legacy = JSON.stringify(["Stock", "C_Chat", "stock", " Test ", null, ""]);
  stored.set(LEGACY_RECENT_BOARD_HISTORY_KEY, legacy);
  const history = readRecentBoardHistory();
  expect(history).toEqual({
    pinned: [],
    recent: [
      { text: "Stock", uses: 0 },
      { text: "C_Chat", uses: 0 },
      { text: "Test", uses: 0 },
    ],
  });
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(RECENT_BOARD_HISTORY_KEY, JSON.stringify(history));
  expect(stored.get(LEGACY_RECENT_BOARD_HISTORY_KEY)).toBe(legacy);
  storage.setItem.mockClear();
  expect(readRecentBoardHistory()).toEqual(history);
  expect(storage.setItem).not.toHaveBeenCalled();
});

test.each([
  ['{"pinned":[],"recent":[]}', { pinned: [], recent: [] }],
  ["broken JSON", { pinned: [], recent: [] }],
  ["null", { pinned: [], recent: [] }],
])("an existing current value %s never restores deleted legacy entries", (current, expected) => {
  stored.set(RECENT_BOARD_HISTORY_KEY, current);
  stored.set(LEGACY_RECENT_BOARD_HISTORY_KEY, '["Stock"]');
  expect(readRecentBoardHistory()).toEqual(expected);
  expect(storage.setItem).not.toHaveBeenCalled();
});

test("valid current data keeps pinned order and case-insensitive uniqueness across sections", () => {
  stored.set(RECENT_BOARD_HISTORY_KEY, JSON.stringify({
    pinned: [{ text: "Stock", auto: true }, { text: "C_Chat", auto: false }],
    recent: [{ text: "stock", uses: 8 }, { text: "Steam", uses: 4 }],
  }));
  expect(readRecentBoardHistory()).toEqual({
    pinned: [{ text: "Stock", auto: true }, { text: "C_Chat", auto: false }],
    recent: [{ text: "Steam", uses: 4 }],
  });
});

test.each([undefined, "{}", "broken JSON"])("missing or invalid legacy data %s makes no write", (legacy) => {
  if (legacy !== undefined) stored.set(LEGACY_RECENT_BOARD_HISTORY_KEY, legacy);
  expect(readRecentBoardHistory()).toEqual({ pinned: [], recent: [] });
  expect(storage.setItem).not.toHaveBeenCalled();
});

test("writing normalizes only board history and preserves unrelated local data", () => {
  stored.set("pttchrome.pref.v1", '{"values":{"enableEasyReading":true}}');
  stored.set("pttchrome.homeFavorites.v1", '{"boards":[{"name":"Stock"}]}');
  const next = writeRecentBoardHistory({
    pinned: [],
    recent: [{ text: "Stock", uses: 2 }, { text: "stock", uses: 9 }],
  });
  expect(next).toEqual({ pinned: [], recent: [{ text: "Stock", uses: 2 }] });
  expect(JSON.parse(stored.get(RECENT_BOARD_HISTORY_KEY))).toEqual(next);
  expect(stored.get("pttchrome.pref.v1")).toBe('{"values":{"enableEasyReading":true}}');
  expect(stored.get("pttchrome.homeFavorites.v1")).toBe('{"boards":[{"name":"Stock"}]}');
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});

test("blocked storage is safe for reads and retains the write's in-memory value", () => {
  storage.getItem.mockImplementation(() => { throw new Error("Storage blocked"); });
  expect(readRecentBoardHistory()).toEqual({ pinned: [], recent: [] });
  storage.setItem.mockImplementation(() => { throw new Error("Storage blocked"); });
  const history = { pinned: [{ text: "Stock", auto: false }], recent: [] };
  expect(writeRecentBoardHistory(history)).toEqual(history);
});
