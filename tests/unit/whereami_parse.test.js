// Unit tests for whereami_parse.js (#293): reading PTT's 我在哪 screen
// (mbbsd/bbs.c#whereami) as row texts. The rows follow its printf formats:
// "%-40.40s %.13s" for the root, "%*s %-13.13s %-37.37s %.13s" under it.

import { isWhereAmIScreen, parseWhereAmI, whereAmIPaused } from "../../src/js/whereami_parse";

const ROWS = 24;
const PAUSE = "                         請按任意鍵繼續";
const cells = (s) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
const padCells = (s, width) => s + " ".repeat(Math.max(0, width - cells(s)));

// The screen of a board under `chain` ([desc, moderators] for the root, then
// [name, desc, moderators] per level), as whereami prints it.
function screen(chain, { pause = PAUSE, path } = {}) {
  const out = ["【板主:test】 Test 看板《測試》", "我在哪?"];
  const [rootDesc, rootMods] = chain[0];
  out.push(padCells(rootDesc, 40) + " " + rootMods);
  chain.slice(1).forEach(([name, desc, mods], k) => {
    out.push(" ".repeat((k + 1) * 2) + " " + padCells(name, 13) + " " + padCells(desc, 37) + " " + mods);
  });
  while (out.length < ROWS - 3) out.push("");
  const category = rootDesc.split(" ")[0];
  const names = [category, ...chain.slice(1).map(([n]) => n)];
  out.push(path ?? "位置: " + names.map((n, i) => n + (i < names.length - 1 ? " >" : "")).join(" ") + " ");
  out.push("");
  out.push(pause);
  return out;
}

const TWO_LEVELS = [
  ["娛樂 ◎休閒與娛樂", "(無)"],
  ["Game_Center", "◎遊戲綜合討論", "gameadm"],
  ["Test", "測試 ◎Test board", "test/other"],
];

describe("isWhereAmIScreen / whereAmIPaused", () => {
  test("knows the title on row 1 and the pause bar on the last row", () => {
    expect(isWhereAmIScreen(screen(TWO_LEVELS))).toBe(true);
    expect(whereAmIPaused(screen(TWO_LEVELS))).toBe(true);
    expect(whereAmIPaused(screen(TWO_LEVELS, { pause: "" }))).toBe(false);
  });

  test("anything else is not it", () => {
    expect(isWhereAmIScreen(["我在哪?", ""])).toBe(false);
    expect(isWhereAmIScreen([])).toBe(false);
    expect(isWhereAmIScreen(null)).toBe(false);
    expect(whereAmIPaused(null)).toBe(false);
  });
});

describe("parseWhereAmI", () => {
  test("reads every level, root first, and the path as PTT printed it", () => {
    expect(parseWhereAmI(screen(TWO_LEVELS))).toEqual({
      levels: [
        { board: "", description: "娛樂 ◎休閒與娛樂", moderators: "(無)" },
        { board: "Game_Center", description: "◎遊戲綜合討論", moderators: "gameadm" },
        { board: "Test", description: "測試 ◎Test board", moderators: "test/other" },
      ],
      path: "位置: 娛樂 > Game_Center > Test",
      names: ["娛樂", "Game_Center", "Test"],
    });
  });

  test("a board that is a root itself has one level and a one-word path", () => {
    const where = parseWhereAmI(screen([["Test 測試", "test"]]));
    expect(where.levels).toEqual([{ board: "", description: "Test 測試", moderators: "test" }]);
    expect(where.names).toEqual(["Test"]);
  });

  test("cuts by screen cells: a full-width description fills its field up to the moderators", () => {
    const wide = "測".repeat(18) + "ab"; // 38 cells, within the 40 of the root
    const where = parseWhereAmI(screen([[wide + " x", "adm"], ["Sub", "測".repeat(18), "m1/m2"]]));
    expect(where.levels[0].description).toBe(wide + " x");
    expect(where.levels[0].moderators).toBe("adm");
    expect(where.levels[1]).toEqual({ board: "Sub", description: "測".repeat(18), moderators: "m1/m2" });
  });

  test("a level without moderators reads as an empty string", () => {
    const where = parseWhereAmI(screen([["娛樂 ◎休閒", ""], ["Test", "測試", ""]]));
    expect(where.levels.map((l) => l.moderators)).toEqual(["", ""]);
  });

  test("null when the path does not match the levels, a level is not indented as PTT does, or a part is missing", () => {
    expect(parseWhereAmI(screen(TWO_LEVELS, { path: "位置: 娛樂 > Test " }))).toBeNull();
    expect(parseWhereAmI(screen(TWO_LEVELS, { path: "位置: 娛樂 > Game_Center > Other " }))).toBeNull();
    const rows = screen(TWO_LEVELS);
    rows[3] = rows[3].trimStart();
    expect(parseWhereAmI(rows)).toBeNull();
    const noPath = screen(TWO_LEVELS);
    noPath[ROWS - 3] = "";
    expect(parseWhereAmI(noPath)).toBeNull();
    expect(parseWhereAmI(["【板主:test】", "我在哪?", "", "", ""])).toBeNull();
    expect(parseWhereAmI(["Test 看板", "", "", "", "", ""])).toBeNull();
  });
});
