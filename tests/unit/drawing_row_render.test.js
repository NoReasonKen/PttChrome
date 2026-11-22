// @unit-env browser
// Drawing blocks in the phone's article (#295): the renderer marks a block's rows
// `drawingRow` (main.css draws them unwrapped at the drawing cell); the desktop has
// none; a page appended below keeps the marked rows' nodes.
import { mountScreen, unmountAll } from "./helpers/mount_screen";
import { row, seg, color } from "./helpers/screen_fixtures";

afterEach(() => unmountAll());

const plain = (text) => row(seg(text));
const art = (i) =>
  row(
    seg("  "),
    seg("　".repeat(8 + (i % 2)), color(7, 4)),
    seg("▆▅▄▃▂", color(3, 0)),
    seg("　".repeat(12), color(0, 7)),
  );
const PROSE = "今天去了一趟市場，買了很多東西回家，結果發現忘記買最重要的醬油，只好再出門一次。";
const LINES = [plain(PROSE), art(0), art(1), art(2), plain(PROSE)];
const props = (lines, drawingCols) => ({
  lines,
  enhance: {
    pageState: 3,
    easyReading: true,
    dropHidden: true,
    stableRows: true,
    commentCards: drawingCols != null,
    drawingCols,
  },
});
const node = (m, r) => m.container.querySelector(`[type="bbsrow"][srow="${r}"]`);
const drawn = (m) =>
  [...m.container.querySelectorAll('[type="bbsrow"].drawingRow')].map((el) => Number(el.getAttribute("srow")));

test("the phone: the drawing's rows are marked, the prose is not", () => {
  const m = mountScreen(props(LINES, 51));
  expect(drawn(m)).toEqual([1, 2, 3]);
  // The row keeps its contract: the full-width boxes the CSS resizes.
  expect(node(m, 1).querySelector(".wpadding")).not.toBe(null);
});

test("the desktop: no row is marked", () => {
  const m = mountScreen(props(LINES, null));
  expect(drawn(m)).toEqual([]);
});

test("a page appended below keeps the drawing's nodes", () => {
  const m = mountScreen(props(LINES.slice(0, 4), 51));
  const before = [1, 2, 3].map((r) => node(m, r));
  m.update(props(LINES.concat([plain("推 abc: 好圖                                        08/09 22:01")]), 51));
  expect(drawn(m)).toEqual([1, 2, 3]);
  [1, 2, 3].forEach((r, i) => expect(node(m, r)).toBe(before[i]));
});
