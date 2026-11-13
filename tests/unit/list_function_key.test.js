// 列表好讀模式下，滑鼠點畫面上的功能鍵按鈕（`[←]回上層` / `[→]閱讀` / `[c]新文章`）。
//
// 合約（v5 封閉互動，docs/easy-reading-list.md §Operation classes）：白名單以外的鍵一律拒絕（#159）：
// 不送、不切原生、給提示。滑鼠點功能鍵語意上完全等同按下那個鍵，所以走同一條路。
import { ListSession } from "../../src/js/list_session";
import { LEFT_ARROW } from "../../src/js/function_key_plan";

function rowOf(text) {
  return text.split("").map((c) => ({ ch: c, isLeadByte: false }));
}

function makeSession({ count = 8 } = {}) {
  const sent = [];
  const enqueued = [];
  const hints = [];
  const core = { conn: { isConnected: true, send: (d) => sent.push(d) } };
  const view = {
    hideCursor() {},
    showCursor() {},
    resetListAccumulation() {},
    flashListHint: (m) => hints.push(m),
    setListLoading() {},
    blacklist: new Set(),
    titleBlacklist: [],
    mouseListClickStart: "title",
  };
  const listLines = [];
  const listLineNums = [];
  for (let i = 0; i < count; ++i) {
    listLines.push(rowOf(`${101 + i} + author${i}   標題${i}`));
    listLineNums.push(101 + i);
  }
  const termBuf = {
    rows: 24,
    cols: 80,
    useMouseBrowsing: true,
    listLines,
    listLineNums,
    lineChangeds: new Array(24).fill(false),
    changed: false,
    // 靜置探針（非導覽操作完成後自動回好讀）會在 hold 期間量一次當下畫面，
    // 所以 stub 也要有 TermBuf 的畫面讀取介面（真的 TermBuf 一定有）。
    getRowText: () => "",
    isUnicolor: () => false,
    cur_x: 0,
    cur_y: 0,
    addEventListener() {},
    notify() {},
  };
  const queue = {
    idle: true,
    inFlightKind: null,
    flush() {},
    flushPending() {},
    flushPendingKind() {},
    hasKind: () => false,
    enqueue(cmd) {
      enqueued.push(cmd);
    },
    onSettle() {},
  };
  const s = new ListSession(core, view, termBuf, queue);
  s.state = "active";
  s._renderMode = "buffer";
  s._edgeUp = true;
  s._edgeDown = true;
  s._selectedNum = 103;
  s._serverNum = 103;
  s._topNum = 101;
  return { s, sent, enqueued, hints };
}

describe("接手與否", () => {
  test("原生鏡像（_renderMode native）→ 回 false，交給一般路徑", () => {
    const { s, enqueued } = makeSession();
    s._renderMode = "native";
    expect(s.onFunctionKey("d")).toBe(false);
    expect(enqueued).toEqual([]);
  });

  test("buffer 模式一律接手", () => {
    const { s } = makeSession();
    expect(s.onFunctionKey("d")).toBe(true);
  });
});

describe("忙碌時吞掉但**不靜默**", () => {
  test("opening：給提示、不排新指令", () => {
    const { s, enqueued, hints } = makeSession();
    s.state = "opening";
    expect(s.onFunctionKey("d")).toBe(true);
    expect(enqueued).toEqual([]);
    expect(hints.join()).toContain("開啟文章中");
  });

  test("functionMode + frozen（交易在飛）：給提示、不排新指令", () => {
    const { s, enqueued, hints } = makeSession();
    s.state = "functionMode";
    s._renderMode = "frozen";
    expect(s.onFunctionKey("d")).toBe(true);
    expect(enqueued).toEqual([]);
    expect(hints.join()).toContain("指令處理中");
  });
});

describe("白名單鍵走 reducer 的既有交易", () => {
  test("← ＝ leave：走 _beginLeave（frozen ＋ 排隊），絕不直送 byte", () => {
    const { s, sent, enqueued } = makeSession();
    expect(s.onFunctionKey(LEFT_ARROW)).toBe(true);
    expect(sent).toEqual([]);
    expect(enqueued.length).toBeGreaterThan(0);
    expect(s._renderMode).toBe("frozen");
  });

  test("↑ / ↓ ＝ nav：只動本地選取，一個 byte 都不送", () => {
    const { s, sent, enqueued } = makeSession();
    expect(s.onFunctionKey("\x1b[B")).toBe(true);
    expect(s._selectedNum).toBe(104);
    s.onFunctionKey("\x1b[A");
    expect(s._selectedNum).toBe(103);
    expect(sent).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  test("→ ＝ open：走序號跳轉交易", () => {
    const { s, sent, enqueued } = makeSession();
    expect(s.onFunctionKey("\x1b[C")).toBe(true);
    expect(s.state).toBe("opening");
    expect(sent).toEqual([]);
    expect(enqueued[0].keys).toBe("103\r");
  });
});

const KEY_HINT = "好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）";

describe("Outside the whitelist → refused (#159)", () => {
  test("[c], Ctrl-P and other unlisted bytes: nothing enqueued or sent, state unchanged, hint shown", () => {
    for (const b of ["c", "\x10"]) {
      const { s, sent, enqueued, hints } = makeSession();
      const hintArgs = [];
      s._view.flashListHint = (...a) => hintArgs.push(a);
      expect(s.onFunctionKey(b)).toBe(true);
      expect(sent).toEqual([]);
      expect(enqueued).toEqual([]);
      expect(s.state).toBe("active");
      expect(s._renderMode).toBe("buffer");
      expect(hintArgs).toEqual([[KEY_HINT, 4000, "error"]]);
      expect(hints).toEqual([]);
    }
  });

  test("a lagging real cursor does not start a sync leg", () => {
    const { s, enqueued } = makeSession();
    s._serverNum = 101;
    s.onFunctionKey("c");
    expect(enqueued).toEqual([]);
    expect(s._renderMode).toBe("buffer");
  });
});

describe("_classifyBytes is deliberately independent of _classifyKey", () => {
  // _classifyKey reads the characters q/e/j/k/n/p as navigation keys (what the
  // user pressed); at the byte level a 'q' is just a 'q'. Merging the two would
  // mix up "key" with "bytes to send".
  test("literal 'q' / 'j' / 'k' are unsupported at the byte level, not leave/nav", () => {
    ["q", "e", "j", "k", "n", "p", " "].forEach((b) => {
      const { s, enqueued } = makeSession();
      const selected = s._selectedNum;
      expect(s._classifyBytes(b).class, `byte ${JSON.stringify(b)}`).toBe("unsupported");
      s.onFunctionKey(b);
      expect(enqueued).toEqual([]);
      expect(s._selectedNum).toBe(selected);
      expect(s.state).toBe("active");
    });
  });
});

describe("onMouseExitClick（左側退出帶）", () => {
  test("與點 [←] 完全同一條路：_beginLeave，不出現裸 conn.send", () => {
    const { s, sent, enqueued } = makeSession();
    expect(s.onMouseExitClick()).toBe(true);
    expect(sent).toEqual([]);
    expect(enqueued.length).toBeGreaterThan(0);
    expect(s._renderMode).toBe("frozen");
  });

  test("原生鏡像下回 false（交給一般路徑）", () => {
    const { s } = makeSession();
    s._renderMode = "native";
    expect(s.onMouseExitClick()).toBe(false);
  });

  test("opening 時吞掉並給提示", () => {
    const { s, enqueued, hints } = makeSession();
    s.state = "opening";
    expect(s.onMouseExitClick()).toBe(true);
    expect(enqueued).toEqual([]);
    expect(hints.join()).toContain("請稍候");
  });
});
