// @unit-env browser
// The mail list as real PTT paints it (#196), fed through the app's own
// TermBuf/AnsiParser: one synchronized-update frame on an 80x45 terminal with
// a short mailbox. The text is invented; the escape structure follows the
// real frame, and one property of it matters here: the column header (row 2)
// is the 30;47 bar of mail.c's mail_coldefs, but its capacity tag
// 「(容量:n/m篇)」 at the right end is drawn on 42 green. The bar is therefore
// not one colour up to cols-10, which is what every list check read as the
// header being reversed: the list was never recognized, and the screen stayed
// native.
import { TermBuf } from "../../src/js/term_buf";
import { AnsiParser } from "../../src/js/ansi_parser";
import { u2b } from "../../src/js/string_util";
import { listHeaderReversed } from "../../src/js/screen_titles";
import { ListSession } from "../../src/js/list_session";
import { loadBig5Tables } from "./helpers/load_big5_tables";

const COLS = 80;
const ROWS = 45;

const width = (s) => {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return w;
};
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));

// The capacity tag's mailbox size changes the bar's length: `used`/`limit`.
const mailListFrame = ({ used = 2, limit = 200 } = {}) => {
  const tag = "(容量:" + used + "/" + limit + "篇) ";
  return (
    "\x1b[?2026h\x1b[H\x1b[2J" +
    "\x1b[1;37;44m【郵件選單】                     \x1b[33m批踢踢實業坊\x1b[0;1;37;44m" +
    " ".repeat(34) +
    "\r\n\x1b[m[←]離開 [→]讀信 [z]信件夾 [/]搜尋 [a]找作者 [w]丟水球\r\n" +
    "\x1b[30;47m" +
    pad("  編號   日 期 作 者          信  件  標  題", COLS - width(tag) - width("[外信:開] ")) +
    "[外信:開] \x1b[42m" +
    tag +
    "\x1b[4;6H\x1b[m1   11/09 [備.忘.錄]     ◇ (sender) Re: 讀書會的時間…\r\n" +
    ">    2   11/10 sender\x1b[5;31HR: 讀書會的時間\r" +
    "\x1b[45;1H\x1b[34;46m 信件列表 \x1b[30;47m \x1b[31m(^P)\x1b[30m寄信 \x1b[31m(y)\x1b[30m回信 " +
    "\x1b[31m(d)\x1b[30m刪信       \x1b[31m(←)\x1b[30m離開 \x1b[31m(h)\x1b[30m說明 \x1b[m" +
    "\x1b[5;1H\x1b[?2026l"
  );
};

describe("the mail list frame as real PTT paints it", () => {
  beforeAll(() => loadBig5Tables());
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function paint(screen) {
    const buf = new TermBuf(COLS, ROWS);
    buf.setView({
      update() {},
      updateCursorPos() {},
      refreshCursorVisibility() {},
      charset: "big5",
      blinkOn: false,
    });
    buf.useMouseBrowsing = false;
    new AnsiParser(buf).feed(u2b(screen));
    vi.advanceTimersByTime(300);
    return buf;
  }

  test.each([
    [2, 200],
    [1000, 1000],
  ])("the header bar before the capacity tag (%i/%i) counts as reversed", (used, limit) => {
    expect(listHeaderReversed(paint(mailListFrame({ used, limit })))).toBe(true);
  });

  test("the terminal reads the screen as a list", () => {
    expect(paint(mailListFrame()).pageState).toBe(2);
  });

  test("list easy reading classifies it as the clean mail list", () => {
    const buf = paint(mailListFrame());
    const facts = ListSession.prototype._collectFacts.call(
      { _termBuf: buf, _messageRows: () => ({}), _footerText: null },
      null,
    );
    expect(facts.kind).toBe("clean-list");
    expect(facts.boardName).toBe("【郵件選單】");
  });

  test("an article list's header still has to be one colour across", () => {
    const buf = paint(
      "\x1b[H\x1b[2J\x1b[1;37;44m" +
        pad("【板主:someone】     看板《Test》", COLS) +
        "\x1b[m\r\n[←]離開 [→]閱讀\r\n\x1b[30;47m" +
        pad("   編號    日 期 作  者       文  章  標  題", COLS - 20) +
        "\x1b[42m" +
        " ".repeat(20) +
        "\x1b[m\x1b[5;1H",
    );
    expect(listHeaderReversed(buf)).toBe(false);
  });
});
