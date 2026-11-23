// 設為全部已讀／未讀（#299）：`v` 的三個答案共用這一條序列（MARK_READ_ANSWERS）。
// 入口：桌機右鍵選單與指令面板「設為全部已讀」＝直接 start('V')；列表好讀的 `v` 鍵與手機
// 「更多」的「已讀／未讀設定…」＝ask()，開選擇 sheet，挑了才 startAnswer（U／V 走這裡，
// W 交給 ListSession.markReadUnreadBefore，它要先把 PTT 游標對到選取的那篇）。
// 以下以 V 為例說明協定。
//
// pttbbs `mbbsd/bbs.c#b_mark_read_unread`（列表的 `v`，docs/pttbbs-screen-protocol.md §11.5）：
//   `v` → getdata「設定所有文章 (U)未讀 (V)已讀 (W)前已讀後未讀 (Q)取消？[Q] 」→ `v⏎`
//   ⇒ `brc_toggle_all_read(currbid, 1)`，回 FULLUPDATE 重畫列表。
// `v` 是 needitem（要有游標所在那一篇）但 `v` 分支不看那一篇 ⇒ 游標停在哪都一樣。
//
// 承重點同「前已讀後未讀」：`v` 沒進 prompt 時，第二步的 `v⏎` 會落回列表按鍵（再開一次
// prompt 後 ⏎＝取消，算無害，但畫面不在列表時就不知道會落在哪）⇒ 兩步序列化，第一步的
// expect 必須在畫面上看到 prompt 才准送第二步。prompt 畫在 b_lines-1（row 22，不是底列）
// ⇒ 掃整個畫面。
//
// 送出路徑與「跳到第一篇未讀」相同（article_search.submitSerializedSteps）：列表好讀時走
// list_session 的凍結交易（resumeOnLanding：全程不切原生，v⏎ 落回列表那一幀直接 rebuild
// 回好讀——已讀標記全變，累積 buffer 本來就過時），原生時走 CommandQueue。

import { refreshTargetOf } from './screen_refresh';
import { submitSerializedSteps } from './article_search';
import { serializedOpHint } from './serialized_op_gate';
import { HINT_ERROR } from './status_hint';
import { UNSUPPORTED_KEY_HINT } from './unsupported_hint';
import { recordFor } from './reading_record';
import { markReadPromptShown } from './mark_read_prompt';

// prompt 指紋與列表好讀「前已讀後未讀」共用（mark_read_prompt.js）。
export { markReadPromptShown };

export const MARK_ALL_READ_FLAG = 'markAllReadInFlight';

// PTT's three answers to the `v` prompt, as one table: what the answer line
// types, and the hints. U and V ignore the cursor and run here (startAnswer);
// W marks "up to the cursor article", so it needs PTT's cursor on that article
// first and runs through ListSession.markReadUnreadBefore (its own sync leg
// and PTT-refusal path), reached from the same entrance (startAnswer).
export const MARK_READ_ANSWERS = {
  U: {
    letter: 'u',
    done: '已將本板所有文章設為未讀',
    noPrompt: '設為全部未讀失敗：沒有出現 PTT 的設定提示',
    noReply: '設為全部未讀：PTT 沒有回應'
  },
  V: {
    letter: 'v',
    done: '已將本板所有文章設為已讀',
    noPrompt: '設為全部已讀失敗：沒有出現 PTT 的設定提示',
    noReply: '設為全部已讀：PTT 沒有回應'
  },
  // The wording is ListSession.markReadUnreadBefore's.
  W: { letter: 'w' }
};

export function MarkAllRead(core) {
  this._core = core;
}

MarkAllRead.prototype = {
  _hint: function(msg, ms, level) {
    const view = this._core.view;
    if (view && view.flashListHint) view.flashListHint(msg, ms || 3000, level);
  },

  // 這一幀能不能用：文章列表（與重新整理、跳到第一篇未讀同一個判準；搜尋結果／文摘
  // 不算——那是別的列表，`v` 的語意對不上使用者看到的那份）。
  available: function() {
    const core = this._core;
    if (!core.conn || !core.conn.isConnected) return false;
    const t = refreshTargetOf(core);
    return !!t && t.kind === 'article-list';
  },

  // `v` over the easy-reading article list and the phone More sheet's entry:
  // open the choice sheet (components/ContextMenu/MarkReadChoiceModal). Same
  // gates as an answer, so a screen that could not take any answer opens
  // nothing. true = the sheet is open (or a hint says why not).
  ask: function() {
    const core = this._core;
    if (refreshTargetOf(core)?.kind === 'mail') {
      this._hint(UNSUPPORTED_KEY_HINT, 4000, HINT_ERROR);
      return false;
    }
    if (!this.available()) {
      this._hint('只有在文章列表才能設定已讀未讀');
      return false;
    }
    const busy = serializedOpHint(core);
    if (busy) {
      this._hint(busy);
      return false;
    }
    if (typeof core.openMarkReadChoice === 'function' && core.openMarkReadChoice()) return true;
    this._hint(UNSUPPORTED_KEY_HINT, 4000, HINT_ERROR);
    return false;
  },

  // One of the sheet's answers ('U' / 'V' / 'W'). true = sent or hinted.
  startAnswer: function(answer) {
    const key = String(answer || '').toUpperCase();
    if (key === 'W') return this._startBefore();
    return this.start(key);
  },

  // W: everything up to the article under the cursor read, the rest unread.
  _startBefore: function() {
    const ls = this._core.listSession;
    const num = ls && ls.markReadCursorNum ? ls.markReadCursorNum() : null;
    if (num == null) {
      this._hint('請先把游標移到一篇有編號的文章（置底文不能當參考點）', 4000, HINT_ERROR);
      return false;
    }
    if (!this.available()) {
      this._hint('只有在文章列表才能設定已讀未讀');
      return false;
    }
    const busy = serializedOpHint(this._core);
    if (busy) {
      this._hint(busy);
      return false;
    }
    if (ls.markReadUnreadBefore(num)) return true;
    this._hint('設定已讀未讀失敗：目前的畫面不是好讀列表', 4000, HINT_ERROR);
    return false;
  },

  // 回 true ＝已送出（或已提示為何不送）。answer：'V'（預設，「設為全部已讀」）或 'U'。
  start: function(answer = 'V') {
    const core = this._core;
    const spec = MARK_READ_ANSWERS[answer];
    if (!spec || !spec.noPrompt) return false;
    // The mailbox has no such function (#252): refused, nothing sent.
    if (refreshTargetOf(core)?.kind === 'mail') {
      this._hint(UNSUPPORTED_KEY_HINT, 4000, HINT_ERROR);
      return false;
    }
    if (!this.available()) {
      this._hint(answer === 'V' ? '只有在文章列表才能設為全部已讀' : '只有在文章列表才能設定已讀未讀');
      return false;
    }
    const busy = serializedOpHint(core);
    if (busy) {
      this._hint(busy);
      return false;
    }
    const self = this;
    // 閱讀紀錄（決策表 'mark-all-read'）：只有已讀標記變了 ⇒ 不論成敗，回好讀時
    // 視野回到原處（列表好讀 rebuild 時驗證同板＋游標仍在原處）。
    const rr = recordFor(core);
    const bm = rr.begin('mark-all-read');
    const fail = function() {
      rr.end(bm, 'fail');
      self._hint(spec.noPrompt, 0, HINT_ERROR);
    };
    const steps = [
      {
        keys: 'v',
        kind: 'mark-all-read-prompt',
        fullRepaint: true,
        expect: function(snap, facts) {
          return markReadPromptShown(facts && facts.rowTexts);
        },
        onFail: fail
      },
      {
        // getdata 是整行輸入（vgets）⇒ 必須補 Enter，單送 `v` 不會動。
        keys: spec.letter + '\r',
        kind: 'mark-all-read-apply',
        fullRepaint: true,
        // 打字回顯的那一幀 prompt 還在 ⇒ 等到 prompt 消失（FULLUPDATE 的列表）才算落地。
        expect: function(snap, facts) {
          return !markReadPromptShown(facts && facts.rowTexts);
        },
        onDone: function() {
          rr.end(bm, 'done');
          self._hint(spec.done, 3000);
        },
        onFail: function() {
          rr.end(bm, 'fail');
          self._hint(spec.noReply, 0, HINT_ERROR);
        }
      }
    ];
    if (
      !submitSerializedSteps(core, steps, {
        kind: 'mark-all-read',
        flag: MARK_ALL_READ_FLAG,
        resumeOnLanding: true
      })
    ) {
      this._hint('指令處理中，請稍候再試');
      return false;
    }
    // Marking every article read asks PTT for the list anew (#125).
    core.navigationStack?.spend('markRead');
    return true;
  }
};

export default MarkAllRead;
