// @unit-env browser
// Blink phase is local to displayed rendering roots. Parked lists must not
// activate the foreground phase or inherit its recurring style changes.
// Real timer/CSS coverage: tests/e2e/offline/blink_cursor.offline.spec.js.
import { TermView } from "../../src/js/term_view";
import { TermBuf } from "../../src/js/term_buf";

function makeView() {
  const main = document.createElement("div");
  main.className = "main";
  const cursor = document.createElement("div");
  cursor.id = "cursor";
  document.body.append(main, cursor);
  return {
    mainDisplay: main,
    bbsCursor: cursor,
    _blinkPhase: false,
    blinkOn: false,
    buf: { queueUpdate: vi.fn() },
    onBlink: TermView.prototype.onBlink,
    toggleBlinkPhase: TermView.prototype.toggleBlinkPhase,
  };
}

function bodyBlink() {
  return document.body.classList.contains("blink--active");
}

function surfaceBlink(root) {
  return root.classList.contains("blink--active");
}

function blinkText(root, className = "qq1") {
  const span = document.createElement("span");
  span.className = className;
  root.appendChild(span);
  return span;
}

function listLayer(parked = false) {
  const root = document.createElement("div");
  root.className = "main";
  root.setAttribute("data-stack-layer", "articleList");
  if (parked) root.setAttribute("data-stack-parked", "");
  root.inert = true;
  root.setAttribute("aria-hidden", "true");
  document.body.appendChild(root);
  blinkText(root);
  return root;
}

function cursorOn(v) {
  return v.bbsCursor.classList.contains("cursor--blink-on");
}

describe("TermView.toggleBlinkPhase", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.className = "";
  });

  test("畫面沒有閃爍字：游標交替明暗，body class 從頭到尾不掛", () => {
    const v = makeView();
    const seen = [];
    for (let i = 0; i < 4; i++) {
      v.toggleBlinkPhase();
      expect(bodyBlink()).toBe(false);
      expect(surfaceBlink(v.mainDisplay)).toBe(false);
      seen.push(cursorOn(v));
    }
    expect(seen).toEqual([true, false, true, false]);
  });

  test("blink text alternates its rendering root without changing the body", () => {
    const v = makeView();
    blinkText(v.mainDisplay, "q7 b0 qq0");
    const seen = [];
    for (let i = 0; i < 4; i++) {
      v.toggleBlinkPhase();
      seen.push(surfaceBlink(v.mainDisplay));
      expect(bodyBlink()).toBe(false);
    }
    expect(seen).toEqual([true, false, true, false]);
  });

  test("二色字的閃爍（qq2）也算", () => {
    const v = makeView();
    blinkText(v.mainDisplay, "o w7 q3 b0 qq2");
    v.toggleBlinkPhase();
    expect(surfaceBlink(v.mainDisplay)).toBe(true);
    expect(bodyBlink()).toBe(false);
  });

  test("removing blink text clears the rendering root phase", () => {
    const v = makeView();
    const span = blinkText(v.mainDisplay);
    v.toggleBlinkPhase();
    expect(surfaceBlink(v.mainDisplay)).toBe(true);
    span.remove();
    v.toggleBlinkPhase();
    v.toggleBlinkPhase();
    expect(surfaceBlink(v.mainDisplay)).toBe(false);
    expect(bodyBlink()).toBe(false);
  });

  test("a parked list cannot activate the foreground blink phase", () => {
    const v = makeView();
    const parked = listLayer(true);
    for (let i = 0; i < 4; i++) {
      v.toggleBlinkPhase();
      expect(surfaceBlink(v.mainDisplay)).toBe(false);
      expect(surfaceBlink(parked)).toBe(false);
      expect(bodyBlink()).toBe(false);
    }
  });

  test("foreground blink text does not change the parked list phase", () => {
    const v = makeView();
    blinkText(v.mainDisplay);
    const parked = listLayer(true);
    v.toggleBlinkPhase();
    expect(surfaceBlink(v.mainDisplay)).toBe(true);
    expect(surfaceBlink(parked)).toBe(false);
    expect(bodyBlink()).toBe(false);
  });

  test("a revealed inert list blinks independently of a plain foreground", () => {
    const v = makeView();
    const revealed = listLayer();
    v.toggleBlinkPhase();
    expect(surfaceBlink(revealed)).toBe(true);
    expect(surfaceBlink(v.mainDisplay)).toBe(false);
    expect(bodyBlink()).toBe(false);
  });

  test("the color-helper preview blinks outside the main rendering roots", () => {
    const v = makeView();
    const preview = document.createElement("div");
    preview.className = "InputHelperModal__Preview";
    document.body.appendChild(preview);
    blinkText(preview, "q7 b0 qq0");
    const seen = [];
    for (let i = 0; i < 4; i++) {
      v.toggleBlinkPhase();
      seen.push(surfaceBlink(preview));
      expect(surfaceBlink(v.mainDisplay)).toBe(false);
      expect(bodyBlink()).toBe(false);
    }
    expect(seen).toEqual([true, false, true, false]);
  });
});

describe("TermView.onBlink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("頁面可見：排一次 notify", () => {
    const v = makeView();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    v.onBlink();
    expect(v.blinkOn).toBe(true);
    expect(v.buf.queueUpdate).toHaveBeenCalledTimes(1);
  });

  test("頁面隱藏：不閃、不排 notify", () => {
    const v = makeView();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    v.onBlink();
    expect(v.blinkOn).toBe(false);
    expect(v.buf.queueUpdate).not.toHaveBeenCalled();
  });
});

describe("TermBuf.notify 的閃爍出口", () => {
  test("blinkOn 時交給 view.toggleBlinkPhase，不自己切換 body class", () => {
    document.body.className = "";
    const toggleBlinkPhase = vi.fn();
    const buf = new TermBuf(80, 24);
    buf.setView({
      update() {},
      updateCursorPos() {},
      refreshCursorVisibility() {},
      toggleBlinkPhase,
      blinkOn: true,
    });
    buf.useMouseBrowsing = false;
    buf.notify();
    expect(toggleBlinkPhase).toHaveBeenCalledTimes(1);
    expect(buf.view.blinkOn).toBe(false);
    expect(document.body.classList.contains("blink--active")).toBe(false);
  });
});
