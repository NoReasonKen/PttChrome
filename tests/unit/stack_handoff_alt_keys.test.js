// Handoff.takeKey on a revealed article list (#293): an Alt remap (Alt＝PTT's
// Ctrl, also the phone's sticky Ctrl) is judged as the Ctrl key it stands for,
// by the list's own _classifyKey, so a Ctrl shortcut needs nothing per key.
import { Handoff } from "../../src/js/stack_handoff";
import { PAGE } from "../../src/js/page_stack";
import { ListSession } from "../../src/js/list_session";

function keyEvent(key, mods = {}) {
  return {
    key,
    code: mods.code,
    ctrlKey: !!mods.ctrlKey,
    altKey: !!mods.altKey,
    shiftKey: !!mods.shiftKey,
    metaKey: false,
    repeat: false,
    getModifierState: () => false,
  };
}

function handoff() {
  const hints = [];
  const sent = [];
  const h = Object.create(Handoff.prototype);
  const session = Object.create(ListSession.prototype);
  session._boardName = "Test";
  session._footerText = " 文章列表  (←)離開";
  Object.assign(h, {
    layer: { listPage: { session } },
    core: { listSession: session, view: { flashListHint: (...a) => hints.push(a), sendKeyAsUser: (...a) => sent.push(a) } },
    legs: [],
    target: PAGE.ARTICLE_LIST,
    toolbar: {},
    holdKey: (send) => (send(), true),
  });
  return { h, hints, sent };
}

describe("Handoff.takeKey: an Alt remap on the article list is its Ctrl key", () => {
  test.each(["q", "w", "y"])("Alt+%s is held for PTT, as its Ctrl key is", (key) => {
    const alt = handoff();
    expect(alt.h.takeKey(keyEvent(key, { altKey: true, code: "Key" + key.toUpperCase() }))).toBe("heldForHandoff");
    const ctrl = handoff();
    expect(ctrl.h.takeKey(keyEvent(key, { ctrlKey: true }))).toBe("heldForHandoff");
    expect(alt.hints).toEqual([]);
  });

  test("an Alt letter the list does not present is refused with the hint, like its Ctrl key", () => {
    for (const key of ["t", "j", "p"]) {
      const alt = handoff();
      expect(alt.h.takeKey(keyEvent(key, { altKey: true, code: "Key" + key.toUpperCase() }))).toBe("refusedOnLayer");
      expect(alt.hints).toHaveLength(1);
      expect(alt.sent).toEqual([]);
    }
  });
});
