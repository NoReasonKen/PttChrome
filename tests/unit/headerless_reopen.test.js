import { reopenStep } from "../../src/js/headerless_reopen";

// #77: when an article without a header settles without its row identity or
// post time, both are read by going back to the list out of sight. These are
// the settles that start that, and the board the screens before it were on.
describe("reopenStep", () => {
  const list = { pageState: 2, top: null, complete: false, articleBoard: null, listBoard: "Test", ready: true };
  const article = { pageState: 3, top: null, complete: true, articleBoard: "Test", listBoard: null, ready: true };
  const headerless = { pageState: 3, top: "Body of article 610", complete: false, articleBoard: null, listBoard: null, ready: true };
  const empty = { board: null, tried: null };

  test("a headerless article after the board's list or one of its articles starts", () => {
    for (const before of [list, article]) {
      const state = reopenStep(empty, before);
      expect(state).toEqual({ board: "Test", tried: null, start: false });
      expect(reopenStep(state, headerless)).toEqual({ board: "Test", tried: "Body of article 610", start: true });
    }
  });

  test("with no board before it, a headerless article without a row keeps the default title", () => {
    const menu = { pageState: 1, top: null, complete: false, articleBoard: null, listBoard: null, ready: true };
    expect(reopenStep(reopenStep(empty, menu), headerless).start).toBe(false);
    expect(reopenStep(empty, headerless).start).toBe(false);
  });

  // An AID or number open from anywhere: the row gave the board.
  test("a headerless article with its row but no time starts on the row's board", () => {
    expect(reopenStep(empty, { ...headerless, articleBoard: "Test" }).start).toBe(true);
  });

  test("each article is tried once; the next settle of another screen clears that", () => {
    const tried = reopenStep(reopenStep(empty, list), headerless);
    expect(reopenStep(tried, headerless)).toEqual({ board: "Test", tried: "Body of article 610", start: false });
    const other = reopenStep(tried, { ...headerless, top: "Body of article 620" });
    expect(other.start).toBe(true);
    expect(reopenStep(reopenStep(tried, article), headerless).start).toBe(true);
    expect(reopenStep(reopenStep(tried, list), headerless).start).toBe(true);
  });

  test("a busy screen waits for the next settle", () => {
    const state = reopenStep(reopenStep(empty, list), { ...headerless, ready: false });
    expect(state).toEqual({ board: "Test", tried: null, start: false });
    expect(reopenStep(state, headerless).start).toBe(true);
  });

  test("an article with its row and time, or with a header, never starts", () => {
    const state = reopenStep(empty, list);
    expect(reopenStep(state, { ...headerless, complete: true }).start).toBe(false);
    expect(reopenStep(state, { ...headerless, top: null }).start).toBe(false);
  });
});
