// Drawing blocks in the phone's easy-reading article (#295, src/js/drawing_block.js):
// which consecutive article rows are an ANSI drawing drawn on the 80-column grid
// instead of wrapping at the reading size. The rule errs towards leaving prose
// alone, so most cases here are prose that must stay a non-block.
import { row, seg, color } from "./helpers/screen_fixtures";
import {
  drawingBlocks,
  drawingGeometry,
  drawingRowInfo,
  MAX_BLANK_GAP,
} from "../../src/js/drawing_block";
import { computeAnnotations } from "../../src/js/screen_annotations";
import { spliceShape } from "../../src/js/screen_annotate_cache";

// A Pixel 7 page (412px) at the 16px reading size: 51 half-width columns fit.
const FIT = 51;
const plain = (text) => row(seg(text));
const blank = () => row(seg(""));
const BG_BLUE = color(7, 4);
const BG_WHITE = color(0, 7);
const RED_BG = color(7, 1);
// A row of colour art: background-coloured spaces and block characters.
const art = (i) =>
  row(
    seg("  "),
    seg("　".repeat(6 + (i % 3)), BG_BLUE),
    seg("▆▅▄▃▂", color(3, 0)),
    seg("　".repeat(10), BG_WHITE),
    seg("◢◣", color(1, 4)),
    seg("　".repeat(8), RED_BG),
  );
const PROSE_LONG = "今天去了一趟市場，買了很多東西回家，結果發現忘記買最重要的醬油，只好再出門一次。";
const blocks = (lines, opts) => drawingBlocks(lines, FIT, opts).blocks;

describe("drawingRowInfo", () => {
  test("measures the columns of full-width characters, colours and gaps", () => {
    const info = drawingRowInfo(row(seg("ab  "), seg("──", color(7, 0)), seg("  c"), seg("  ", BG_BLUE)));
    expect(info.width).toBe(13);
    expect(info.span).toBe(13);
    // Two box characters (4 columns) and two coloured spaces.
    expect(info.drawing).toBe(6);
    expect(info.weak).toBe(true);
    expect(info.gaps).toEqual([
      [2, 4],
      [8, 10],
    ]);
  });

  test("a blank row has no width; uncoloured trailing spaces do not count", () => {
    expect(drawingRowInfo(blank()).width).toBe(0);
    expect(drawingRowInfo(plain("   text   ")).width).toBe(7);
    expect(drawingRowInfo(plain("   text   ")).span).toBe(4);
  });
});

describe("colour art between prose", () => {
  test("the art rows form one block; the prose around it does not", () => {
    const lines = [plain(PROSE_LONG), plain("短句。"), ...[0, 1, 2, 3, 4].map(art), plain(PROSE_LONG)];
    expect(blocks(lines)).toEqual([[2, 7]]);
  });

  test("a drawing that fits the reading size is left alone", () => {
    const small = () => row(seg("  "), seg("　".repeat(8), BG_BLUE), seg("▆▅▄", color(3, 0)));
    expect(drawingRowInfo(small()).width).toBeLessThanOrEqual(FIT);
    expect(blocks([small(), small(), small()])).toEqual([]);
  });

  test("one wide row draws the whole block small, so its columns stay aligned", () => {
    const small = () => row(seg("  "), seg("　".repeat(8), BG_BLUE));
    expect(blocks([small(), art(0), small()])).toEqual([[0, 3]]);
  });

  test(`up to ${MAX_BLANK_GAP} blank rows inside a drawing join it; blank rows at its ends do not`, () => {
    const lines = [blank(), art(0), blank(), blank(), art(1), blank(), plain("完")];
    expect(blocks(lines)).toEqual([[1, 5]]);
  });

  test("more blank rows split two drawings", () => {
    const lines = [art(0), blank(), blank(), blank(), art(1)];
    expect(blocks(lines)).toEqual([
      [0, 1],
      [4, 5],
    ]);
  });

  test("a skipped row (a comment) ends a drawing", () => {
    const lines = [art(0), art(1), plain("推 abc: 留言"), art(2)];
    expect(blocks(lines, { skip: (r) => r === 2 })).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });
});

describe("box drawings", () => {
  const top = () => plain("┌" + "─".repeat(36) + "┐");
  const inner = (t) => plain("│" + t.padEnd(72 - 2 * [...t].filter((c) => c > "\x7f").length) + "│");
  const bottom = () => plain("└" + "─".repeat(36) + "┘");

  test("a frame's inner rows, weak alone, join the frame's borders", () => {
    const lines = [plain(PROSE_LONG), top(), inner(" 標題"), inner(" 內容 abc"), bottom(), plain(PROSE_LONG)];
    expect(blocks(lines)).toEqual([[1, 5]]);
  });

  test("a separator line wider than the page is a block of its own", () => {
    const lines = [plain(PROSE_LONG), plain("─".repeat(39)), plain(PROSE_LONG)];
    expect(blocks(lines)).toEqual([[1, 2]]);
  });

  test("a short separator that fits stays as it is", () => {
    expect(blocks([plain("─".repeat(10))])).toEqual([]);
  });
});

describe("prose stays prose", () => {
  test("long prose rows wrap as before", () => {
    expect(blocks([plain(PROSE_LONG), plain(PROSE_LONG), plain(PROSE_LONG)])).toEqual([]);
  });

  test("a highlighted word in a long prose row is no drawing", () => {
    const hl = row(seg("今天的"), seg(" 重點 ", color(3, 1)), seg(PROSE_LONG));
    expect(drawingRowInfo(hl).width).toBeGreaterThan(FIT);
    expect(blocks([hl, plain(PROSE_LONG), hl])).toEqual([]);
  });

  test("bullet points and censored names are no drawing", () => {
    const lines = [plain("● " + PROSE_LONG), plain("○ 王○○說：" + PROSE_LONG), plain("■ " + PROSE_LONG)];
    expect(blocks(lines)).toEqual([]);
  });

  test("a highlighted prose row next to a drawing, behind a blank row, stays prose", () => {
    const hl = row(seg("【公告】", color(7, 1)), seg(PROSE_LONG));
    expect(blocks([art(0), art(1), blank(), hl])).toEqual([[0, 2]]);
  });

  test("English prose with single spaces is no table", () => {
    const en = "The quick brown fox jumps over the lazy dog and keeps running far away";
    expect(blocks([plain(en), plain(en + " now"), plain("and " + en)])).toEqual([]);
  });

  test("a URL longer than the page is no drawing", () => {
    expect(blocks([plain("https://www.example.com/" + "a".repeat(60))])).toEqual([]);
  });
});

describe("tables laid out in columns", () => {
  const table = [
    "代號      名稱          收盤價      漲跌        成交量(張)",
    "2330      台積電        1045.00     +15.00      35,120",
    "2317      鴻海          203.50      -1.50       60,881",
    "2454      聯發科        1290.00     +20.00      8,102",
  ].map(plain);

  test("rows whose space gaps line up form a block", () => {
    expect(drawingRowInfo(table[1]).width).toBeGreaterThan(FIT);
    expect(blocks([plain(PROSE_LONG), ...table, plain(PROSE_LONG)])).toEqual([[1, 5]]);
  });

  test("two such rows are not a table yet", () => {
    expect(blocks(table.slice(0, 2))).toEqual([]);
  });

  test("a table that fits the reading size is left alone", () => {
    const small = ["a  b  c", "1  2  3", "4  5  6"].map(plain);
    expect(blocks(small)).toEqual([]);
  });
});

describe("open: the frontier for rows appended later", () => {
  const open = (lines) => drawingBlocks(lines, FIT).open;

  test("prose at the end: nothing can change", () => {
    expect(open([art(0), plain(PROSE_LONG)])).toBe(2);
  });

  test("a drawing at the end may still grow: its first row", () => {
    expect(open([plain(PROSE_LONG), art(0), art(1)])).toBe(1);
    expect(open([plain(PROSE_LONG), art(0), art(1), blank(), blank()])).toBe(1);
  });

  test("more blank rows than a drawing may hold close it", () => {
    expect(open([art(0), blank(), blank(), blank()])).toBe(4);
  });

  test("a drawing the open one can still join opens with it", () => {
    expect(open([plain("x"), art(0), blank(), art(1)])).toBe(1);
  });

  test("gapped rows at the end may still become a table that joins a drawing", () => {
    const gapped = plain("a   bb   ccc   dddd");
    expect(open([plain("x"), art(0), blank(), gapped, gapped])).toBe(1);
  });

  test("appending row by row gives the blocks of the whole", () => {
    const lines = [
      plain(PROSE_LONG),
      art(0),
      blank(),
      art(1),
      plain(PROSE_LONG),
      plain("─".repeat(39)),
      blank(),
      blank(),
      blank(),
      ...[0, 1, 2].map(art),
      plain("推 abc: 留言"),
    ];
    const whole = drawingBlocks(lines, FIT).blocks;
    // Each frame keeps the blocks before the previous frame's frontier and
    // recomputes from it, as computeAnnotations does.
    let kept = [];
    let from = 0;
    for (let to = 1; to <= lines.length; ++to) {
      const out = drawingBlocks(lines, FIT, { from, to });
      kept = kept.filter(([s]) => s < from).concat(out.blocks);
      from = out.open;
    }
    expect(kept).toEqual(whole);
  });
});

describe("drawingGeometry", () => {
  test("a Pixel 7 page: 51 columns at the reading size, a cell that fits 80 columns", () => {
    const g = drawingGeometry({ width: 412, readingPx: 16, dpr: 2.625 });
    expect(g.fitCols).toBe(51);
    expect(g.cellPx * 40).toBeLessThanOrEqual(412 - 10);
    expect(g.cellPx).toBeCloseTo(26 / 2.625, 6);
  });

  test("a page 80 columns fit at the reading size: no row wraps, the cell is the reading cell", () => {
    const g = drawingGeometry({ width: 1400, readingPx: 16, dpr: 1 });
    expect(g.fitCols).toBeGreaterThanOrEqual(80);
    expect(g.cellPx).toBe(16);
  });

  test("no page: nothing", () => {
    expect(drawingGeometry({ width: 0, readingPx: 16, dpr: 1 })).toEqual({ fitCols: 0, cellPx: 0 });
  });
});

describe("computeAnnotations marks the rows of drawing blocks", () => {
  const push = (uid, text, mm) => row(seg("推 " + uid + ": " + text, color(2, 0)), seg("  08/09 22:" + mm));
  const header = [
    row(seg(" 作者 ", BG_WHITE), seg(" poster (暱稱)".padEnd(56), BG_BLUE), seg(" 看板 ", BG_WHITE), seg(" Test".padEnd(12), BG_BLUE)),
    row(seg(" 標題 ", BG_WHITE), seg(" [繪圖] 測試".padEnd(74), BG_BLUE)),
    row(seg(" 時間 ", BG_WHITE), seg(" Sat Aug  9 22:00:00 2026".padEnd(74), BG_BLUE)),
    row(seg("─".repeat(39), color(6, 0))),
  ];
  const article = [
    ...header,
    plain(PROSE_LONG),
    ...[0, 1, 2].map(art),
    plain(PROSE_LONG),
    plain("--"),
    push("alpha1", "─".repeat(28), "01"),
    push("beta22", "好圖", "02"),
  ];
  const enhance = (drawingCols) => ({
    pageState: 3,
    easyReading: true,
    dropHidden: true,
    stableRows: true,
    commentCards: true,
    drawingCols,
  });
  const marked = (annotations) =>
    annotations.map((a, r) => (a && a.drawing ? r : -1)).filter((r) => r >= 0);

  test("the art rows, not the header, the prose or the comments", () => {
    const out = computeAnnotations(article, enhance(FIT), null, false, {}, {}, {}, null, null);
    expect(marked(out.annotations)).toEqual([5, 6, 7]);
  });

  test("the desktop (no drawingCols) marks nothing", () => {
    const out = computeAnnotations(article, enhance(null), null, false, {}, {}, {}, null, null);
    expect(marked(out.annotations)).toEqual([]);
  });

  test("a marked row keeps its annotation object on the next page, so its node is reused", () => {
    const first = computeAnnotations(article.slice(0, 8), enhance(FIT), null, false, {}, {}, {}, null, null);
    const lines = article;
    const shape = spliceShape(article.slice(0, 8), lines);
    const next = computeAnnotations(lines, enhance(FIT), null, false, {}, {}, {}, first.cache, shape);
    for (const r of [5, 6, 7]) expect(next.annotations[r]).toBe(first.annotations[r]);
  });
});
