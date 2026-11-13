// List easy-reading keyboard contract: whitelist = navigation / open / number
// jump / leave; the in-place keys ([ ] = \ + - < > , . { } t) run as frozen
// transactions that never switch to native; every other key is refused (#159):
// preventDefault, nothing enqueued or sent, state and render mode unchanged, an
// error-level hint. The serialized native sequence (_beginPassthroughBytes) is
// kept for PttChrome's own operations (search, mark read, refresh) and is
// exercised directly here.
import { ListSession, transitionListSession } from "../../src/js/list_session";

function makeSession() {
  const sent = [];
  const enqueued = [];
  const core = { conn: { isConnected: true, send: (d) => sent.push(d) } };
  const view = {
    hideCursor() {},
    showCursor() {},
    resetListAccumulation() {},
    blacklist: new Set(),
    titleBlacklist: [],
  };
  const termBuf = {
    rows: 24,
    cols: 80,
    listLines: [],
    listLineNums: [],
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
    flush() {
      this.flushed = (this.flushed || 0) + 1;
    },
    flushPending() {
      this.pendingFlushed = (this.pendingFlushed || 0) + 1;
    },
    flushPendingKind() {},
    hasKind: () => false,
    enqueue(cmd) {
      enqueued.push(cmd);
    },
    onSettle() {},
  };
  const s = new ListSession(core, view, termBuf, queue);
  return { s, sent, enqueued, queue };
}

function keyEvent(key, mods = {}) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

const KEY_HINT =
  "好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）";

// An active session over the buffer that records every hint with all arguments.
function activeRefusalSession() {
  const ctx = makeSession();
  const hints = [];
  ctx.s._view.flashListHint = (...a) => hints.push(a);
  ctx.s.state = "active";
  ctx.s._renderMode = "buffer";
  ctx.s._boardName = "C_Chat";
  ctx.s._selectedNum = 42;
  ctx.s._serverNum = 7; // lagging real cursor: a sync leg must NOT start either
  return { ...ctx, hints };
}

function expectRefused(ctx, e) {
  expect(e.defaultPrevented).toBe(true);
  expect(ctx.sent).toEqual([]);
  expect(ctx.enqueued).toEqual([]);
  expect(ctx.s.state).toBe("active");
  expect(ctx.s._renderMode).toBe("buffer");
  expect(ctx.s._boardName).toBe("C_Chat"); // the cache is not dropped
  expect(ctx.s._holdReason).toBe(null);
  expect(ctx.queue.flushed).toBeUndefined();
  expect(ctx.hints).toEqual([[KEY_HINT, 4000, "error"]]);
}

describe("ListSession refuses keys easy reading does not present (#159)", () => {
  const UNSUPPORTED = [
    ["z", {}],
    ["v", {}],
    ["Z", { shiftKey: true }],
    ["p", { ctrlKey: true }], // Ctrl-P: post
    ["q", { ctrlKey: true }], // Ctrl-Q: query author
    ["x", { ctrlKey: true }], // Ctrl-X: cross-post (not a clipboard key)
    ["]", { ctrlKey: true }], // Ctrl-]: a control byte
    ["t", { altKey: true, code: "KeyT" }], // Alt+T: this app's alias of Ctrl-T
    ["Insert", {}], // bare Insert (Shift+Insert is the paste shortcut)
  ];
  test.each(UNSUPPORTED)(
    "%s %j → prevented, nothing enqueued or sent, state and render mode unchanged, hint shown",
    (key, mods) => {
      const ctx = activeRefusalSession();
      const e = keyEvent(key, mods);
      ctx.s.onKeyDown(e);
      expectRefused(ctx, e);
    }
  );

  test("pinned selection (no number) is refused the same way", () => {
    const ctx = activeRefusalSession();
    ctx.s._selectedNum = null;
    ctx.s._selectedPinnedKey = "arrenwu|[公告] 板規";
    const e = keyEvent("a");
    ctx.s.onKeyDown(e);
    expectRefused(ctx, e);
  });

  test("a refused key leaves the selection and the next key untouched", () => {
    const ctx = activeRefusalSession();
    ctx.s.onKeyDown(keyEvent("z"));
    ctx.hints.length = 0;
    ctx.s.onKeyDown(keyEvent("z"));
    expect(ctx.hints).toEqual([[KEY_HINT, 4000, "error"]]);
    expect(ctx.s._selectedNum).toBe(42);
    expect(ctx.enqueued).toEqual([]);
  });

  test("←/q/e 離板 → v5 交易化：frozen＋先同步 server 游標再送離板鍵", () => {
    // pttbbs 離板記住的是 REAL cursor（getkeep）——本地導覽零網路，離板前不
    // sync 的話再進板落點會跳去 server 游標殘留的位置（2026-07-08 回報）。
    const { s, sent, enqueued } = makeSession();
    s.state = "active";
    s._selectedNum = 42; // 本地導覽後選取 ≠ server 游標（_serverNum null）
    const e = keyEvent("ArrowLeft");
    s.onKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(sent).toEqual([]); // 不裸送——經 CommandQueue
    expect(s.state).toBe("functionMode");
    expect(s._renderMode).toBe("frozen");
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].kind).toBe("leave-sync-jump");
    expect(enqueued[0].keys).toBe("42\r");
    // park 指紋（同 mark/relative sync 腿）
    expect(
      enqueued[0].expect(null, { cursorRowNum: 42, curY: 5, curX: 0, rows: 24 })
    ).toBe(true);
    // sync 完成 → 才送離板鍵
    enqueued[0].onDone();
    // _serverNum 在 leave 腿入列時清空（落點 menu/主列表重新教），不斷言
    expect(enqueued.length).toBe(2);
    expect(enqueued[1].kind).toBe("leave-board");
    expect(enqueued[1].keys).toBe("\x1b[D");
    // expect：menu（離板）或 clean-list（MODE_SELECT 退出/回列表）都算完成
    expect(enqueued[1].expect(null, { kind: "menu" })).toBe(true);
    expect(enqueued[1].expect(null, { kind: "clean-list" })).toBe(true);
    expect(enqueued[1].expect(null, { kind: "transient" })).toBe(false);
  });

  test("← 離板：server 游標已同步（_serverNum===選取）→ 跳過 sync 腿直送", () => {
    const { s, enqueued } = makeSession();
    s.state = "active";
    s._selectedNum = 42;
    s._serverNum = 42;
    s.onKeyDown(keyEvent("ArrowLeft"));
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].kind).toBe("leave-board");
    expect(enqueued[0].keys).toBe("\x1b[D");
  });

  test("← 離板：pinned/無選取（num null）→ 無跳號可同步，直送離板鍵", () => {
    const { s, enqueued } = makeSession();
    s.state = "active";
    s._selectedNum = null;
    s.onKeyDown(keyEvent("q"));
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].kind).toBe("leave-board");
  });

  test("← 離板：sync 腿失敗 → 照樣送離板鍵；離板鍵也失敗才停在原頁", () => {
    // sync 只是為了下次進板的落點（選取的編號可能已不存在，跳號落在別處）；
    // 離板本身不需要它，丟掉離板鍵＝使用者的 Back 消失。
    const { s, enqueued } = makeSession();
    s.state = "active";
    s._selectedNum = 42;
    s.onKeyDown(keyEvent("ArrowLeft"));
    enqueued[0].onFail("timeout");
    expect(enqueued.length).toBe(2);
    expect(enqueued[1].kind).toBe("leave-board");
    expect(enqueued[1].keys).toBe("\x1b[D");
    enqueued[1].onFail("timeout");
    expect(s.failed()).toBe(true); // 停在原頁、有提示，等下拉重新整理（#158）
  });

  test("nav 鍵不佇列不送（本地導航維持零網路）", () => {
    const { s, sent, enqueued } = makeSession();
    s.state = "active";
    s._selectedNum = 42;
    const e = keyEvent("ArrowDown");
    s.onKeyDown(e);
    expect(sent).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(e.defaultPrevented).toBe(true);
    expect(s.state).toBe("active");
  });
});

describe("passthrough sync 腿期間 frozen（不得閃現原生畫面）", () => {
  test("按 [（未同步）sync 腿在途 → frozen、游標保持隱藏", () => {
    const { s } = makeSession();
    const calls = { hide: 0, show: 0 };
    s._view.flashListHint = () => {};
    s._view.hideCursor = () => calls.hide++;
    s._view.showCursor = () => calls.show++;
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = 42;
    s.onKeyDown(keyEvent("["));
    expect(s._renderMode).toBe("frozen"); // sync 完成前不閃原生
    expect(calls.show).toBe(0); // showCursor = 原生游標露出
  });

  test("frozen sync 腿期間按任意鍵 → 吞掉（preventDefault、不佇列不送）＋有讀取提示", () => {
    const { s, sent, enqueued } = makeSession();
    const hints = [];
    s._view.flashListHint = (m) => hints.push(m);
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = 42;
    s.onKeyDown(keyEvent("["));
    s.state = "functionMode"; // sync 腿在途（reducer 尚未 resume）
    const n = enqueued.length;
    const before = hints.length;
    const e = keyEvent("x");
    s.onKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(enqueued.length).toBe(n);
    expect(sent).toEqual([]);
    // 交易在途吞鍵不得無聲（3 秒 timeout 窗內「按了沒反應」回歸）
    expect(hints.length).toBeGreaterThan(before);
  });

  test("opening（開文序列在途）吞鍵 → 有讀取提示（不得無聲）", () => {
    const { s } = makeSession();
    const hints = [];
    s._view.flashListHint = (m) => hints.push(m);
    s.state = "opening";
    const e = keyEvent("x");
    s.onKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(hints.length).toBe(1);
  });

  test("← 離板同樣 frozen（v5 交易化：離板回應在途也不得閃現原生）", () => {
    const { s } = makeSession();
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = 42;
    s.onKeyDown(keyEvent("ArrowLeft"));
    expect(s.state).toBe("functionMode");
    expect(s._renderMode).toBe("frozen");
  });
});

describe("v5 closed interaction: keyClass whitelist enumeration", () => {
  // 枚舉即合約（docs/easy-reading-list.md §Operation classes）：白名單＝導覽/開文/跳號/離板；
  // 其餘一律 unsupported（拒絕並提示，#159）。
  const WHITELIST_BEHAVIOR = [
    // [key, 預期 state, 預期佇列 kind（null=不佇列）]
    ["ArrowUp", "active", null],
    ["ArrowDown", "active", null],
    ["k", "active", null],
    ["j", "active", null],
    ["PageUp", "active", null],
    ["PageDown", "active", null],
    // 離板先同步 server 游標（pttbbs getkeep 記 REAL cursor，再進板落點才對）
    ["ArrowLeft", "functionMode", "leave-sync-jump"],
    ["q", "functionMode", "leave-sync-jump"],
    ["e", "functionMode", "leave-sync-jump"],
    // A 類鍵（原地重繪）→ 凍結交易：同樣先同步真游標，但腿名不同，而且**不切原生**
    ["[", "functionMode", "inplace-sync-jump"],
    ["]", "functionMode", "inplace-sync-jump"],
    ["=", "functionMode", "inplace-sync-jump"],
    ["t", "functionMode", "inplace-sync-jump"],
    // Help: PTT's help screen is asked for through the serialized sequence and
    // the help menu sheet presents it.
    ["h", "functionMode", "native-sync-jump"],
  ];
  test.each(WHITELIST_BEHAVIOR)("白名單 %s → state=%s", (key, state, kind) => {
    const { s, enqueued } = makeSession();
    s._view.flashListHint = () => {};
    s.state = "active";
    s._selectedNum = 42;
    const e = keyEvent(key);
    s.onKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(s.state).toBe(state);
    if (kind) expect(enqueued[0].kind).toBe(kind);
    else expect(enqueued).toEqual([]); // 空 buffer：nav 本地 no-op、零佇列
  });

  test("adoptUserBytes: refused on the wire exit too (bypassing key dispatch changes nothing)", () => {
    // The net at the single wire exit of real keyboard/IME bytes (term_view._send):
    // bytes that reach it over the buffer came from no entrance easy reading
    // presents. Machine bytes go through App.sendMachineBytes and never get here.
    const ctx = activeRefusalSession();
    expect(ctx.s.adoptUserBytes("\x18")).toBe(true);
    expect(ctx.sent).toEqual([]);
    expect(ctx.enqueued).toEqual([]);
    expect(ctx.s.state).toBe("active");
    expect(ctx.s._renderMode).toBe("buffer");
    expect(ctx.hints).toEqual([[KEY_HINT, 4000, "error"]]);
  });

  test("adoptUserBytes: with opts.conv the text goes to noteTextInput (refused with the text hint)", () => {
    const ctx = activeRefusalSession();
    expect(ctx.s.adoptUserBytes("測試", { conv: true })).toBe(true);
    expect(ctx.enqueued).toEqual([]);
    expect(ctx.sent).toEqual([]);
    expect(ctx.hints).toEqual([["好讀模式目前不支援在列表輸入文字", 4000, "error"]]);
  });

  test("adoptUserBytes：原生鏡像下不接手（選取即真游標，沒東西要保護）", () => {
    const { s, enqueued } = makeSession();
    s.state = "active";
    s._renderMode = "native";
    s._selectedNum = 42;
    expect(s.adoptUserBytes("\x18")).toBe(false);
    expect(enqueued).toEqual([]);
  });

  test("adoptUserBytes：交易在途時吞掉並給提示（不變量 N7，永不靜默）", () => {
    const hints = [];
    const { s, enqueued } = makeSession();
    s._view.flashListHint = (m) => hints.push(m);
    s.state = "opening";
    s._renderMode = "buffer";
    expect(s.adoptUserBytes("\x18")).toBe(true);
    expect(enqueued).toEqual([]);
    expect(hints.some((m) => m.includes("開啟文章中"))).toBe(true);
  });

  test("Shift+Insert（貼上快捷鍵）同樣放行——preventDefault 會取消瀏覽器貼上", () => {
    // 回歸：Shift+Insert 不是 ctrl 組合 → 舊碼落 passthrough → preventDefault
    // ⇒ #t 收不到 paste 事件、App.onDOMPaste 永不觸發，PTT 只收到 keyEventToBytes
    // 產出的 \x1b[2~。畫面切原生但沒貼上東西，使用者得再貼第二次（那次才成功，
    // 因為此時 listRenderMode 已是 native、本 hook 根本不被呼叫）。
    const { s, sent, enqueued } = makeSession();
    s._view.flashListHint = () => {};
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = 42;
    const e = keyEvent("Insert");
    e.shiftKey = true;
    s.onKeyDown(e);
    expect(e.defaultPrevented).toBe(false);
    expect(s.state).toBe("active");
    expect(s._renderMode).toBe("buffer"); // 不因按鍵本身切原生
    expect(enqueued).toEqual([]); // 不得送 \x1b[2~
    expect(sent).toEqual([]);
  });

  test("select 清單離開（←）：leave onDone 清 _selectMode＋_boardName（回主列表必 rebuild）", () => {
    const { s, enqueued } = makeSession();
    s.state = "active";
    s._selectMode = true;
    s._boardName = "C_Chat";
    s.onKeyDown(keyEvent("ArrowLeft"));
    expect(enqueued[0].kind).toBe("leave-board");
    enqueued[0].onDone();
    expect(s._selectMode).toBe(false);
    expect(s._boardName).toBeNull();
  });

  test("T2 數字跳號：digit→輸入框（預填）→確認＝jump-number 交易→落地 rebuild；取消零 server", () => {
    const { s, enqueued } = makeSession();
    let inputArgs = null;
    let inputCb = null;
    s._view.promptListInput = (label, init, cb) => {
      inputArgs = { label, init };
      inputCb = cb;
    };
    s.state = "active";
    s._renderMode = "buffer";
    s.onKeyDown(keyEvent("5"));
    expect(s.state).toBe("active"); // 收參純本地
    expect(enqueued).toEqual([]);
    expect(inputArgs.init).toBe("5");
    inputCb("523");
    expect(s.state).toBe("functionMode");
    expect(s._renderMode).toBe("frozen");
    expect(enqueued[0].kind).toBe("jump-number");
    expect(enqueued[0].keys).toBe("523\r");
    // 落地（park 指紋）→ onDone rebuild 回 active/buffer
    expect(
      enqueued[0].expect(null, {
        rows: 24,
        curY: 5,
        curX: 0,
        cursorRowNum: 523,
        nums: new Array(24).fill(null),
        rowTexts: new Array(24).fill(""),
      })
    ).toBe(true);
    enqueued[0].onDone();
    expect(s.state).toBe("active");
    expect(s._renderMode).toBe("buffer");
    // 取消路徑
    const { s: s2, enqueued: q2 } = makeSession();
    let cb2 = null;
    s2._view.promptListInput = (l, i, cb) => (cb2 = cb);
    s2.state = "active";
    s2.onKeyDown(keyEvent("7"));
    cb2(null);
    expect(q2).toEqual([]);
    expect(s2.state).toBe("active");
  });

  test("交易前導只清 pending、保留 in-flight（sync 腿/←/Enter 開文——防 ownerless settle 誤配對）", () => {
    // live race：前導 flush() 砍掉 in-flight prefetch anchor → 其在線回應變
    // 無主 settle，提早滿足新交易的 expect（leave-board 吃掉 anchor 落地）。
    // 前導必須 flushPending（序列化修復），全量 flush 只准出現在退回原生鏡像
    // 的路徑（_enterFunctionMode/_handoffArticle/_cleanup——那裡沒有後續 expect）。
    // passthrough 的 sync 腿（[ v …）在途時同規則；sync 完成後的 enter-function-mode
    // 全量 flush 屬合法（之後無 expect），此處只驗「入列當下」。
    const begins = [
      ["[（A 類凍結交易）", (s) => s.onKeyDown(keyEvent("["))],
      ["v（序列化原生序列）", (s) => s._beginPassthroughBytes("v")],
      ["ArrowLeft", (s) => s.onKeyDown(keyEvent("ArrowLeft"))],
      ["Enter開文", (s) => s.onKeyDown(keyEvent("Enter"))],
    ];
    for (const [label, fire] of begins) {
      const { s, queue } = makeSession();
      s._view.flashListHint = () => {};
      s._view.promptListInput = () => {};
      s.state = "active";
      s._renderMode = "buffer";
      s._selectedNum = 42;
      fire(s);
      expect({ label, flushed: queue.flushed || 0 }).toEqual({ label, flushed: 0 });
      expect({ label, pendingFlushed: queue.pendingFlushed || 0 }).toEqual({
        label,
        pendingFlushed: 1,
      });
    }
  });

  test("點擊選取已移除（2026-07-08）：session 無點擊入口（buffer 點擊＝no-op）", () => {
    // 點擊只移選取、不開文，使用者認定無用；接線層（pttchrome.js mouse_click）
    // 在 buffer/frozen 一律吞掉點擊（防 useMouseBrowsing 對虛擬視窗座標發鍵）。
    const { s } = makeSession();
    expect(s.onClick).toBeUndefined();
  });
});

describe("passthrough 黏性原生（2026-07-10 UX：不自動彈回好讀）", () => {
  // 反覆按 [ ] 時「切原生→彈回好讀→再切原生」畫面閃動、圓點游標跳動，
  // 且高流量板的殘餘 settle 易誤觸 catch-all banner。合約：passthrough
  // 切原生後 HOLD——**clean-list settle 本身**一律 stay 鏡像。
  // 2026-09-03 起 hold 分兩種：'external'（AID 跳文／長推文停泊）永不自動解除；
  // 'passthrough' 由靜置探針（resume-probe，另見 list_native_resume.test.js）
  // 解除。這裡守護的是「settle 本身不得解除 hold」那一半 —— 少了它就會在
  // 「一個回應 settle 兩次」的半幀上採用到錯的游標落點。
  // 另：[ ] = 已改走 A 類凍結交易（根本不切原生），所以這裡改用 B 類鍵 z。
  function cleanList(boardName, num) {
    const rowTexts = new Array(24).fill("");
    const nums = new Array(24).fill(null);
    nums[5] = num;
    return {
      kind: "clean-list",
      boardName,
      rowTexts,
      nums,
      rows: 24,
      curY: 5,
      curX: 0,
      cursorRowNum: num,
    };
  }

  test("序列化代送後的 clean-list settle → 停在原生鏡像（不彈回 buffer）", () => {
    const { s, enqueued } = makeSession();
    s._view.flashListHint = () => {};
    s.state = "active";
    s._renderMode = "buffer";
    s._boardName = "C_Chat";
    s._selectedNum = 42;
    s._termBuf.listLineNums = [41, 42, 43];
    s._beginPassthroughBytes("z");
    enqueued[0].onDone(); // sync 完成 → 切原生＋native-key 入列
    enqueued[1].onDone && enqueued[1].onDone(); // key 回應完成
    // 原生操作完成後的列表重繪 settle → 必須 STAY（黏性；回好讀由靜置探針決定）
    const facts = cleanList("C_Chat", 87);
    s._dispatch(s._settleEvent(facts), facts);
    expect(s.state).toBe("functionMode");
    expect(s._renderMode).toBe("native");
    // 連按多次也不再切換模式（穩定停原生）
    const facts2 = cleanList("C_Chat", 90);
    s._dispatch(s._settleEvent(facts2), facts2);
    expect(s.state).toBe("functionMode");
  });

  test("開文 → 返回列表才解除 hold（resume＋rebuild：excursion 後 cache 不可信）", () => {
    const { s, enqueued } = makeSession();
    let resets = 0;
    s._view.flashListHint = () => {};
    s._view.resetListAccumulation = () => resets++;
    s.state = "active";
    s._renderMode = "buffer";
    s._boardName = "C_Chat";
    s._selectedNum = 42;
    s._termBuf.listLineNums = [41, 42, 43];
    s.onKeyDown(keyEvent("]"));
    enqueued[0].onDone();
    // 原生開文 → article settle → suspended（文章好讀接手、hold 解除）
    const articleFacts = { kind: "article", boardName: null, rowTexts: [], nums: [], rows: 24, curY: 23, curX: 0, cursorRowNum: null };
    s._dispatch(s._settleEvent(articleFacts), articleFacts);
    expect(s.state).toBe("suspended");
    // ← 返回列表 → resume；_boardName 已被 excursion 清空 → 必 rebuild
    const facts = cleanList("C_Chat", 87);
    s._dispatch(s._settleEvent(facts), facts);
    expect(s.state).toBe("active");
    expect(s._renderMode).toBe("buffer");
    expect(resets).toBeGreaterThanOrEqual(1);
  });

  test("離板 → menu settle → idle；重進板 clean-list → 重新 engage 不受 hold 影響", () => {
    const { s, enqueued } = makeSession();
    s._view.flashListHint = () => {};
    s.state = "active";
    s._selectedNum = 42;
    s._beginPassthroughBytes("z");
    enqueued[0].onDone(); // 切原生（hold）
    const menuFacts = { kind: "menu", boardName: null, rowTexts: [], nums: [], rows: 24, curY: 5, curX: 0, cursorRowNum: null };
    s._dispatch(s._settleEvent(menuFacts), menuFacts);
    expect(s.state).toBe("idle");
    expect(s._holdReason).toBe(null); // cleanup 解除
  });
});

describe("native excursion 一律拋棄 cache（多輪搜尋/過濾汙染回歸，2026-07-10）", () => {
  // 症狀：movie 板 `/` 搜尋後再 Z（airlock→原生）過濾推文數，回列表時板名相同
  // ＋落點序號恰在舊 buffer 內 → 走 resume-buffer 不 rebuild → 舊搜尋條目混雜
  // 顯示（>15 篇、日期錯亂），點舊序號開文 jump expect 永遠不中 → timeout。
  // 合約：進 functionMode（原生 excursion——airlock/自癒/降級）＝清單不再可信，
  // 回 clean-list settle 必 rebuild（丟 view 層 _listNumMap 重建）。
  // 構造「同板名＋落點序號在舊 buffer 內」的 clean-list settle facts —— 修前
  // 這正是漏 rebuild 的組合。
  function cleanListFacts(boardName, num) {
    const rowTexts = new Array(24).fill("");
    const nums = new Array(24).fill(null);
    nums[5] = num;
    return {
      kind: "clean-list",
      boardName,
      rowTexts,
      nums,
      rows: 24,
      curY: 5,
      curX: 0,
      cursorRowNum: num,
    };
  }

  test("序列化送 Z 切原生（過濾情境）→ 開文返回後必 rebuild（丟舊 buffer）", () => {
    const { s, enqueued } = makeSession();
    let resets = 0;
    s._view.flashListHint = () => {};
    s._view.resetListAccumulation = () => resets++;
    s.state = "active";
    s._renderMode = "buffer";
    s._boardName = "movie";
    s._selectedNum = 42;
    s._termBuf.listLineNums = [41, 42, 43]; // 舊搜尋殘留 buffer
    s._beginPassthroughBytes("Z"); // sync → 原生過濾
    enqueued[0].onDone();
    expect(s.state).toBe("functionMode");
    // 黏性 hold：原生過濾完成的 clean-list settle 停在鏡像（不彈回）
    const facts = cleanListFacts("movie", 42);
    s._dispatch(s._settleEvent(facts), facts);
    expect(s.state).toBe("functionMode");
    // 開文 → 返回：hold 解除、_boardName 已清 → 必 rebuild，不得 merge 舊 buffer
    const articleFacts = { kind: "article", boardName: null, rowTexts: [], nums: [], rows: 24, curY: 23, curX: 0, cursorRowNum: null };
    s._dispatch(s._settleEvent(articleFacts), articleFacts);
    expect(s.state).toBe("suspended");
    s._dispatch(s._settleEvent(facts), facts);
    expect(s.state).toBe("active");
    expect(resets).toBeGreaterThanOrEqual(1); // 必 rebuild，不得只 resume
  });

  test("開文 timeout 自癒（open-timeout→functionMode）→ hold 停原生；開文返回後必 rebuild", () => {
    const { s } = makeSession();
    let resets = 0;
    s._view.resetListAccumulation = () => resets++;
    s._view.flashListHint = () => {};
    s.state = "opening";
    s._boardName = "movie";
    s._selectedNum = 42;
    s._termBuf.listLineNums = [41, 42, 43];
    s._dispatch({ type: "open-timeout" }, null);
    expect(s.state).toBe("functionMode");
    const facts = cleanListFacts("movie", 42);
    s._dispatch(s._settleEvent(facts), facts);
    expect(s.state).toBe("functionMode"); // 黏性
    const articleFacts = { kind: "article", boardName: null, rowTexts: [], nums: [], rows: 24, curY: 23, curX: 0, cursorRowNum: null };
    s._dispatch(s._settleEvent(articleFacts), articleFacts);
    s._dispatch(s._settleEvent(facts), facts);
    expect(s.state).toBe("active");
    expect(resets).toBeGreaterThanOrEqual(1);
  });

  test("反向守護：← 離板交易（frozen、保留 _boardName）回 clean-list 只 resume 不 rebuild", () => {
    // MODE_SELECT 退出/thread hop 落回列表：frozen 交易非原生 excursion，
    // 快路徑（resume-buffer only）不得退化成全 rebuild。
    const { s, enqueued } = makeSession();
    let resets = 0;
    s._view.resetListAccumulation = () => resets++;
    s.state = "active";
    s._renderMode = "buffer";
    s._boardName = "movie";
    s._selectedNum = 42;
    s._serverNum = 42; // 已同步 → 直送離板鍵
    s._termBuf.listLineNums = [41, 42, 43];
    s.onKeyDown(keyEvent("ArrowLeft"));
    expect(s.state).toBe("functionMode");
    enqueued[0].onDone(); // leave-board 完成（落回 clean-list）
    const facts = cleanListFacts("movie", 43);
    s._dispatch(s._settleEvent(facts), facts);
    expect(s.state).toBe("active");
    expect(resets).toBe(0);
  });
});

describe("functionMode clean-list settle 的 in-flight 吸收（相對命令配對期間不彈回）", () => {
  const settle = (kind, extra = {}) => ({
    type: "settle",
    kind,
    boardNameMatch: true,
    inFlightKind: null,
    landedNumInBuffer: true,
    engageEligible: false,
    hasNumberedRow: true,
    ...extra,
  });
  test("in-flight（native-sync-jump）→ stay 鏡像", () => {
    expect(
      transitionListSession(
        "functionMode",
        settle("clean-list", { inFlightKind: "native-sync-jump" })
      )
    ).toEqual({ next: "functionMode", actions: [] });
  });
  test("配對完成（無 in-flight、無 hold——leave/jump 交易）→ resume 採用落點游標", () => {
    expect(transitionListSession("functionMode", settle("clean-list"))).toEqual({
      next: "active",
      actions: ["resume-buffer"],
    });
  });
  // 超長文好讀背景載入時點 AID，最後一個
  // PageUp 的回應晚於 aid-escape 的 ← 才到 ⇒ 舊版走 handoff-article → queue.flush()
  // ⇒ 跳文第一步就被殺掉（「AID 跳文失敗：畫面已變更」）。
  test("外部序列命令在線上時的文章幀＝遲到回應 → stay，不 handoff（不 flush 別人的序列）", () => {
    expect(
      transitionListSession(
        "functionMode",
        settle("article", { inFlightKind: "aid-escape", holdReason: "external" })
      )
    ).toEqual({ next: "functionMode", actions: [] });
  });
  test("外部序列收尾（落地文章 settle，inFlightKind 已是 null）→ 照常 handoff", () => {
    expect(
      transitionListSession("functionMode", settle("article", { holdReason: "external" }))
    ).toEqual({ next: "suspended", actions: ["handoff-article"] });
  });
  test("passthrough 停泊下原生開文照舊 handoff（守門只限 external）", () => {
    expect(
      transitionListSession(
        "functionMode",
        settle("article", { inFlightKind: "native-sync-jump", holdReason: "passthrough" })
      )
    ).toEqual({ next: "suspended", actions: ["handoff-article"] });
  });
  test.each(["passthrough", "external"])(
    "holdReason=%s → clean-list settle 一律 stay 鏡像（settle 本身不解除 hold）",
    (holdReason) => {
      expect(
        transitionListSession("functionMode", settle("clean-list", { holdReason }))
      ).toEqual({ next: "functionMode", actions: [] });
    }
  );
});

describe("無字元實體鍵不得觸發原生 excursion（Caps Lock/F2「畫面跑掉」回歸，2026-08）", () => {
  // 舊行為：CapsLock/F 鍵等落 _classifyKey 的 default → passthrough →
  // _beginNativePassthrough 的 bytes==null 分支 → 跳過 cursor sync 腿直接
  // _enterFunctionMode()：畫面瞬間換成 server 真實 24 行（通常停在背景 prefetch
  // 的遠處頁面）＝「畫面跑掉」，還黏性 hold＋丟 cache（不變量 15）。而該分支假設的
  // 「事件放行給原生鍵盤路徑自己送」對這些鍵不成立（TermKeyboard._onKeyDown 對
  // KeyMap miss 且 key.length!==1 一律回 false）⇒ server 完全沒動，純損失。
  // 新合約：keyEventToBytes(e)==null ＝ 這個鍵送不出任何 byte ＝ keyClass 'ignore'，
  // 吞掉不轉態。
  const DEAD_KEYS = ["CapsLock", "F2", "F8", "F12", "NumLock", "ScrollLock"];
  test.each(DEAD_KEYS)("%s → 完全不動好讀狀態（不切原生、不丟 cache）", (key) => {
    const { s, sent, enqueued, queue } = makeSession();
    const hints = [];
    s._view.flashListHint = (m) => hints.push(m);
    s.state = "active";
    s._renderMode = "buffer";
    s._boardName = "C_Chat";
    s._selectedNum = 42;
    s._serverNum = 7; // 未同步：舊碼會在這裡跳過 sync 腿直切原生
    const e = keyEvent(key);
    s.onKeyDown(e);
    expect(s.state).toBe("active");
    expect(s._renderMode).toBe("buffer"); // 畫面不得換成 server 鏡像
    expect(s._holdReason).toBe(null);
    expect(s._boardName).toBe("C_Chat"); // 不變量 15 的拋 cache 不該被誤觸
    expect(s._selectedNum).toBe(42);
    expect(sent).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(queue.flushed).toBeUndefined();
    expect(hints).toEqual([]); // 不該冒出「已切至原生」
    // 刻意不 preventDefault：F12 開發者工具/CapsLock 的 OS 行為留給瀏覽器，
    // 反正原生鍵盤路徑對它們也送不出 byte。
    expect(e.defaultPrevented).toBe(false);
  });

  test("Ctrl+Shift 組合（送不出 byte）同樣 ignore，不做原生 excursion", () => {
    const { s, sent, enqueued } = makeSession();
    s._view.flashListHint = () => {};
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = 42;
    const e = keyEvent("X", { ctrlKey: true, shiftKey: true });
    s.onKeyDown(e);
    expect(s.state).toBe("active");
    expect(s._renderMode).toBe("buffer");
    expect(sent).toEqual([]);
    expect(enqueued).toEqual([]);
  });

});

describe("read.c 導覽同義鍵＝本地導覽零 server（空白鍵「畫面跑掉」回歸，2026-08）", () => {
  // pttbbs mbbsd/read.c:858-902 的列表導覽鍵表：
  //   ' ' / KEY_PGDN / 'N' / Ctrl-F   → 下一頁
  //   KEY_PGUP / 'P' / Ctrl-B         → 上一頁
  //   'p' / 'k' / KEY_UP              → 上移一列
  //   'n' / 'j' / KEY_DOWN            → 下移一列
  //   KEY_END / '$'                   → 底端
  // 舊碼白名單只收方向鍵/j/k/PageUp/PageDown/Home/End，其餘同義鍵有 bytes ⇒ 走
  // 完整 passthrough（sync 腿→切原生→代送）：使用者只想翻頁卻被丟去原生鏡像。
  // Ctrl-F/Ctrl-B 刻意不納入（維持 Ctrl 組合與瀏覽器快捷鍵的既有分界）。
  const SYNONYMS = [
    [" ", "pgdn", "PageDown"],
    ["N", "pgdn", "PageDown"],
    ["P", "pgup", "PageUp"],
    ["n", "down", "ArrowDown"],
    ["p", "up", "ArrowUp"],
    ["$", "end", "End"],
  ];
  test.each(SYNONYMS)("%s ＝ 本地導覽 %s（等同 %s）", (key, op, canonical) => {
    const { s, sent, enqueued } = makeSession();
    s._view.flashListHint = () => {};
    s.state = "active";
    s._renderMode = "buffer";
    s._boardName = "C_Chat";
    s._selectedNum = 42;
    s._serverNum = 7; // 未同步：passthrough 會在這裡起 sync 腿
    const ops = [];
    s._moveSelection = (o) => ops.push(o);
    const e = keyEvent(key);
    s.onKeyDown(e);
    expect(ops).toEqual([op]);
    // 與正典鍵逐項等價
    const ref = makeSession();
    ref.s._view.flashListHint = () => {};
    ref.s.state = "active";
    ref.s._renderMode = "buffer";
    ref.s._selectedNum = 42;
    ref.s._serverNum = 7;
    const refOps = [];
    ref.s._moveSelection = (o) => refOps.push(o);
    ref.s.onKeyDown(keyEvent(canonical));
    expect(ops).toEqual(refOps);
    // 零 server、不切原生、不丟 cache
    expect(sent).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(s.state).toBe("active");
    expect(s._renderMode).toBe("buffer");
    expect(s._boardName).toBe("C_Chat");
    expect(e.defaultPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cursor-relative 的 Ctrl / Alt 組合鍵必須先同步真游標
// （2026-09-13 回報「查詢作者會跑去其它文章」）
// ---------------------------------------------------------------------------
//
// 症狀：好讀列表按 `a` 搜作者 → 選一篇 → Ctrl-Q 查到**別人**；按 ← 退出後選取也跟著
// 跑到那個人的文章上。
//
// 根因：舊碼 `_beginNativePassthrough` 開頭寫死 `e.ctrlKey ? null : keyEventToBytes(e)`
// ⇒ 所有 Ctrl 組合強制落 `bytes == null` 分支（切原生、放行給原生鍵盤路徑），而那條
// 分支**不經過 `_beginPassthroughBytes`，也就跳過了裡面的 native-sync-jump 腿**。
// 好讀列表的 T1 導覽零網路，真游標通常停在背景 prefetch 的落點 ⇒ server 對錯的那列
// 動作。錄製檔 #t=5926 是裸送的 "^Q"（前面沒有任何 queue.enqueue），#t=5940 回應畫面
// 就是另一位作者的 my_query。
//
// PTT 端佐證（pttbbs mbbsd/read.c:904）——**對真游標那一列**動作：
//     case Ctrl('Q'):
//         mode = my_query(headers[locmem->crs_ln - locmem->top_ln].owner);
// 同類還有 read.c:911 Ctrl('S')、:957 Ctrl('T') TagThread、:970 Ctrl('D')。
//
// keyEventToBytes 的 ctrlKey 分支本來就算得出 bytes（CtrlShiftMap，Ctrl-Q → \x11），
// 所以舊註解「not resendable / can't serialize a key we don't own」的前提早已不成立。
describe("Ctrl／Alt combos: only the non-remap Alt combos still pass to the browser", () => {
  test("反向守護：非字母的 Alt 組合仍整個放行給瀏覽器", () => {
    // Alt remap 只涵蓋 26 個字母。數字、方向鍵這類 Alt 組合仍是瀏覽器／OS 的
    //（Alt+← 是上一頁），維持早退：不轉態、不 preventDefault、零命令。
    // 註：Alt-F 以前在這裡，但 26 字母 remap 之後它是 ^F，已移到正向案例。
    for (const [key, code] of [
      ["5", "Digit5"],
      ["ArrowLeft", "ArrowLeft"],
    ]) {
      const { s, sent, enqueued } = makeSession();
      s._view.flashListHint = () => {};
      s.state = "active";
      s._renderMode = "buffer";
      s._selectedNum = 42;
      const e = keyEvent(key, { altKey: true, code });
      s.onKeyDown(e);

      expect(e.defaultPrevented).toBe(false);
      expect(s.state).toBe("active");
      expect(s._renderMode).toBe("buffer");
      expect(sent).toEqual([]);
      expect(enqueued).toEqual([]);
    }
  });

  test("反向守護：Alt-Shift-T／Ctrl-Alt-T 不是 remap 鍵，照樣放行", () => {
    // 條件必須與 TermKeyboard._onKeyDown 的 alt 分支對齊（!ctrl && alt && !shift），
    // 否則兩條路徑會漂移：這裡接手了，原生那邊卻不送 ⇒ 按鍵變啞巴。
    for (const mods of [
      { altKey: true, shiftKey: true },
      { altKey: true, ctrlKey: true },
    ]) {
      const { s, sent, enqueued } = makeSession();
      s._view.flashListHint = () => {};
      s.state = "active";
      s._renderMode = "buffer";
      s._selectedNum = 42;
      const e = keyEvent("t", mods);
      s.onKeyDown(e);
      expect(e.defaultPrevented).toBe(false);
      expect(s.state).toBe("active");
      expect(sent).toEqual([]);
      expect(enqueued).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Alt = PTT's Ctrl, all 26 letters. Over the list each one is a PTT command key
// easy reading does not present: refused (#159), never sent.
// ---------------------------------------------------------------------------
describe("Alt remap, all 26 letters (list easy reading)", () => {
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  test("every letter is refused: prevented, nothing enqueued or sent, mirror not entered", () => {
    LETTERS.forEach((L) => {
      const ctx = activeRefusalSession();
      const e = keyEvent(L.toLowerCase(), { altKey: true, code: "Key" + L });
      ctx.s.onKeyDown(e);
      expectRefused(ctx, e);
    });
  });

  test("Alt+j/k/n/p are refused and do not move the selection locally (altRemap precedes _classifyKey)", () => {
    // These four are also navigation synonyms in the whitelist. If the order
    // flipped, Alt+J would move the cursor down one row silently.
    for (const [key, code] of [
      ["j", "KeyJ"],
      ["k", "KeyK"],
      ["n", "KeyN"],
      ["p", "KeyP"],
    ]) {
      const ctx = activeRefusalSession();
      const before = ctx.s._selectedNum;
      const e = keyEvent(key, { altKey: true, code });
      ctx.s.onKeyDown(e);
      expect(ctx.s._selectedNum).toBe(before);
      expectRefused(ctx, e);
    }
  });

  test("Alt+C/A/V/X are not eaten by the clipboard early return", () => {
    // The clipboard test reads `e.ctrlKey && !e.altKey`: the Alt versions must
    // reach the refusal, not silently become copy / select all / paste / cut.
    for (const L of ["C", "A", "V", "X"]) {
      const ctx = activeRefusalSession();
      const e = keyEvent(L.toLowerCase(), { altKey: true, code: "Key" + L });
      ctx.s.onKeyDown(e);
      expectRefused(ctx, e);
    }
  });

  test("macOS shapes (distorted e.key / dead key) are refused at the session layer too", () => {
    // session calls altRemapCharCode itself; without e.code it would go mute.
    for (const [key, code] of [
      ["√", "KeyV"],
      ["Dead", "KeyE"], // Option+E is the dead key of the combining accent
      ["ß", "KeyS"], // 'ß'.toUpperCase() === 'SS'; only code identifies it
      ["µ", "KeyM"], // 'µ'.toUpperCase() is Greek Μ, not ASCII M
    ]) {
      const ctx = activeRefusalSession();
      const e = keyEvent(key, { altKey: true, code });
      ctx.s.onKeyDown(e);
      expectRefused(ctx, e);
    }
  });
});
