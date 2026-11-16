// A key the reading keys did not take, while an article is open in easy
// reading (#160): a help or reply key keeps the native route, every other PTT command
// is refused, and keys PTT never sees are left to the browser or the app.
import { EasyReading, articleLeftoverKey, articleReadingKey, articleWouldRefuse } from "../../src/js/easy_reading";

const ev = (key, mods = {}) => ({
  key,
  code: mods.code || (key.length === 1 ? "Key" + key.toUpperCase() : key),
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods
});

test("help and reply keys keep the native route", () => {
  for (const k of ["h", "H", "?", "y", "Y", "r", "R"]) expect(articleLeftoverKey(ev(k))).toBe("native");
});

test("other PTT command keys are refused", () => {
  for (const k of ["s", "#", "/", ";", ":", "Q", "E", "T", "v", "o", "p", "5", "c"])
    expect(articleLeftoverKey(ev(k))).toBe("refuse");
  for (const k of ["Escape", "Delete", "Insert"]) expect(articleLeftoverKey(ev(k))).toBe("refuse");
});

test("Ctrl and Alt letter combinations are PTT commands too", () => {
  expect(articleLeftoverKey(ev("r", { ctrlKey: true }))).toBe("refuse");
  expect(articleLeftoverKey(ev("u", { ctrlKey: true }))).toBe("refuse");
  expect(articleLeftoverKey(ev("p", { altKey: true }))).toBe("refuse");
  // Ctrl+Y is not a reply.
  expect(articleLeftoverKey(ev("y", { ctrlKey: true }))).toBe("refuse");
});

test("clipboard and browser shortcuts are left alone", () => {
  expect(articleLeftoverKey(ev("c", { ctrlKey: true }))).toBe(null);
  expect(articleLeftoverKey(ev("a", { ctrlKey: true }))).toBe(null);
  expect(articleLeftoverKey(ev("v", { ctrlKey: true }))).toBe(null);
  expect(articleLeftoverKey(ev("Insert", { shiftKey: true }))).toBe(null);
  expect(articleLeftoverKey(ev("c", { metaKey: true }))).toBe(null);
  expect(articleLeftoverKey(ev("ArrowLeft", { altKey: true }))).toBe(null);
});

test("keys that send PTT nothing are not commands", () => {
  for (const k of ["CapsLock", "F5", "Shift", "NumLock"]) expect(articleLeftoverKey(ev(k))).toBe(null);
});

// #222: the help menu sheet offers a row only when typing its key would do
// something in the article.
describe("articleWouldRefuse (help menu rows over an article)", () => {
  const prefs = {};
  test("reading keys, push keys, reply and help are kept", () => {
    for (const key of ["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End", "0", "$", "g", "G", "j", "k", "ArrowLeft", "Enter", "a", "=", "[", "]", "X", "%", "y", "r", "h"])
      expect([key, articleWouldRefuse({ key }, prefs)]).toEqual([key, false]);
    expect(articleWouldRefuse({ key: "f", ctrlKey: true }, prefs)).toBe(false);
    expect(articleWouldRefuse({ key: "b", ctrlKey: true }, prefs)).toBe(false);
  });

  test("refused, swallowed and find keys are not", () => {
    for (const key of ["s", "Q", "E", "c", "Tab", "/"]) expect([key, articleWouldRefuse({ key }, prefs)]).toEqual([key, true]);
    expect(articleWouldRefuse({ key: "x", ctrlKey: true }, prefs)).toBe(true);
    expect(articleWouldRefuse({ key: "u", ctrlKey: true }, prefs)).toBe(true);
  });

  test("articleReadingKey names what the article does with a key", () => {
    expect(articleReadingKey(ev("PageDown"))).toBe("pageDown");
    expect(articleReadingKey(ev("f", { ctrlKey: true }))).toBe("scrollPageDown");
    expect(articleReadingKey(ev("=", { code: "Equal" }))).toBe("threadJump");
    expect(articleReadingKey(ev("s"))).toBe(null);
  });
});

// #222: the help key opens the help sheet at once (help_menu.expect), a modal
// before the key's own keypress, which the modal would keep from PTT: the help
// key goes out from the keydown, and the keydown is stopped.
describe("the help key while the help sheet opens", () => {
  const article = (phaseAfter) => {
    const sent = [];
    const core = { helpMenu: { phase: "idle" }, view: { _send: (b) => sent.push(b) } };
    const er = Object.create(EasyReading.prototype);
    er._core = core;
    er.enterNativeRoute = () => {
      core.helpMenu.phase = phaseAfter;
    };
    return { er, sent };
  };

  test("the sheet is loading ⇒ the key is sent now and the keydown stopped", () => {
    for (const k of ["h", "H", "?"]) {
      const { er, sent } = article("loading");
      expect(er._leftoverKey(ev(k))).toBe(true);
      expect(sent).toEqual([k]);
    }
  });

  test("no sheet (popup off) or a reply key ⇒ left to the keypress as before", () => {
    const off = article("idle");
    expect(off.er._leftoverKey(ev("h"))).toBe(false);
    expect(off.sent).toEqual([]);
    const reply = article("loading");
    expect(reply.er._leftoverKey(ev("y"))).toBe(false);
    expect(reply.sent).toEqual([]);
  });
});

// #196: a mail read in easy reading. Easy reading presents reading it, not
// answering it (sending is #230): the reply keys of mail.c#mail_read_cmds
// (y Y r R) are refused, and so are the same-thread jumps, which easy reading
// presents for a board's articles only. Help keeps the native route.
describe("a mail open in easy reading", () => {
  const mail = { mail: true };
  test("reply keys are refused, help keeps the native route", () => {
    for (const k of ["y", "Y", "r", "R"]) expect([k, articleLeftoverKey(ev(k), mail)]).toEqual([k, "refuse"]);
    for (const k of ["h", "H", "?"]) expect(articleLeftoverKey(ev(k), mail)).toBe("native");
  });

  test("the help sheet's rows follow (articleWouldRefuse)", () => {
    for (const key of ["y", "r", "=", "[", "a", "f"]) expect([key, articleWouldRefuse({ key }, {}, mail)]).toEqual([key, true]);
    for (const key of ["ArrowDown", "PageDown", " ", "ArrowLeft", "End", "h"])
      expect([key, articleWouldRefuse({ key }, {}, mail)]).toEqual([key, false]);
  });

  test("the reader knows a mail by the list it was opened from", () => {
    const er = Object.create(EasyReading.prototype);
    er._core = { listSession: { state: "suspended", isMailList: () => true } };
    expect(er._readingMail()).toBe(true);
    er._core.listSession.isMailList = () => false;
    expect(er._readingMail()).toBe(false);
    er._core = { listSession: { state: "idle", isMailList: () => true } };
    expect(er._readingMail()).toBe(false);
  });

  test("a reply key or a thread jump over a mail is refused with the hint", () => {
    const hints = [];
    const er = Object.create(EasyReading.prototype);
    er._core = { listSession: { state: "suspended", isMailList: () => true } };
    er._view = { flashListHint: (...a) => hints.push(a) };
    er.enterNativeRoute = () => { throw new Error("no native route for a mail reply"); };
    expect(er._leftoverKey(ev("y"))).toBe(true);
    expect(hints).toHaveLength(1);
  });
});
