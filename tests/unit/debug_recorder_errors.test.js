// @unit-env browser
// Errors the page reports while a debug recording runs: uncaught errors,
// unhandled rejections and console.error, written into the timeline as `error` logs.
// real-input: tests/e2e/offline/debug_record.offline.spec.js
import { vi } from "vitest";
import { DebugRecorder } from "../../src/js/debug_recorder";

function makeApp() {
  return {
    buf: { cols: 80, rows: 24 },
    view: {},
    onData() {},
    conn: { _sendRaw() {} },
  };
}

// The test runner prints dispatched error events through console.error too, so
// each test reads the logs of the kind it caused.
function errorLogs(json, kind) {
  return JSON.parse(json).events
    .filter(event => event.dir === "log" && event.tag === "error" && (!kind || event.info.kind === kind));
}

function errorWithStack(message, frames) {
  const error = new Error(message);
  error.stack = [`Error: ${message}`, ...frames].join("\n");
  return error;
}

let originalConsoleError;
beforeEach(() => {
  originalConsoleError = console.error;
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

describe("DebugRecorder errors", () => {
  it("records an uncaught error with its time, message and first stack frames", () => {
    const recorder = new DebugRecorder(makeApp());
    recorder.start();
    const error = errorWithStack("boom", [
      "    at a (http://host:8082/src/js/a.js?t=1:1:1)",
      "    at b (http://host:8082/src/js/b.js:2:2)",
      "    at c (http://host:8082/src/js/c.js:3:3)",
      "    at d (http://host:8082/src/js/d.js:4:4)",
      "    at e (http://host:8082/src/js/e.js:5:5)",
      "    at f (http://host:8082/src/js/f.js:6:6)",
    ]);
    window.dispatchEvent(new ErrorEvent("error", { message: "Uncaught Error: boom", error }));
    const [log] = errorLogs(recorder.stop(), "uncaught");

    expect(typeof log.t).toBe("number");
    expect(log.info.kind).toBe("uncaught");
    expect(log.info.message).toBe("Uncaught Error: boom");
    expect(log.info.stack).toEqual([
      "at a (http://host:8082/src/js/a.js:1:1)",
      "at b (http://host:8082/src/js/b.js:2:2)",
      "at c (http://host:8082/src/js/c.js:3:3)",
      "at d (http://host:8082/src/js/d.js:4:4)",
    ]);
  });

  it("records an unhandled rejection", () => {
    const recorder = new DebugRecorder(makeApp());
    recorder.start();
    const event = new Event("unhandledrejection");
    event.reason = errorWithStack("rejected", ["    at r (http://host/r.js:1:1)"]);
    window.dispatchEvent(event);
    const [log] = errorLogs(recorder.stop(), "rejection");

    expect(log.info).toEqual({ kind: "rejection", message: "Error: rejected", stack: ["at r (http://host/r.js:1:1)"] });
  });

  it("records console.error and still prints it", () => {
    const printed = console.error;
    const recorder = new DebugRecorder(makeApp());
    recorder.start();
    console.error("render failed:", errorWithStack("bad row", ["    at row (http://host/row.js:9:9)"]));
    const [log] = errorLogs(recorder.stop(), "console");

    expect(printed).toHaveBeenCalledTimes(1);
    expect(log.info).toEqual({
      kind: "console",
      message: "render failed: Error: bad row",
      stack: ["at row (http://host/row.js:9:9)"],
    });
  });

  it("names a ResizeObserver loop error as such", () => {
    const recorder = new DebugRecorder(makeApp());
    recorder.start();
    window.dispatchEvent(new ErrorEvent("error", {
      message: "ResizeObserver loop completed with undelivered notifications.",
    }));
    const [log] = errorLogs(recorder.stop(), "resize-observer-loop");

    expect(log.info).toEqual({
      kind: "resize-observer-loop",
      message: "ResizeObserver loop completed with undelivered notifications.",
    });
  });

  it("bounds the text and keeps screen content out", () => {
    const recorder = new DebugRecorder(makeApp());
    recorder.start();
    console.error(`cannot parse 推文內容很長的一行 ${"x".repeat(500)}`);
    console.error("bad row", { line: "文章內容" }, ["行"], 42);
    const [long, objects] = errorLogs(recorder.stop(), "console");

    expect(long.info.message.length).toBeLessThanOrEqual(200);
    expect(long.info.message).toMatch(/^cannot parse … x+…$/);
    expect(objects.info.message).toBe("bad row [Object] [Array] 42");
  });

  it("records nothing outside a recording and restores console.error on stop", () => {
    const printed = console.error;
    const recorder = new DebugRecorder(makeApp());
    recorder.start();
    expect(console.error).not.toBe(printed);
    const json = recorder.stop();
    expect(console.error).toBe(printed);

    window.dispatchEvent(new ErrorEvent("error", { message: "after stop" }));
    console.error("after stop");
    expect(errorLogs(json)).toEqual([]);
    expect(recorder.events.some(event => event.tag === "error")).toBe(false);
  });
});
