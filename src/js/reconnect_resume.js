// 斷線重連後回到原處（docs/reading-record.md「斷線重連」）。
//
// 斷線那一刻向閱讀紀錄領一張書籤（使用者眼睛看到的位置），連同「本篇是哪一篇」
// （AID）一起收著；重新連線、登入回到主功能表後，用 AID 跳文同一套機器
// （aid_navigation.startResume）把人帶回去，落地後的列／視野由閱讀紀錄的決策表
// （'reconnect-resume'）交給各畫面擁有者的還原器。
//
// 為什麼要另外記 AID：PTT 的 session（每個板的 getkeep 游標）跟著斷線一起死了，
// 重連後只能重新導航；開文章只准用 AID（編號會因刪文漂移，開錯篇比停在列表糟，
// 見 aid_navigation.js 檔頭），所以書籤裡的列號之外還要知道是哪一篇。斷線當下已經
// 沒有連線可以按 Q 問，只能用免費路徑（網址列／跳文落地記下的那篇）；問不到就退回
// 那篇所在的列表。
//
// 待回目標平常只在記憶體（同 deep link 的 pending）。存檔（localStorage SNAPSHOT_KEY）兩種：
//   - Android APK 被系統回收（docs/android-app.md「renderer 被回收」）：App 切到背景
//     （'pttandroid:stop'）時存，重建的頁面（config.restored）開機接回（pref reconnectResume）。
//   - 開站回到上次的地方（pref resumeLastPlace，預設開；docs/reading-record.md「開站回到上次的
//     地方」）：分頁切到背景／關掉（visibilitychange hidden、pagehide）時存，下一次開站接回。
//     手機瀏覽器回收分頁、使用者關掉再開，都像原生 App 一樣回到上次讀的文章或列表。出發前
//     有一段倒數提示可以取消；deep link 進來時以 deep link 為準（同一套 superseded）。
//   兩者都要求「存的那一刻已登入、連線中」，否則清掉存檔（登出後關掉不會在下次跳走）；
//   開機讀一次就刪，太舊（SNAPSHOT_MAX_AGE_MS）不接。
//
// 收手條件（未知就不動，寧可停在 PTT 給的位置）：
//   - 自己登出（logout）不算斷線，不回去。
//   - 這條連線從沒登入過（還在登入畫面就斷了）不重記：保留上一份待回目標，連續幾次
//     重連失敗之後登入成功仍回得去。
//   - 登入後使用者先動了（離開主功能表）、或 deep link 也在等登入（使用者剛給的連結
//     比斷線前的位置新）⇒ 作廢。
//   - 使用者關掉了（pref reconnectResume，預設開）：斷線時不記，重連途中才關也不出發
//     ⇒ 停在 PTT 原生的登入落點（主功能表）。

import { isMainMenuRow } from './aid_navigation';
import { recordFor } from './reading_record';
import { boardNameFromKey } from './screen_titles';
import { readEffectivePrefs } from './pref_storage';
import { isAndroidApp, androidRestored, STOP_EVENT } from './android_bridge';
import { readSearchResultsContext, validateSearchResultsContext } from './search_results_context';
import { resumeSearchResults } from './resume_search_results';
import { serializedOpHint } from './serialized_op_gate';
import { captureSearchResultAnchor, validateSearchResultAnchor } from './search_result_anchor';

// 開站接回時，登入回到主功能表後先倒數這麼久（提示上有「取消」）才出發。
export const OPEN_RESUME_DELAY_MS = 2500;
export const RESUME_TOAST_ID = 'resumeLastPlace';

export const SNAPSHOT_KEY = 'pttchrome.rendererResume.v1';
export const CHECKPOINT_DELAY_MS = 500;
const DEBUG_TRACE_KEY = 'pttchrome.recoveryDebug.v1';
// 回收後多久內回來還接得回去。再久的位置使用者多半不記得了，跳過去反而突兀。
export const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function takeDebugTrace() {
  try {
    const raw = window.localStorage.getItem(DEBUG_TRACE_KEY);
    window.localStorage.removeItem(DEBUG_TRACE_KEY);
    if (!raw || raw.length > 16384) return null;
    const trace = JSON.parse(raw);
    if (!Array.isArray(trace.events) || trace.events.length > 24 ||
        !Number.isFinite(trace.at) || Date.now() - trace.at < 0 ||
        Date.now() - trace.at > SNAPSHOT_MAX_AGE_MS) return null;
    // Reapply the field whitelist when reading persisted diagnostic data.
    return trace.events.map(event => diagnosticEvent(event.event, event, event.at));
  } catch (e) {
    return null;
  }
}

function diagnosticEvent(name, info, at = Date.now()) {
  const { kind, mode, reason, fromOpen, storage } = info || {};
  return { at, event: name, kind, mode, reason, fromOpen, storage };
}

function readSnapshot() {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    window.localStorage.removeItem(SNAPSHOT_KEY);
    if (!raw) return { snapshot: null, status: 'missing' };
    try {
      return { snapshot: JSON.parse(raw), status: 'read' };
    } catch (e) {
      return { snapshot: null, status: 'invalid-json' };
    }
  } catch (e) {
    return { snapshot: null, status: 'storage-error' };
  }
}

// 存檔 → 待回目標。純函式：太舊、形狀不對都回 null。
export function planFromSnapshot(snap, now) {
  if (!snap || typeof snap !== 'object' || typeof snap.at !== 'number') return null;
  if (!(now - snap.at >= 0 && now - snap.at <= SNAPSHOT_MAX_AGE_MS)) return null;
  const plan = snap.plan;
  if (!plan || typeof plan.board !== 'string' || !plan.board) return null;
  if (plan.kind !== 'article' && plan.kind !== 'list') return null;
  if (plan.kind === 'article' && !plan.aid) return null;
  if (plan.search && (plan.kind !== 'list' || !validateSearchResultsContext(plan.search, plan.board))) return null;
  return plan.searchPosition
    ? { ...plan, searchPosition: plan.search ? validateSearchResultAnchor(plan.searchPosition) : null }
    : plan;
}

function enabled() {
  return !!readEffectivePrefs().reconnectResume;
}

function openEnabled() {
  return !!readEffectivePrefs().resumeLastPlace;
}

// 開機要不要接回存檔。純函式：APK 回收重建且 reconnectResume 開著 ⇒ 'restored'（照舊直接
// 出發）；其餘（一般開站、APK 正常開啟、重建但只開了 resumeLastPlace）⇒ resumeLastPlace
// 開著才 'open'（倒數、可取消）；都關 ⇒ null。
export function bootResumeMode(restored, prefs) {
  const p = prefs || {};
  if (restored && p.reconnectResume) return 'restored';
  return p.resumeLastPlace ? 'open' : null;
}

export function isResumeToastTarget(el) {
  return !!(el && el.closest && el.closest('#' + RESUME_TOAST_ID));
}

// 書籤＋本篇身分 → 重連後要去哪。純函式。
//   { kind:'article', board, aid, bookmark } ：回到那篇文章（列由書籤還原）
//   { kind:'list', board, num, bookmark }    ：回到那個板的文章列表；num ＝斷線前
//                                              游標停的那篇（搜尋結果／文摘的編號是
//                                              另一個空間，不帶）
//   null                                       ：沒有可回的地方（主功能表、看板列表、
//                                              站內信、精華區…）
// post：{ board, aid } | null（aid_navigation.currentPostAid）。
// 文章沒有 AID 時退回那篇所在的列表，但只在列表的板就是文章的板時（身後的列表
// 可能是跳文之前的另一個板）。
export function resumePlanFrom(bm, post, searchContext, searchPosition) {
  if (!bm) return null;
  const art = bm.article;
  if (art && post && post.aid && post.board)
    return { kind: 'article', board: post.board, aid: post.aid, bookmark: bm };
  const list = bm.list;
  const board = list ? boardNameFromKey(list.board) : null;
  if (!board) return null;
  if (art && !(art.board && String(art.board).toLowerCase() === board.toLowerCase())) return null;
  // A tracked query also proves the result space on legacy captions, whose
  // generic footer cannot distinguish search results from ordinary lists.
  const search = !art && validateSearchResultsContext(searchContext, board);
  const plain = list.mode === 'plain' && !search;
  const plan = {
    kind: 'list',
    board: board,
    num: plain && list.cursorNum > 0 ? list.cursorNum : null,
    // 搜尋結果／文摘：回到的是完整列表（另一個編號空間），不還原視野。
    bookmark: plain ? bm : Object.assign({}, bm, { list: null })
  };
  // A known query can be reconstructed; its old result numbers cannot.
  if (search) {
    plan.search = search;
    const position = validateSearchResultAnchor(searchPosition);
    if (searchPosition !== undefined) plan.searchPosition = position;
  }
  return plan;
}

function readingPlan(core, buf, bookmark) {
  const nav = core.aidNavigation;
  const post = bookmark.article && nav?.currentPostAid ? nav.currentPostAid() : null;
  const search = readSearchResultsContext(core);
  const position = search && !bookmark.article ? captureSearchResultAnchor(buf, bookmark.list) : null;
  return resumePlanFrom(bookmark, post, search, position);
}

function sameReadingPlace(a, b) {
  return !!(a && b && a.kind === b.kind && a.board.toLowerCase() === b.board.toLowerCase() &&
    a.aid === b.aid && JSON.stringify(a.search || null) === JSON.stringify(b.search || null));
}

const readingGeometry = (core, view) => ({ mobile: !!core.mobile, chh: view?.chh, cards: !!view?.listCards });
const sameGeometry = (a, b) => a.mobile === b.mobile && a.chh === b.chh && a.cards === b.cards;

export function ReconnectResume(core, view, termBuf) {
  this._core = core;
  this._view = view;
  this._termBuf = termBuf;
  // resumePlanFrom 的輸出 | null。
  this._pending = null;
  // Keep startup decisions available when recording begins after login. This
  // bounded, in-memory history contains no article text or navigation targets.
  this._diagnostics = [];
  this._bootDiagnostic = null;
  this._previousRecording = typeof window !== 'undefined' ? takeDebugTrace() : null;
  // 這條連線看過主功能表了嗎（＝登入完成）。capture() 時清掉。
  this._loggedIn = false;
  this._checkpointTimer = null;
  this._lastVisibleSnapshot = null;
  if (termBuf && termBuf.addEventListener)
    termBuf.addEventListener('screenSettled', this._onSettled.bind(this));
  // 倒數中的出發（開站接回）：{ timer, plan } | null。
  this._countdown = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    // 開機讀一次就刪：APK 回收重建或開站接回（各自的開關）才用，否則丟掉。
    const saved = readSnapshot();
    const snap = saved.snapshot;
    const mode = bootResumeMode(isAndroidApp() && androidRestored(), readEffectivePrefs());
    const plan = planFromSnapshot(snap, Date.now());
    this._bootDiagnostic = {
      storage: saved.status,
      mode: mode,
      validPlan: !!plan,
      kind: plan ? plan.kind : null,
      ageMs: typeof snap?.at === 'number' ? Date.now() - snap.at : null
    };
    if (mode) {
      this._pending = plan && mode === 'open' ? Object.assign({}, plan, { fromOpen: true }) : plan;
      this._diag('restoreSnapshot', { mode: mode, kind: this._pending ? this._pending.kind : null });
    }
    // Search return history stored beside the snapshot follows only this plan.
    this._core?.articleShortcutSearch?.restoreForRecovery(this._pending);
    const save = () => this.saveSnapshot({ lifecycle: true });
    if (typeof window.addEventListener === 'function') {
      if (isAndroidApp()) window.addEventListener(STOP_EVENT, save);
      // 分頁切到背景／關掉：手機瀏覽器回收分頁之前一定先經過 hidden。
      window.addEventListener('pagehide', save);
      // Capture before the browser can replace mobile geometry during unload.
      // Canceling its confirmation leaves normal foreground checkpoints active.
      window.addEventListener('beforeunload', () => this.saveSnapshot({ lifecycle: !!document.hidden }));
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function')
    {
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') save();
      });
      document.addEventListener('scroll', event => {
        const target = event.target;
        if (target === view.mainDisplay || target?.classList?.contains('listBodyView'))
          this._scheduleCheckpoint();
      }, { capture: true, passive: true });
    }
  }
}

ReconnectResume.prototype = {
  _diag: function(name, info) {
    this._diagnostics.push(diagnosticEvent(name, info));
    if (this._diagnostics.length > 24) this._diagnostics.shift();
    const rec = this._core && this._core.debugRecorder;
    if (rec && rec.log) rec.log('reconnectResume.' + name, info);
    // Only an explicitly started recording leaves a small trace across page
    // destruction. Never persist wire data, bookmarks, or navigation targets.
    if (rec?.isRecording) {
      try {
        window.localStorage.setItem(DEBUG_TRACE_KEY, JSON.stringify({ at: Date.now(), events: this._diagnostics }));
      } catch (e) {
        // Diagnostics must not interfere with recovery when storage is blocked.
      }
    }
  },

  recordingStarted: function() {
    this._diag('recordingStarted', {});
  },

  diagnostics: function() {
    const prefs = readEffectivePrefs();
    return {
      boot: this._bootDiagnostic && { ...this._bootDiagnostic },
      recent: this._diagnostics.map(event => ({ ...event })),
      previousRecording: this._previousRecording?.map(event => ({ ...event })) || null,
      loggedIn: this._loggedIn,
      connectState: this._core.connectState,
      pendingKind: this._pending?.kind || this._countdown?.plan.kind || null,
      countingDown: !!this._countdown,
      resumeLastPlace: !!prefs.resumeLastPlace,
      reconnectResume: !!prefs.reconnectResume
    };
  },

  _cancelCheckpoint: function() {
    if (this._checkpointTimer !== null) clearTimeout(this._checkpointTimer);
    this._checkpointTimer = null;
  },

  _scheduleCheckpoint: function() {
    if (this._checkpointTimer !== null || !this._loggedIn || this._core.connectState !== 1 ||
        (typeof document !== 'undefined' && document.hidden) ||
        !(openEnabled() || (isAndroidApp() && enabled()))) return;
    // A trailing throttle has a bounded delay even during continuous scrolling.
    // Re-read the location when it fires; never persist an event-time bookmark.
    const geometry = readingGeometry(this._core, this._view);
    this._checkpointTimer = setTimeout(() => {
      this._checkpointTimer = null;
      const core = this._core;
      if (!this._loggedIn || core.connectState !== 1 || this.hasPending() ||
          (typeof document !== 'undefined' && document.hidden) ||
          serializedOpHint(core) || core.commandQueue?.idle === false ||
          core.easyReading?._functionMode || core.listSession?.state === 'opening' ||
          core.listSession?._holdReason === 'external') return;
      if (!sameGeometry(geometry, readingGeometry(core, this._view))) {
        this._scheduleCheckpoint();
        return;
      }
      const buf = this._termBuf;
      const list = core.listSession;
      // pageState 3 is the terminal's recognized article-status frame. Native
      // list records already require a clean-list fingerprint from their owner.
      const reading = buf.pageState === 3 || list?.state === 'active' ||
        (list?.state === 'idle' && list.readingPosition?.()?.native);
      if (reading || this._atMainMenu() || core.boardListSession?.state === 'active')
        this.saveSnapshot();
    }, CHECKPOINT_DELAY_MS);
  },

  // App.onClose：**要在任何畫面擁有者被 disable／reset 之前**呼叫（列表 session 的
  // disable 會丟掉看板身分，aidNavigation.reset 會清掉跳文落地的那篇）。
  // loggedOut：這次斷線是使用者自己登出。
  capture: function(loggedOut) {
    this._cancelCheckpoint();
    // 倒數中斷線：那份計畫作廢（重連後照斷線這一刻的位置重新算）。
    this._cancelCountdown();
    const wasLoggedIn = this._loggedIn;
    this._loggedIn = false;
    if (loggedOut) {
      try {
        window.localStorage.removeItem(SNAPSHOT_KEY);
      } catch (e) {
        // A blocked storage backend must not interfere with logout.
      }
      this.discard('logout');
      return;
    }
    // 還沒登入就斷了：畫面是登入流程，沒有閱讀位置；保留上一份。
    if (!wasLoggedIn) {
      this._diag('captureSkipped', { reason: 'not-logged-in' });
      return;
    }
    if (!enabled()) {
      this._core?.articleShortcutSearch?.suspendForRecovery(null);
      this.discard('disabled');
      return;
    }
    const core = this._core;
    const bm = recordFor(core).begin('reconnect-resume', { view: this._view, buf: this._termBuf });
    this._pending = readingPlan(core, this._termBuf, bm);
    this._core?.articleShortcutSearch?.suspendForRecovery(this._pending);
    this._diag('capture', this._pending
      ? { kind: this._pending.kind, board: this._pending.board, aid: this._pending.aid || null, num: this._pending.num || null }
      : { kind: null });
  },

  // APK 切到背景：把「現在斷線的話要回哪」存起來（不動 _pending、不算斷線）。
  // 沒登入、關掉了、沒有可回的地方 ⇒ 清掉存檔。
  saveSnapshot: function(options = {}) {
    let plan = null;
    const want = openEnabled() || (isAndroidApp() && enabled());
    if (this._loggedIn && want && this._core && this._core.connectState === 1) {
      const core = this._core;
      const bm = recordFor(core).begin('reconnect-resume', { view: this._view, buf: this._termBuf });
      plan = readingPlan(core, this._termBuf, bm);
    }
    const geometry = readingGeometry(this._core, this._view);
    const previous = this._lastVisibleSnapshot;
    if (options.lifecycle && previous && sameReadingPlace(plan, previous.plan) &&
        !sameGeometry(geometry, previous.geometry))
      plan = previous.plan;
    if (!options.lifecycle) this._lastVisibleSnapshot = { plan, geometry };
    this._core?.articleShortcutSearch?.persistForRecovery(plan);
    let storage = plan ? 'written' : 'removed';
    try {
      if (plan) {
        // 書籤裡的畫面擁有者是物件參照，存不下也用不到（還原走 core 上的現役擁有者）。
        const bookmark = Object.assign({}, plan.bookmark, { listOwner: null, boardListOwner: null });
        window.localStorage.setItem(
          SNAPSHOT_KEY,
          JSON.stringify({ at: Date.now(), plan: Object.assign({}, plan, { bookmark: bookmark }) })
        );
      } else {
        window.localStorage.removeItem(SNAPSHOT_KEY);
      }
    } catch (e) {
      storage = 'storage-error';
      // 存不下（被擋／滿了）：回收後就回不去，跟以前一樣。
    }
    const reason = plan ? null : !want ? 'disabled' : !this._loggedIn ? 'not-logged-in' :
      this._core?.connectState !== 1 ? 'disconnected' : 'no-plan';
    this._diag('saveSnapshot', { kind: plan ? plan.kind : null, storage: storage, reason: reason });
  },

  discard: function(reason) {
    const hadPending = !!(this._pending || this._countdown);
    if (hadPending) this._core?.articleShortcutSearch?.abandonRecovery(reason);
    this._cancelCountdown();
    if (!hadPending) return;
    this._diag('discard', { reason: reason });
    this._pending = null;
  },

  hasPending: function() {
    return !!(this._pending || this._countdown);
  },

  // 開站接回的倒數：提示＋「取消」。倒數完再確認一次還在主功能表才出發。
  _startCountdown: function(plan) {
    const self = this;
    const timer = setTimeout(function() {
      if (!self._countdown || self._countdown.timer !== timer) return;
      self._countdown = null;
      self._hideToast();
      self._dispatch(plan);
    }, OPEN_RESUME_DELAY_MS);
    this._countdown = { timer: timer, plan: plan };
    this._showToast(plan);
    this._diag('countdown', { kind: plan.kind, board: plan.board });
  },

  _cancelCountdown: function() {
    if (!this._countdown) return;
    clearTimeout(this._countdown.timer);
    this._countdown = null;
    this._hideToast();
  },

  // 使用者按了「取消」：停在主功能表，這次不回去。
  cancel: function() {
    if (!this._countdown && !this._pending) return;
    this._core?.articleShortcutSearch?.abandonRecovery('cancel');
    this._diag('cancel', {});
    this._cancelCountdown();
    this._pending = null;
  },

  _showToast: function(plan) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById(RESUME_TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = RESUME_TOAST_ID;
      el.setAttribute('role', 'status');
      const text = document.createElement('span');
      text.className = 'resumeLastPlaceText';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'resumeLastPlaceCancel';
      btn.textContent = '取消';
      const self = this;
      // App 的滑鼠入口在 window：不搶 #t 焦點、不外傳成點終端機（App._onUploadLayer 也認它）。
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
      });
      el.addEventListener('mouseup', function(e) {
        e.stopPropagation();
      });
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        self.cancel();
      });
      el.appendChild(text);
      el.appendChild(btn);
      document.body.appendChild(el);
    }
    el.querySelector('.resumeLastPlaceText').textContent =
      '即將回到上次的地方：' + plan.board + (plan.kind === 'article' ? ' 的文章' : ' 看板');
    el.hidden = false;
  },

  _hideToast: function() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(RESUME_TOAST_ID);
    if (el) el.hidden = true;
  },

  _dispatch: function(plan) {
    const core = this._core;
    const nav = core.aidNavigation;
    const dl = core.deepLinkController;
    if (core.connectState !== 1 || !this._atMainMenu() || !nav || nav.active || (dl && dl.hasPending && dl.hasPending())) {
      this._diag('discard', { reason: 'superseded' });
      this._core?.articleShortcutSearch?.abandonRecovery('superseded');
      return;
    }
    // 同 deep_link_controller._dispatch：AutoLogin 的「請按任意鍵 ⇒ 送空白」會踩到
    // 進板畫面，打亂序列正在等的那一幀。
    if (core.autoLogin && core.autoLogin.stop) core.autoLogin.stop();
    this._diag('dispatch', { kind: plan.kind, board: plan.board, fromOpen: !!plan.fromOpen });
    const self = this;
    const started = nav.startResume(plan, function(result) {
      const ended = outcome => self._core?.articleShortcutSearch?.recoveryEnded(plan, outcome);
      if (result?.ok && plan.search) resumeSearchResults(core, plan.search, ended, plan.searchPosition);
      else ended(result);
    });
    if (!started) this._core?.articleShortcutSearch?.abandonRecovery('superseded');
  },

  _atMainMenu: function() {
    const buf = this._termBuf;
    if (!buf || !buf.getRowText) return false;
    return isMainMenuRow(buf.getRowText(0, 0, buf.cols));
  },

  _onSettled: function() {
    if (this._core.articleResize?.active || this._core.listResize?.active) return;
    this._scheduleCheckpoint();
    if (!this._atMainMenu()) {
      // 登入後不在主功能表 ＝使用者自己走開了（我們只在主功能表出發）。
      if (this._loggedIn) this.discard('moved');
      return;
    }
    this._loggedIn = true;
    if (!this._pending) return;
    const core = this._core;
    if (core.connectState !== 1) return;
    if (!(this._pending.fromOpen ? openEnabled() : enabled())) {
      this.discard('disabled');
      return;
    }
    // deep link 先登記了（同一次 settle 它會先跳，已在跑也一樣）：使用者剛給的連結
    // 比斷線前的位置新。
    const dl = core.deepLinkController;
    const nav = core.aidNavigation;
    if ((dl && dl.hasPending && dl.hasPending()) || !nav || nav.active) {
      this.discard('superseded');
      return;
    }
    const plan = this._pending;
    this._pending = null;
    if (plan.fromOpen) {
      // 開站接回：使用者可能根本不想回去 ⇒ 先倒數、可取消。
      if (core.autoLogin && core.autoLogin.stop) core.autoLogin.stop();
      this._startCountdown(plan);
      return;
    }
    this._dispatch(plan);
  }
};

export default ReconnectResume;
