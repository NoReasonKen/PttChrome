// Unit tests for board_info_parse.js (#288): reading PTT's 看板資訊 screen
// (mbbsd/board.c#b_config, a PSB list) as row texts, and putting its pages
// together. The rows follow bconfig_header / bconfig_renderer.

import { isBoardInfoScreen, parseBoardInfoPage, mergeBoardInfoPage } from "../../src/js/board_info_parse";

const ROWS = 24;
const FOOTER = " 看板資訊  (l)管理紀錄 (PgUp)上頁 (PgDn)下頁 (1)跳號 (←)離開 (h)說明";

// One item row as bconfig_renderer prints it for a reader: no hotkey.
function itemRow(num, label, value, cursor = false) {
  const desc = label.padEnd(24, " ");
  return (cursor ? ">" : " ") + " " + String(num).padStart(2, " ") + ". " + "   " + desc + "  " + value;
}

function screen(items, { first = 1, moderators = "test", rows = ROWS, footer = FOOTER } = {}) {
  const out = [" 看板設定與管理  [唯讀檢視]", `名稱: Test  板主: ${moderators}`];
  items.forEach(([label, value], i) => out.push(itemRow(first + i, label, value, i === 0)));
  while (out.length < rows - 1) out.push("");
  out.push(footer);
  return out;
}

const items = (n, from = 1) =>
  Array.from({ length: n }, (_, i) => [`設定 ${from + i}`, `值 ${from + i}`]);

describe("isBoardInfoScreen", () => {
  test("knows the title row, also an editor's", () => {
    expect(isBoardInfoScreen(screen(items(3)))).toBe(true);
    expect(isBoardInfoScreen([" 看板設定與管理  [唯讀模式 (按 Ctrl-P 編輯)]"])).toBe(true);
  });

  test("anything else is not it", () => {
    expect(isBoardInfoScreen(["【板主:test】 Test 看板《測試》"])).toBe(false);
    expect(isBoardInfoScreen([])).toBe(false);
    expect(isBoardInfoScreen(null)).toBe(false);
  });
});

describe("parseBoardInfoPage", () => {
  test("reads the board, its moderators and every row as PTT prints it", () => {
    const rows = screen([
      ["看板管理紀錄(自動公告)", "(尚無記錄)"],
      ["公開狀態 (是否隱形)", "公開"],
      ["快速連推文章", "限制 (間隔 5 秒)"],
      ["[名單] 設定禁言名單(水桶)", "[唯讀檢視]"],
      ["[紀錄] 看板管理稽核紀錄", "(限管理人員)"]
    ], { moderators: "test, other" });
    expect(parseBoardInfoPage(rows)).toEqual({
      board: "Test",
      moderators: "test, other",
      items: [
        { num: 1, label: "看板管理紀錄(自動公告)", value: "(尚無記錄)" },
        { num: 2, label: "公開狀態 (是否隱形)", value: "公開" },
        { num: 3, label: "快速連推文章", value: "限制 (間隔 5 秒)" },
        { num: 4, label: "[名單] 設定禁言名單(水桶)", value: "[唯讀檢視]" },
        { num: 5, label: "[紀錄] 看板管理稽核紀錄", value: "(限管理人員)" }
      ],
      firstNum: 1,
      capacity: 21
    });
  });

  test("a board without moderators: 板主: (無)", () => {
    expect(parseBoardInfoPage(screen(items(2), { moderators: "(無)" })).moderators).toBe("");
  });

  test("the legacy cursor ● and an editor's caption", () => {
    const rows = screen(items(2), { footer: " 看板設定  (PgDn)下頁" });
    rows[2] = "●" + rows[2].slice(2);
    expect(parseBoardInfoPage(rows).items.map(i => i.num)).toEqual([1, 2]);
  });

  test("a later page starts at its own number", () => {
    const page = parseBoardInfoPage(screen(items(9, 22), { first: 22 }));
    expect(page.firstNum).toBe(22);
    expect(page.items).toHaveLength(9);
  });

  test("not the board information, or rows it does not read, give null", () => {
    expect(parseBoardInfoPage(["【板主:test】 Test", "", "", "", " 文章列表 "])).toBeNull();
    expect(parseBoardInfoPage(screen(items(3), { footer: " 文章列表  (h)說明" }))).toBeNull();
    const noBoard = screen(items(3));
    noBoard[1] = "";
    expect(parseBoardInfoPage(noBoard)).toBeNull();
    const stray = screen(items(3));
    stray[3] = "  請按任意鍵繼續";
    expect(parseBoardInfoPage(stray)).toBeNull();
    const skipped = screen(items(3));
    skipped[3] = itemRow(5, "設定 5", "值 5");
    expect(parseBoardInfoPage(skipped)).toBeNull();
    expect(parseBoardInfoPage(screen([]))).toBeNull();
  });
});

describe("mergeBoardInfoPage", () => {
  const page = (n, from = 1) => parseBoardInfoPage(screen(items(n, from), { first: from }));

  test("a page that is not full is all of it", () => {
    const { info, more } = mergeBoardInfoPage(null, page(9));
    expect(more).toBe(false);
    expect(info.items).toHaveLength(9);
  });

  test("a full page asks for the next one, which completes it", () => {
    let step = mergeBoardInfoPage(null, page(21));
    expect(step.more).toBe(true);
    step = mergeBoardInfoPage(step.info, page(9, 22));
    expect(step.more).toBe(false);
    expect(step.info.items.map(i => i.num)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  test("items that fill pages exactly: PgDn draws the last page again", () => {
    let step = mergeBoardInfoPage(null, page(21));
    step = mergeBoardInfoPage(step.info, page(21, 22));
    expect(step.more).toBe(true);
    const again = mergeBoardInfoPage(step.info, page(21, 22));
    expect(again.more).toBe(false);
    expect(again.info.items).toHaveLength(42);
  });

  test("a first page that does not start at 1, a gap, or another board is no answer", () => {
    expect(mergeBoardInfoPage(null, page(9, 22))).toBeNull();
    const first = mergeBoardInfoPage(null, page(21)).info;
    expect(mergeBoardInfoPage(first, page(5, 25))).toBeNull();
    expect(mergeBoardInfoPage({ ...first, board: "Other" }, page(9, 22))).toBeNull();
  });
});
