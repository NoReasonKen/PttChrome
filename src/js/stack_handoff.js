// A handoff (#24, #119, #125): Back has revealed a live layer, or the dark
// fallback, and PTT is answering. It owns what lasts until the real page takes
// over: the Backs PTT is still to follow (legs) and their sends, the timers and
// listeners, the input bound on the revealed layer and the action remembered
// there. The navigation stack starts it, asks it questions and ends it; what
// the end does to the stack stays with the stack (navigation_stack.js).
import { readEffectivePrefs } from './pref_storage';
import { OWNER_ARTICLE_LIST, OWNER_BOARD_LIST } from './list_render_owner';
import { sameBoard } from './screen_titles';
import { handoffStep, PAGE, HANDOFF_TIMEOUT_MS, HANDOFF_REACH_POLL_MS } from './page_stack';
import { i18n } from './i18n';
import { STACK_NOTICE_MS, LOCAL_INPUT, stopLocal } from './stack_layer';

// The progress bar's owner while a remembered action waits for PTT.
const PENDING_OWNER = 'stackPending';

// The board the article list session reads, or null before it has read one.
export const listBoard = core => core.listSession?._boardName || null;

// The board and key of the article open in PTT, or null.
export function openArticleKey(core) {
  const key = core.easyReading?._articleKey;
  const board = core.view._articleBoard;
  return key && board ? board + '\n' + key : null;
}

export class Handoff {
  // `revealed`: what Back from the top of the stack reveals (its page, layer,
  // App Bar, toolbar and post), or null for the dark fallback. `board`: the
  // page left's board. `end(how)` ends the handoff through the stack.
  // `level`, `follow`, `reveal`, `finish` and `hint`: see NavigationStack.begin.
  constructor(core, revealed, { level, board, end, follow, reveal, finish, hint }) {
    this.core = core;
    this.layer = revealed?.layer || null;
    this.level = level;
    this.target = revealed?.page.kind || (level === PAGE.ARTICLE ? PAGE.ARTICLE_LIST : null);
    this.id = revealed?.page.id;
    this.results = !!revealed?.page.results;
    this.board = board;
    this.identity = openArticleKey(core);
    this.appBar = revealed?.appBar || null;
    this.toolbar = revealed?.toolbar || null;
    this.post = revealed?.post || null;
    this.sentAt = performance.now();
    this.presentedAt = null;
    this.touches = 0;
    this.holds = 0;
    this.lastScrollAt = -Infinity;
    this.timer = null;
    this.followTimer = null;
    this.listeners = [];
    this.layerListeners = [];
    this.end = end;
    this.finish = finish;
    this.follow = follow;
    this.reveal = reveal;
    this.hint = hint;
    this.action = null;
    // The Backs PTT is still to follow after this one, in order: the page each
    // leaves and what it is expected to show.
    this.legs = [];
  }

  // A debug recording keeps each handoff's timeline (#24): the send, each
  // redraw and settle, the presentation and the end, in ms since the send.
  mark(mark, info) {
    const rec = this.core.debugRecorder;
    if (!rec?.isRecording) return;
    rec.log('stack.handoff', { mark, ms: Math.round(performance.now() - this.sentAt), ...info });
  }

  // What became of an action made on the revealed page, for debug recordings:
  // remembered (replacing another), a key held with the others, run, or
  // dropped and why.
  diagAction(outcome, info) {
    const rec = this.core.debugRecorder;
    if (!rec?.isRecording) return;
    rec.log('stack.action', { outcome, ms: Math.round(performance.now() - this.sentAt), presented: this.presentedAt != null, ...info });
  }

  // Listens for PTT's answer, shows the revealed layer and sends the Back
  // (`send` returns whether it was sent). Returns whether it was sent; when it
  // was not, everything is undone and the caller cancels.
  start(send) {
    const core = this.core;
    const layer = this.layer;
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      this.listeners.push(() => target.removeEventListener(type, fn, options));
    };
    if (layer) {
      layer.show(true);
      this.bindLayer();
    }
    listen(core.conn, 'close', () => this.end('disconnected'));
    listen(core.buf, 'viewUpdate', () => this.presentedAt == null && this.mark('view'));
    // A changed page state settles first, and a session may present its page
    // from it.
    listen(core.buf, 'pageStateSettled', () => this.mark('pageStateSettled', { pageState: core.buf.pageState }));
    listen(core.buf, 'screenSettled', () => {
      this.mark('settled', { pageState: core.buf.pageState });
      this.screenAnswered();
    });
    core._refreshScreenContext?.();
    let sent = false;
    try {
      sent = send();
    } finally {
      if (!sent) {
        this.cleanup();
        layer?.show(false);
      }
    }
    if (sent) {
      this.mark('sent', { level: this.level, target: this.target, layer: !!layer });
      this.step();
    }
    return sent;
  }

  // The kind of page shown: what the last Back revealed, which PTT may still
  // be on its way to (#125).
  shownTarget() {
    return this.legs.length ? this.legs[this.legs.length - 1].target : this.target;
  }

  // What the last Back left: the leg PTT follows last, or the first Back.
  lastLeg() {
    return this.legs[this.legs.length - 1] || this;
  }

  // An action made on the revealed page before PTT has caught up ({ run, drop }):
  // remembered with the progress bar showing, the last one wins, and run once
  // the real page takes over; any other end of the handoff drops it.
  remember(action) {
    this.diagAction('remembered', { replaced: !!this.action, refresh: !!action.refresh, keys: action.sends?.length || 0 });
    this.action = action;
    this.core.view.setListLoading?.(true, PENDING_OWNER);
    return true;
  }

  // An action on the revealed page (#124), remembered until PTT has caught up.
  // A dropped one says it did not run.
  whenReady(run) {
    return this.remember({ run, drop: () => this.notRun() });
  }

  // A key for PTT made on the revealed page: keys made one after another are
  // all kept, in order, and sent together once the real page takes over.
  holdKey(send) {
    if (this.action?.sends) {
      this.action.sends.push(send);
      this.diagAction('keyHeld', { keys: this.action.sends.length });
      return true;
    }
    const sends = [send];
    return this.remember({ sends, run: () => sends.forEach(key => key()), drop: () => this.notRun() });
  }

  notRun() {
    this.core.view.flashListHint?.(i18n('stack_actionNotRun'), STACK_NOTICE_MS);
  }

  // Drops a remembered action without running it.
  forget(reason) {
    if (this.action) this.diagAction('dropped', { reason });
    this.action = null;
    this.core.view.setListLoading?.(false, PENDING_OWNER);
  }

  // The entry of the revealed list under `target`, or null: see
  // StackListLayer.entryAt.
  layerEntryAt(target) {
    const layer = this.layer;
    return layer?.el.contains(target) ? layer.entryAt?.(target) || null : null;
  }

  // The live layer of `board`'s article list this Back revealed, before its
  // real page is presented, or null.
  keptListLayer(board) {
    if (!this.layer || this.legs.length || this.target !== PAGE.ARTICLE_LIST || this.presentedAt != null ||
        !sameBoard(this.board, board)) return null;
    return this.layer;
  }

  // PTT's answer shows content newer than the list layer shows again (#128):
  // a brief notice, text only. Search results and the home dashboard show
  // none. Returns whether it shows.
  noticeNewContent() {
    if (!this.layer || this.legs.length || this.results || (this.target !== PAGE.ARTICLE_LIST && this.target !== PAGE.BOARD_LIST)) return false;
    this.core.view.flashListHint?.(i18n('stack_newArticles'), STACK_NOTICE_MS);
    return true;
  }

  // Whether this Back shows the page of `kind` again from its live layer.
  showsLayerOf(kind) {
    return !!this.layer && !this.legs.length && this.target === kind;
  }

  // The page shown is being swiped away: the real page does not take over
  // until the returned release, as while a finger is down.
  holdSwap() {
    this.holds++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      if (this.ended) return;
      this.holds--;
      this.step();
    };
  }

  // A later Back leaves the revealed page: its layer goes away.
  leaveLayer() {
    this.unbindLayer();
    this.layer?.hide();
    this.layer?.destroy();
  }

  // A later Back (#125) left the page of `left` and reveals `revealed` (as in
  // the constructor) or the dark fallback. PTT follows it once it has answered
  // the earlier Backs.
  backTo(left, revealed) {
    const last = this.lastLeg();
    this.legs.push({
      level: left.kind, target: revealed?.page.kind || null, id: revealed?.page.id, board: left.board,
      identity: left.kind === PAGE.ARTICLE ? last.id : null
    });
    this.layer = revealed?.layer || null;
    this.appBar = revealed?.appBar || null;
    this.toolbar = revealed?.toolbar || null;
    this.post = revealed?.post || null;
    this.reveal?.(this.layer, revealed?.title || '', this.appBar);
    if (this.layer) {
      this.layer.show(true);
      this.bindLayer();
    }
    this.core._refreshScreenContext?.();
    this.mark('back', { level: left.kind, target: revealed?.page.kind || null, layer: !!this.layer });
    // PTT already shows the page just left: it follows at once.
    if (this.presentedAt != null) {
      this.presentedAt = null;
      this.followNext();
    }
  }

  // Input on the revealed layer stays on it: a tap is remembered for after the
  // swap, and touches and scrolling defer the swap.
  bindLayer() {
    const layer = this.layer;
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      this.layerListeners.push(() => target.removeEventListener(type, fn, options));
    };
    const local = event => {
      stopLocal(event);
      // A tap on an entry is remembered by identity, like any other action.
      const id = layer.tapOf(event);
      if (id) this.whenReady(() => layer.openTapped(this.core, id));
    };
    for (const type of LOCAL_INPUT) listen(layer.el, type, local);
    const touches = event => {
      this.touches = event.touches.length;
      this.step();
    };
    // A finger's later events go to its first target, which a re-render may
    // have removed from the layer by then.
    listen(layer.el, 'touchstart', event => {
      touches(event);
      listen(event.target, 'touchend', touches);
      listen(event.target, 'touchcancel', touches);
    }, true);
    listen(layer.el, 'touchend', touches, true);
    listen(layer.el, 'touchcancel', touches, true);
    listen(layer.el, 'scroll', () => {
      this.lastScrollAt = performance.now();
      this.step();
    }, { capture: true, passive: true });
  }

  unbindLayer() {
    this.layerListeners.forEach(remove => remove());
    this.layerListeners = [];
    this.touches = 0;
  }

  // PTT shows the page a later Back left (#125): it is sent that Back, and
  // the handoff waits for what that Back shows.
  followNext() {
    clearTimeout(this.timer);
    Object.assign(this, this.legs.shift(), { sentAt: performance.now(), presentedAt: null });
    this.mark('follow', { level: this.level, target: this.target });
    // From its own task: the page PTT shows may still be presenting itself.
    this.followTimer = setTimeout(() => this.sendFollow());
    this.step();
  }

  sendFollow() {
    if (this.ended) return;
    this.followTimer = null;
    if (this.follow?.(this.level)) return this.mark('sent', { level: this.level, target: this.target });
    // Another operation owns the line for now: the Back waits for it, within
    // the handoff bound.
    if (performance.now() - this.sentAt >= HANDOFF_TIMEOUT_MS) return this.end('timeout');
    this.followTimer = setTimeout(() => this.sendFollow(), HANDOFF_REACH_POLL_MS);
  }

  // PTT shows the page the current Back expects: a later Back is sent next,
  // or the real page takes over once the reader is idle.
  answered(info) {
    if (this.legs.length) return this.followNext();
    this.presentedAt = performance.now();
    this.mark('presented', info);
    this.step();
  }

  // The owning session presented a real page of `kind`: an article list
  // (rebuilt, scrolled and positioned), a board list, the home dashboard, or an
  // article reopened by search backtracking.
  pagePresented(kind) {
    const core = this.core;
    if (this.presentedAt != null) return;
    // Search backtracking stopped on the board list instead of the article.
    if (this.target === PAGE.ARTICLE && kind === PAGE.ARTICLE_LIST) return this.end('unexpected');
    if (this.target && kind !== this.target) {
      // An article list presents itself again while it is being left; any
      // other page is PTT leaving the route the stack describes.
      if (kind === PAGE.ARTICLE_LIST || kind === PAGE.ARTICLE) return;
      return this.end('unexpected');
    }
    if (kind === PAGE.ARTICLE && openArticleKey(core) !== this.id) return this.end('unexpected');
    if (kind === PAGE.ARTICLE_LIST && this.target) {
      if (core.buf.pageState !== 2 || core.listSession?.state !== 'active') return;
      // A list that has not read its board yet, as after rebuilt search
      // results, presents itself again once it has.
      const board = listBoard(core);
      if (!board) return;
      if (!sameBoard(board, this.board)) return this.end('unexpected');
    }
    this.answered({ kind });
  }

  // A screen settled: it ends the handoff when it is PTT's answer and
  // something other than the page this Back expects.
  screenAnswered() {
    const core = this.core;
    if (this.ended || this.presentedAt != null) return;
    const pageState = core.buf.pageState;
    if (!this.target) {
      // The page being left until a session presents its page; any other
      // screen is PTT's answer.
      if (this.level === PAGE.ARTICLE && pageState === 3 && openArticleKey(core) === this.identity) return;
      const leaving = this.level === PAGE.BOARD_LIST ? OWNER_BOARD_LIST : OWNER_ARTICLE_LIST;
      if (pageState === 2 && core.buf.listRenderOwner === leaving) return;
      return this.end('presented');
    }
    if (this.target === PAGE.ARTICLE) {
      // Search backtracking reopens the article by its code, through screens
      // of its own, and presents it.
      if (core.articleShortcutSearch?.active) return;
      if (pageState === 3 && openArticleKey(core) === this.id) return;
    } else if (this.target === PAGE.ARTICLE_LIST) {
      if (pageState === 3 && openArticleKey(core) === this.identity) return;
      if (pageState === 2 && readEffectivePrefs().enableEasyReadingList) return;
    } else if (pageState === 1 || pageState === 2) {
      // Leaving an article list: the list itself until PTT answers, then the
      // main menu or a board list.
      return;
    }
    this.end('unexpected');
  }

  step() {
    if (this.ended) return;
    clearTimeout(this.timer);
    const next = handoffStep({
      ...this, touches: this.touches + this.holds, reached: this.layer?.reaches?.(this.core) ?? true, now: performance.now()
    });
    if (next.action === 'swap') return this.end('presented');
    if (next.action === 'timeout') return this.end('timeout');
    this.timer = setTimeout(() => this.step(), next.ms);
  }

  // Stops the timers and listeners; the handoff is over.
  cleanup() {
    this.ended = true;
    clearTimeout(this.timer);
    clearTimeout(this.followTimer);
    this.unbindLayer();
    this.listeners.forEach(remove => remove());
  }

  // The first part of an end (`how`, see NavigationStack._end): the revealed
  // page becomes PTT's real page, or is kept shown when its source is `gone`.
  close(how) {
    const core = this.core;
    this.mark('end', { how });
    if (this.action) this.diagAction(how === 'presented' ? 'run' : 'dropped', { reason: how, keys: this.action.sends?.length || 0 });
    const listRefresh = this.action?.refresh && this.shownTarget() !== PAGE.ARTICLE;
    if (how === 'presented' && this.layer && !listRefresh) this.layer.alignReal(core);
    this.cleanup();
    core.view.setListLoading?.(false, PENDING_OWNER);
    if (how !== 'gone') this.layer?.hide();
  }

  // The remembered action, once the end has shown the real page: run from its
  // own task when PTT presented the page, otherwise dropped. A comment on a
  // deleted source is refused by the stack instead.
  settleAction(how) {
    if (!this.action || how === 'gone') return;
    if (how === 'presented') setTimeout(this.action.run);
    else this.action.drop(how);
  }
}
