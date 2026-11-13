// A key the reading keys did not take, while an article is open in easy
// reading (#160): a help or reply key keeps the native route, every other PTT command
// is refused, and keys PTT never sees are left to the browser or the app.
import { articleLeftoverKey } from "../../src/js/easy_reading";

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
