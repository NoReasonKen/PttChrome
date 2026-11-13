// 「點了畫面上的功能鍵按鈕」要對好讀狀態機做什麼 —— 純決策，零 DOM、零狀態
// （unit 守護：tests/unit/function_key_click_plan.test.js）。
//
// 比照既有的 switch_mode_plan.js：真正難的是「送 byte 之前要先做什麼」，把它抽成
// 純函式才鎖得住。
//
// 三種輸出：
//   enterFunctionMode — 先叫好讀進「原生鏡像」再送鍵。**這是功能一在文章好讀模式
//                       下能不能用的關鍵**：PTT 會開 prompt（(y)回應 / (X)推文 /
//                       (h)說明），但好讀的累積長頁原封不動 ⇒ 使用者看不到輸入框。
//                       docs/easy-reading.md 的「貼上驅動」與「IME 驅動」補過同一個
//                       洞兩次，這是第三個入口。
//   stopEasyReading   — `←` 走與鍵盤 ArrowLeft **完全同一條路**
//                       （easy_reading._onKeyDownProcessUI 的 case 'ArrowLeft'），
//                       先把狀態機收掉再送 byte，離開文章時才不會閃一下原生 24 列。
//   send              — 一律 true（使用者按下去的按鈕不可以被靜默吞掉）。呼叫端仍會
//                       自己判 modal / 導航中 / 指令處理中並**給提示**，那些不在這裡。

// 左方向鍵。與 term_keyboard 的 KeyMap['ArrowLeft'] 同一個序列；
// list_session._enqueueLeaveKey 用的也是它。
export const LEFT_ARROW = '\x1b[D';
// 與 easy_reading.ARTICLE_NATIVE_KEYS 同一組（這個檔零相依，所以各寫一份；
// tests/unit/function_key_click_plan.test.js 守護兩份一致）。
export const NATIVE_KEYS = 'hH?yYrR';

// mode：'article-easy'（文章好讀，累積長頁在畫面上）／其餘一律當原生處理。
export function functionKeyClickPlan(input) {
  const o = input || {};
  const bytes = o.bytes;
  const articleEasy = o.mode === 'article-easy';
  if (!bytes) return { enterFunctionMode: false, stopEasyReading: false, send: false };
  // 文章好讀沒有呈現的功能（#160）：不送，呼叫端顯示「目前不支援」。說明
  // （h／H／?，說明選單彈窗接手）與回應（y／Y／r／R，等好讀有回應入口）保留原生路線。已經鏡像原生 prompt
  // （nativeMirror）時照送：那是使用者正在操作的 PTT 畫面。
  if (articleEasy && !o.nativeMirror && bytes !== LEFT_ARROW && !(bytes.length === 1 && NATIVE_KEYS.indexOf(bytes) >= 0)) {
    return { enterFunctionMode: false, stopEasyReading: false, send: false, refuse: true };
  }
  if (!articleEasy) {
    return { enterFunctionMode: false, stopEasyReading: false, send: true };
  }
  // 離開文章：收狀態機，**不要**進 functionMode（那會先把畫面換成原生 24 列，
  // 白閃一下才離開）。
  if (bytes === LEFT_ARROW) {
    return { enterFunctionMode: false, stopEasyReading: true, send: true };
  }
  return { enterFunctionMode: true, stopEasyReading: false, send: true };
}
