// @unit-env browser
// Android text scaling (the WebView's text zoom, Chrome's text size) multiplies every
// computed font-size and px line-height by one factor. A phone showed ×1.08: each grid
// row rendered 10.7px for a 9.9px cell, so 45 rows overflowed the screen by two rows.
// The terminal measures the factor on a rendered row and writes chh / factor.
import { TermView } from "../../src/js/term_view";
import { textScaleAt } from "../../src/js/term_size";

// The browser under test: font-size and line-height of a row = written × scale(written).
function installBrowser(view, { fontScale, lineScale = fontScale }) {
  const px = (v) => parseFloat(v);
  vi.stubGlobal("getComputedStyle", () => {
    const fs = px(view.mainDisplay.style.fontSize);
    const lh = px(view.mainDisplay.style.lineHeight);
    return { fontSize: fs * fontScale(fs) + "px", lineHeight: lh * lineScale(lh) + "px" };
  });
  const rendered = () => getComputedStyle(view.mainContainer.firstChild);
  return { rendered };
}

function makeView() {
  const view = Object.create(TermView.prototype);
  const mainContainer = document.createElement("div");
  const row = document.createElement("span");
  row.setAttribute("type", "bbsrow");
  row.setAttribute("srow", "0");
  row.textContent = "ROW";
  mainContainer.appendChild(row);
  Object.assign(view, {
    reflow: false,
    innerBounds: { width: 411, height: 840 },
    reflowWidth: null,
    buf: { cols: 80, rows: 45 },
    mainDisplay: document.createElement("div"),
    mainContainer,
    bbsCursor: document.createElement("div"),
    lastRowDiv: document.createElement("div"),
    bbscore: { getFirstGridOffsets: () => ({ top: 0, left: 0 }) },
    componentScreen: { notifyLayoutChanged: vi.fn() },
    updateExitHintBandGeometry: vi.fn(),
    updateReverseScaleCss: vi.fn(),
    updateCursorPos: vi.fn(),
    bbsViewMargin: 0,
    keyboardInset: 0,
    topInset: 0,
  });
  return view;
}

// The render path calls syncTextScale after every screen; a few renders settle it.
function settle(view) {
  for (let i = 0; i < 5; i++) view.syncTextScale();
}

afterEach(() => vi.unstubAllGlobals());

test("a phone's text scaling leaves the rendered cell at chh", () => {
  const view = makeView();
  const b = installBrowser(view, { fontScale: () => 1.08 });
  view.setTermFontSize(4.95, 9.9);
  settle(view);
  expect(parseFloat(b.rendered().fontSize)).toBeCloseTo(9.9, 2);
  expect(parseFloat(b.rendered().lineHeight)).toBeCloseTo(9.9, 2);
});

test("a scale that depends on the size still settles on chh", () => {
  const view = makeView();
  const b = installBrowser(view, { fontScale: (s) => 1 + s / 100 });
  view.setTermFontSize(8, 16);
  settle(view);
  expect(parseFloat(b.rendered().lineHeight)).toBeCloseTo(16, 2);
});

test("without text scaling the terminal writes chh as is", () => {
  const view = makeView();
  installBrowser(view, { fontScale: () => 1 });
  view.setTermFontSize(8, 16);
  settle(view);
  expect(view.mainDisplay.style.fontSize).toBe("16px");
  expect(view.mainDisplay.style.lineHeight).toBe("16px");
});

test("a minimum font size (font clamped, line-height not) is not text scaling", () => {
  const view = makeView();
  installBrowser(view, { fontScale: (s) => Math.max(12, s) / s, lineScale: () => 1 });
  view.setTermFontSize(4.95, 9.9);
  settle(view);
  expect(view.mainDisplay.style.lineHeight).toBe("9.9px");
});

test("the cursor has no text, is not scaled and keeps chh", () => {
  const view = makeView();
  installBrowser(view, { fontScale: () => 1.08 });
  view.setTermFontSize(4.95, 9.9);
  settle(view);
  expect(view.bbsCursor.style.fontSize).toBe("9.9px");
});

describe("textScaleAt", () => {
  test("uniform scaling of font and line-height", () => {
    expect(textScaleAt(10, 10.8, 10.8)).toBeCloseTo(1.08, 5);
  });
  test("font and line-height scaled apart ⇒ not text scaling", () => {
    expect(textScaleAt(9.9, 12, 9.9)).toBeNull();
  });
  test("unreadable measurements ⇒ null", () => {
    expect(textScaleAt(10, NaN, NaN)).toBeNull();
    expect(textScaleAt(10, 0, 0)).toBeNull();
  });
});
