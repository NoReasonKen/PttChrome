// @unit-env browser
import { TermView } from "../../src/js/term_view";

function makeView({ reflow = true } = {}) {
  const view = Object.create(TermView.prototype);
  Object.assign(view, {
    reflow,
    innerBounds: { width: 390, height: 900 },
    reflowWidth: reflow ? 390 : null,
    buf: { cols: 80, rows: 24 },
    mainDisplay: document.createElement("div"),
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
  view.setTermFontSize(8, 16);
  view.componentScreen.notifyLayoutChanged.mockClear();
  return view;
}

test("mobile preview measurements expire when only viewport height changes", () => {
  const view = makeView();
  view.innerBounds.height = 600;
  view.setTermFontSize(8, 16);
  expect(view.componentScreen.notifyLayoutChanged).toHaveBeenCalledTimes(1);
});

test("unchanged mobile viewport geometry retains preview measurements", () => {
  const view = makeView();
  view.setTermFontSize(8, 16);
  expect(view.componentScreen.notifyLayoutChanged).not.toHaveBeenCalled();
});

test("column width changes still expire preview measurements", () => {
  const view = makeView();
  view.setTermFontSize(9, 18);
  expect(view.componentScreen.notifyLayoutChanged).toHaveBeenCalledTimes(1);
});

test("desktop preview measurements do not depend on viewport height", () => {
  const view = makeView({ reflow: false });
  view.innerBounds.height = 600;
  view.setTermFontSize(8, 16);
  expect(view.componentScreen.notifyLayoutChanged).not.toHaveBeenCalled();
});

test("the mobile reading viewport fits landscape while terminal resizing waits for a response", () => {
  const view = makeView();
  view.buf.rows = 50;
  view.innerBounds = { width: 896, height: 412 };
  view.reflowWidth = 896;
  view.topInset = 48;
  view.keyboardInset = 48;
  view.setTermFontSize(8, 16);
  expect(parseFloat(view.mainDisplay.style.height)).toBe(316);
  expect(view.buf.rows).toBe(50);
});
