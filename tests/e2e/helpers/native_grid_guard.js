// Native grid guard (#186): with easy reading on, PttChrome presents every
// screen after login (#155), so a frame drawn on PTT's terminal grid is a
// regression or an easy-reading gap. installReplay installs it on every offline
// page, so any spec that crosses such a screen reports it
// (docs/offline-replay-testing.md, "Page guards").
//
// Signal: a frame TermView draws on the grid (_gridRender, not the list
// easy-reading window) reaches paint visible and uncovered, while the
// easy-reading pref is on and after the main menu has been seen once (login).
//
// What a hit does (NATIVE_GRID_GUARD overrides the default):
//   fail (default on offline-mobile): a hit outside ALLOWED fails the test softly.
//   report: append every distinct hit, with its allowed issue, to
//           NATIVE_GRID_REPORT (JSON lines) for an inventory over a suite.
//   off (default elsewhere): record hits in the page only (window.__nativeGridGuard).
// Hits reach the test through a page binding, not the console: the app's debug
// log and the privacy specs read the console, and a hit carries screen text.

const fs = require('fs');

const BINDING = '__nativeGridHit';

function pageGuard({ binding }) {
  if (window.__nativeGridGuard) return;
  const seen = new Set();
  // reset(): forget the hits so far, for a spec that checks the guard itself.
  const state = { loggedIn: false, hits: [], reset: () => { state.hits.length = 0; seen.clear(); } };
  window.__nativeGridGuard = state;

  function hook(app) {
    const view = app && app.view;
    if (!view || view.__nativeGridHooked) return;
    view.__nativeGridHooked = true;
    // The last rendered frame: its overrides, and whether it drew the native grid.
    let latest;
    let onGrid = false;
    let armed = false;
    // A closed connection logs in again: its login screens come before the main
    // menu. The close can land after the next login prompt, so the prompt
    // (the auto-login's own test) also counts as logged out.
    const onClose = app.onClose;
    app.onClose = function() {
      state.loggedIn = false;
      return onClose.apply(this, arguments);
    };
    const render = view._renderScreenLines;
    view._renderScreenLines = function(lines, dropHidden, inlinePreview, hoverPreview, overrides) {
      const result = render.apply(this, arguments);
      try {
        const buf = app.buf;
        if (buf.getRowText(0, 0, buf.cols).includes('主功能表')) state.loggedIn = true;
        else if (state.loggedIn && loginPrompt(buf)) state.loggedIn = false;
        latest = overrides;
        onGrid = this._gridRender && !(overrides && overrides.listScroll);
        if (onGrid) schedule();
      } catch (e) {
        report({ guardError: String(e) });
      }
      return result;
    };

    // Judge what reaches paint: the first task after a frame sees the DOM as
    // painted. A grid frame is checked every frame until it shows or another
    // frame replaces it, because a cover (the home dashboard, a page-stack
    // layer) can lift without a new render.
    function schedule() {
      if (armed) return;
      armed = true;
      const tick = () => requestAnimationFrame(() => setTimeout(() => {
        try {
          if (!onGrid) armed = false;
          else if (check(latest)) armed = false;
        } catch (e) {
          armed = false;
          report({ guardError: String(e) });
        }
        if (armed) tick();
      }, 0));
      tick();
    }

    function check(overrides) {
      const buf = app.buf;
      const prefs = window.__readPrefs ? window.__readPrefs() : null;
      // Done (true) unless the frame is covered: a pref change or login redraws.
      if (!state.loggedIn || !prefs || !prefs.enableEasyReading) return true;
      if (!shown()) return false;
      report({
        surface: view._frameSurface(overrides),
        pageState: buf.pageState,
        functionMode: !!buf.easyReadingFunctionMode,
        listRenderMode: buf.listRenderMode,
        title: buf.getRowText(0, 0, buf.cols).trim().replace(/\s+/g, ' ').slice(0, 40),
        // Context for classifying a hit: the dashboard dismissed by a key, a
        // reconnect resume in flight, the list owner's state.
        homeDismissed: !!(app.homeDashboard && app.homeDashboard._dismissed),
        resume: (app.reconnectResume && app.reconnectResume.diagnostics().pendingKind) || null,
        listState: app.listSession ? app.listSession.state : null,
      });
      return true;
    }
  }

  function loginPrompt(buf) {
    for (let row = 0; row < buf.rows; row++) {
      const text = buf.getRowText(row, 0, buf.cols);
      if (text.includes('請輸入代號') || text.includes('請輸入帳號')) return true;
    }
    return false;
  }

  // The terminal grid is visible and on top: not hidden, and not covered by the
  // home dashboard or a page-stack layer (the same test as the #169 entry specs).
  function shown() {
    const main = document.querySelector('.main:not([data-stack-layer])');
    const content = main && main.querySelector('#mainContainer');
    if (!content || !content.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    const rect = main.getBoundingClientRect();
    const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    const bar = document.getElementById('mobileAppBar');
    const toolbar = document.querySelector('.mobileToolbarBar');
    const top = Math.max(0, rect.top, bar ? bar.getBoundingClientRect().bottom : 0);
    const bottom = Math.min(innerHeight, rect.bottom, toolbar ? toolbar.getBoundingClientRect().top : innerHeight);
    if (!(right > left && bottom > top)) return false;
    return [0.25, 0.5, 0.75].some((f) => {
      const hit = document.elementFromPoint((left + right) / 2, top + (bottom - top) * f);
      return !!hit && main.contains(hit) && !hit.closest('#homeDashboard, [data-stack-layer]');
    });
  }

  function report(hit) {
    const key = JSON.stringify(hit);
    if (seen.has(key)) return;
    seen.add(key);
    state.hits.push(hit);
    if (typeof window[binding] === 'function') window[binding](hit);
  }

  let app;
  Object.defineProperty(window, '__app', {
    configurable: true,
    get: () => app,
    set: (value) => {
      app = value;
      hook(value);
    },
  });
}

// Known hits, each waiting on the issue that removes it. Fixing an issue
// removes its entry; the suite then proves no such frame is painted. The first
// matching entry wins, so the narrower entries come first.
const ALLOWED = [
  { issue: 160, why: 'article prompt mirrored natively', match: (hit) => hit.functionMode },
  { issue: 188, why: 'reconnect or reload recovery drives PTT through native screens',
    match: (hit) => hit.resume != null },
  { issue: 159, why: 'article-list key handed to the native view',
    match: (hit) => hit.listState === 'functionMode' },
  { issue: 189, why: 'unexpected pause screen after Back, and the list after it',
    match: (hit) => hit.listState === 'suspended' },
  { issue: 190, why: 'board-select prompt from the search history', match: (hit) => hit.title.includes('選擇看板') },
  { issue: 191, why: 'native main menu opened from home, and the screens reached from it',
    match: (hit, { test }) => hit.homeDismissed ||
      (/ from a fresh main menu /.test(test) && !hit.title.includes('主功能表')) },
  { issue: 187, why: 'main menu painted before the home dashboard covers it',
    match: (hit) => hit.title.includes('主功能表') },
];

function allowedIssue(hit, where) {
  const entry = ALLOWED.find((a) => a.match(hit, where));
  return entry ? entry.issue : null;
}

// Judged hits per page, for a spec that waits until the guard has judged one.
const judgedWaiters = new WeakMap();

// Resolves once the guard has judged (and in fail mode, failed on) a hit that
// matches; the page record alone can run ahead of the binding call.
function nativeGridJudged(page, match) {
  return new Promise((resolve) => {
    if (!judgedWaiters.has(page)) judgedWaiters.set(page, []);
    judgedWaiters.get(page).push({ match, resolve });
  });
}

const guardedPages = new WeakSet();

// opts.mode overrides the default and the environment (the guard's own spec records only).
async function installNativeGridGuard(page, opts = {}) {
  const { test, expect } = require('@playwright/test');
  let project = null;
  try {
    project = test.info().project.name;
  } catch {}
  const mode = opts.mode || process.env.NATIVE_GRID_GUARD || (project === 'offline-mobile' ? 'fail' : 'off');
  const out = process.env.NATIVE_GRID_REPORT;
  if (mode === 'report' && !out) throw new Error('NATIVE_GRID_GUARD=report needs NATIVE_GRID_REPORT=<file.jsonl>');
  if (guardedPages.has(page)) return;
  guardedPages.add(page);
  if (mode === 'fail' || mode === 'report') {
    await page.exposeFunction(BINDING, (hit) => {
      let info;
      try {
        info = test.info();
      } catch {
        return; // after the test ended
      }
      const where = { spec: info.file.replace(/^.*\/tests\/e2e\//, ''), test: info.title };
      const issue = hit.guardError ? null : allowedIssue(hit, where);
      if (mode === 'report') {
        fs.appendFileSync(out, JSON.stringify({ ...where, allowed: issue, hit }) + '\n');
      } else if (issue == null) {
        expect
          .soft(hit, 'native grid painted under easy reading (tests/e2e/helpers/native_grid_guard.js)')
          .toBeUndefined();
      }
      const waiters = judgedWaiters.get(page) || [];
      for (const waiter of waiters.filter((w) => w.match(hit))) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(hit);
      }
    });
  }
  await page.addInitScript(pageGuard, { binding: BINDING });
}

module.exports = { installNativeGridGuard, allowedIssue, nativeGridJudged };
