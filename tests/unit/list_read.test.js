// @unit-env browser
// 已讀文章低亮（pref dimReadArticles）的已讀判定：comment_parse#isListRowRead。
// 規則出處 pttbbs `mbbsd/bbs.c#readdoent`：type 字元畫在 cell 8（`%7d` + 空白 + type），
// 置底列（"  " + "  ★ "）同樣剛好 7 格。判定按 cell 讀，不走 rowToText 字串索引。
import { isListRowRead, isMailListRow, isMailRowRead } from "../../src/js/comment_parse";
import { computeAnnotations } from "../../src/js/screen_annotations";
import { row, seg } from "./helpers/screen_fixtures";

const withType = (type, prefix = " 350024") =>
  row(seg(`${prefix} ${type} 2 6/14 someone      □ [心得] 測試`));

describe("isListRowRead", () => {
  test.each([" ", "m", "s", "*"])("已讀標記 %j ⇒ true", (t) => {
    expect(isListRowRead(withType(t))).toBe(true);
  });

  test.each(["+", "~", "M", "=", "S", "#"])("未讀標記 %j ⇒ false", (t) => {
    expect(isListRowRead(withType(t))).toBe(false);
  });

  test.each(["!", "D"])("蓋掉未讀資訊的標記 %j ⇒ false（不判定、不低亮）", (t) => {
    expect(isListRowRead(withType(t))).toBe(false);
  });

  test("置底列（★）同一格位", () => {
    expect(isListRowRead(withType(" ", "    ★"))).toBe(true);
    expect(isListRowRead(withType("+", "    ★"))).toBe(false);
  });

  test("舊游標 ● 佔 cell 0–1，不影響 cell 8", () => {
    expect(isListRowRead(withType(" ", "●50024"))).toBe(true);
    expect(isListRowRead(withType("+", "●50024"))).toBe(false);
  });

  test("非列表列／空列 ⇒ false", () => {
    expect(isListRowRead(row(seg("")))).toBe(false);
    expect(isListRowRead(row(seg("   編號    日 期 作  者       文  章  標  題")))).toBe(false);
    expect(isListRowRead(null)).toBe(false);
  });
});

// The mailbox (#196): pttbbs `mbbsd/mail.c#maildoent` prints the cursor cell,
// "%5d %c " (number in cells 1-5, type in cell 7), then the date from cell 9,
// the sender from 15 and the title from 30. Constructed from that source: no
// real recording of the mail list exists.
const mailRow = (type, cursor = " ", from = "carol") =>
  row(seg(`${cursor}   12 ${type} 11/05 ${from.padEnd(15)}◇ 聚會時間`));

describe("mail list rows", () => {
  test.each([" ", "m", "r"])("read mark %j ⇒ read", (t) => {
    expect(isMailListRow(mailRow(t))).toBe(true);
    expect(isMailRowRead(mailRow(t))).toBe(true);
  });

  test.each(["+", "M", "R"])("unread mark %j ⇒ not read", (t) => {
    expect(isMailRowRead(mailRow(t))).toBe(false);
  });

  test("the cursor row is a mail row too", () => {
    expect(isMailListRow(mailRow(" ", ">"))).toBe(true);
    expect(isMailRowRead(mailRow(" ", ">"))).toBe(true);
  });

  test("header, blank and article rows are not mail rows", () => {
    expect(isMailListRow(row(seg("  編號   日 期 作 者          信  件  標  題")))).toBe(false);
    expect(isMailListRow(row(seg("")))).toBe(false);
    expect(isMailListRow(withType(" "))).toBe(false);
    expect(isMailListRow(null)).toBe(false);
  });

  test("easy reading's mail list marks read rows and hides none, whatever the blacklist", () => {
    const lines = [mailRow(" ", " ", "alice"), mailRow("+", ">", "bob"), row(seg(""))];
    const { annotations } = computeAnnotations(lines, {
      pageState: 2,
      listEasyReading: true,
      mailList: true,
      blacklist: new Set(["alice", "bob"]),
      titleBlacklist: ["聚會"],
    });
    expect(annotations[0]).toEqual({ listRead: true });
    expect(annotations[1]).toBeUndefined();
    expect(annotations[2]).toBeUndefined();
  });
});
