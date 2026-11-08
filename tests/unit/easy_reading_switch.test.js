// Easy reading is one switch for the whole application (enableEasyReading).
// Everything easy reading does runs whenever it is on and never while it is off,
// and code asks one question: easyReadingOn(values).
//
// Two things are guarded:
//   1. easyReadingOn answers from the stored switch alone.
//   2. src never reads one of the per-behaviour keys the switch replaced. They
//      are not migrated, so an old browser still stores them: a read would make
//      a behaviour follow a stale value instead of the switch, which the screen
//      does not show. A static scan of src guards it.
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PREFS, easyReadingOn } from "../../src/js/pref_storage";

// The per-behaviour switches easy reading replaced, plus the removed End switch.
const REMOVED_KEYS = [
  "articleHorizontalGestures",
  "enableEasyReadingList",
  "enableBoardListSmoothScroll",
  "enableListNativeAutoResume",
  "skipBoardEntryScreen",
  "enableHelpMenuPopup",
  "reconnectResume",
  "resumeLastPlace",
  "enableHomeDashboard",
  "enableSplitReading",
  "enableNextArticleCard",
  "endTurnsOnLiveUpdate",
  "refreshKeyIntercept",
  "searchKeyOpensModal",
  "enableLongPush",
  "pushKeyOpensLongPush",
  "enableCommentBar",
  "easyReadingBrowserFind",
  "easyReadingEndSwitchNative",
  "easyReadingEndSwitchKey",
];

describe("easyReadingOn", () => {
  test("on by default", () => {
    expect(DEFAULT_PREFS.enableEasyReading).toBe(true);
    expect(easyReadingOn(DEFAULT_PREFS)).toBe(true);
  });

  test("off when the switch is off, whatever an old browser stores for a removed key", () => {
    const stale = Object.fromEntries(REMOVED_KEYS.map((k) => [k, true]));
    expect(easyReadingOn({ ...DEFAULT_PREFS, ...stale, enableEasyReading: false })).toBe(false);
  });

  test("no values ⇒ off", () => {
    expect(easyReadingOn(null)).toBe(false);
    expect(easyReadingOn(undefined)).toBe(false);
    expect(easyReadingOn({})).toBe(false);
  });

  test("the removed keys are not settings any more", () => {
    for (const key of REMOVED_KEYS) expect(key in DEFAULT_PREFS, key).toBe(false);
  });
});

describe("src never reads a removed key (static scan)", () => {
  const SRC = path.join(process.cwd(), "src");
  const files = fs
    .readdirSync(SRC, { recursive: true })
    .filter((f) => /\.(js|jsx)$/.test(f))
    .map((f) => ({ rel: f.split(path.sep).join("/"), text: fs.readFileSync(path.join(SRC, f), "utf8") }));
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // The resume controller lives on the app as `reconnectResume`; that object is
  // not the old preference.
  const stripController = (s) => s.replace(/\b(?:core|this|app|readingCore)\??\.reconnectResume\b/g, "");
  const keyAccess = new RegExp(`(?:\\.|\\[["'])(${REMOVED_KEYS.join("|")})\\b`, "g");

  test("no property read of a removed key", () => {
    const bad = [];
    for (const { rel, text } of files) {
      const code = stripController(stripComments(text));
      for (const m of code.matchAll(keyAccess)) bad.push(`${rel}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  test("the scan itself finds a read", () => {
    const code = stripController(stripComments("if (prefs.enableHomeDashboard) core.reconnectResume.capture();"));
    expect([...code.matchAll(keyAccess)].map((m) => m[1])).toEqual(["enableHomeDashboard"]);
  });
});
