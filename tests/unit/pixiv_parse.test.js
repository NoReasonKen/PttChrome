import { detectPixivIds, isPixivId } from "../../src/js/pixiv_parse";
import { buildMergedCommentChars } from "../../src/js/comment_merge";

const cell = (ch, isLeadByte = false) => ({ ch, isLeadByte });
const ascii = text => [...text].map(ch => cell(ch));
const dbcs = () => [cell("\xa4", true), cell("\xa4")];
const queries = (text, ann) => detectPixivIds(ascii(text), text, ann).map(x => x.query);

describe("Pixiv numeric ID candidates", () => {
  test("keeps exclusive terminal column ranges and independent choices", () => {
    expect(detectPixivIds(ascii("look 65964428 117918634"))).toEqual([
      { startCol: 5, endCol: 13, query: "65964428" },
      { startCol: 14, endCol: 23, query: "117918634" },
    ]);
    expect(queries("1 999999999999999")).toEqual(["1", "999999999999999"]);
  });

  test.each(["0", "0123", "000", "1234567890123456", "123456789012345678901234567890"])(
    "rejects noncanonical or overlong ID %s without matching a suffix",
    text => expect(queries(text)).toEqual([]),
  );

  test("validates bridge-facing ID strings without coercion", () => {
    expect(isPixivId("65847159")).toBe(true);
    for (const value of [null, 65847159, " 65847159", "65847159\n", "1e8", "１２３"]) {
      expect(isPixivId(value)).toBe(false);
    }
  });

  test.each([" ", "\t", "\n", "\r\n", "\u2003", "\u3000"])(
    "allows only whitespace or content edges around numbers: %j",
    separator => {
      expect(queries(`65847159${separator}105176734`)).toEqual(["65847159", "105176734"]);
      expect(queries(`${separator}65847159${separator}`)).toEqual(["65847159"]);
    },
  );

  test.each(["(", ")", "[", "]", "{", "}", ".", ",", ":", ";", "!", "?", "-", "_", "@", "#", "字", "あ"])(
    "rejects a number touching non-whitespace on either side: %s",
    neighbor => {
      expect(queries(`${neighbor}65847159`)).toEqual([]);
      expect(queries(`65847159${neighbor}`)).toEqual([]);
      expect(queries(` ${neighbor}65847159 `)).toEqual([]);
      expect(queries(` 65847159${neighbor} `)).toEqual([]);
    },
  );

  test("does not treat Chinese characters as delimiters in either encoding", () => {
    const chars = [...dbcs(), ...ascii("65847159"), ...dbcs()];
    expect(detectPixivIds(chars)).toEqual([]);
    const unicode = [cell("華", true), cell("\uffff"), ...ascii("105176734")];
    expect(detectPixivIds(unicode)).toEqual([]);
    expect(detectPixivIds([...ascii("105176734"), cell("華", true), cell("\uffff")])).toEqual([]);
  });

  test.each([
    { encoding: "Big5", space: [cell("\xa1", true), cell("\x40")] },
    { encoding: "Unicode", space: [cell("\u3000", true), cell("\uffff")] },
  ])("recognizes both cells of a complete $encoding full-width space", ({ space }) => {
    expect(detectPixivIds([...space, ...ascii("65847159"), ...space])).toEqual([
      { startCol: 2, endCol: 10, query: "65847159" },
    ]);
  });

  test("does not read a DBCS trail byte as the start of a number", () => {
    // A malformed/partially repainted pair must still be consumed together.
    const chars = [cell("\xa4", true), cell("1"), ...ascii("23")];
    expect(detectPixivIds(chars)).toEqual([]);
    expect(detectPixivIds([cell("\xa4", true), cell("1")])).toEqual([]);
  });

  test.each([
    "foo123", "123bar", "_123", "123_", "@123", "#12345678", "abc-123",
    "https://www.pixiv.net/artworks/146814133", "example.test?x=123", "foo\\123",
    "1.2.3.4", "123.456", "1,234,567", "2026-11-06", "11/06", "12:34", "-123", "+123", "123%",
  ])("preserves identifiers and numeric compounds: %s", text => {
    expect(queries(text)).toEqual([]);
  });

  test("never splits an existing URL, even if only an inner cell is flagged", () => {
    const chars = ascii("65847159 117918634");
    chars[3].isPartOfURL = () => true;
    expect(detectPixivIds(chars)).toEqual([
      { startCol: 9, endCol: 18, query: "117918634" },
    ]);
  });

  test("only matches comment content, not its author, date or IP metadata", () => {
    const text = "xx user123: 65964428   127.0.0.1 11/06 12:34";
    const ann = { userid: "user123", contentCol: 12, contentEnd: 20 };
    expect(queries(text, ann)).toEqual(["65964428"]);
    expect(queries(text, { ...ann, hidden: true })).toEqual([]);
    expect(queries(text, { userid: "user123" })).toEqual([]);
    expect(queries("[123] author 2026-11-06", { modern: true })).toEqual([]);
  });

  test("trusted content edges permit an ID without whitespace in adjacent metadata", () => {
    const text = "xx user123:65964428 11/06 12:34";
    const ann = { userid: "user123", contentCol: 11, contentEnd: 19 };
    expect(queries(text, ann)).toEqual(["65964428"]);
    expect(queries(text)).toEqual([]);
    expect(queries("xx user123:(65964428) 11/06 12:34", { ...ann, contentEnd: 21 })).toEqual([]);
  });

  test("reconstructed comments use merged content bounds without joining IDs", () => {
    const comment = (content, time) => [
      ...dbcs(), ...ascii(` user123: ${content.padEnd(30)} ${time}`),
    ];
    const lines = [comment("65964428", "11/06 12:34"), comment("117918634", "11/06 12:35")];
    const merged = buildMergedCommentChars(lines, { rows: [0, 1] });
    const found = detectPixivIds(merged.chars, "", {
      userid: "user123", contentCol: merged.contentStart, contentEnd: merged.tailStart,
    });
    expect(found.map(x => x.query)).toEqual(["65964428", "117918634"]);
    expect(found[1].startCol).toBe(found[0].endCol + 1);
    expect(merged.chars[found[0].endCol].ch).toBe("\n");
  });

  test("handles empty, sparse and incomplete rows", () => {
    expect(detectPixivIds(null)).toEqual([]);
    expect(detectPixivIds([])).toEqual([]);
    expect(detectPixivIds([null, undefined, cell("1")])).toEqual([]);
    expect(detectPixivIds([cell("1"), null])).toEqual([]);
    expect(detectPixivIds([cell("\u3000", true), ...ascii("65847159")])).toEqual([]);
    expect(detectPixivIds([...ascii("65847159"), cell("\u3000", true)])).toEqual([]);
    expect(detectPixivIds([cell("\xa4", true), cell(" "), ...ascii("65847159")])).toEqual([]);
  });
});
