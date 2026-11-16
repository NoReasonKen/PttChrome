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
// The console carries only a hit's index in the page's log: the app's debug
// log and the privacy specs read the console, and a hit carries screen text.
// The test reads the hit itself from the page. (A page binding instead keeps
// a closed mobile sheet from returning focus to the terminal.)

const fs = require('fs');

const TAG = '[native-grid] ';

function pageGuard({ tag, log, diagnostics }) {
  if (window.__nativeGridGuard) return;
  const seen = new Set();
  // hits: since the last reset(), which forgets them for a spec that checks the
  // guard itself. log: every hit, never reset, indexed by the console line.
  const state = { loggedIn: false, hits: [], log: [], reset: () => { state.hits.length = 0; seen.clear(); } };
  window.__nativeGridGuard = state;
  const timeline = [];
  let previousEntry;
  const record = (event, details = {}) => {
    if (!diagnostics) return;
    const identity = JSON.stringify({ event, ...details });
    if (identity === previousEntry) return;
    previousEntry = identity;
    timeline.push({ t: performance.now(), event, ...details });
    if (timeline.length > 80) timeline.shift();
  };
  if (diagnostics) {
    document.addEventListener('keydown', (event) => {
      if (event.isTrusted && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key))
        record('key', { key: event.key });
    }, true);
    document.addEventListener('pointerdown', (event) => {
      if (event.isTrusted) record('pointer', { target: describe(event.target) });
    }, true);
  }

  function describe(el) {
    if (!(el instanceof Element)) return null;
    return { tag: el.tagName, id: el.id || null, classes: [...el.classList].slice(0, 8) };
  }

  function geometry(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { element: describe(el), rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      visible: el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) };
  }

  function snapshot(app, view, overrides) {
    const main = document.querySelector('.main:not([data-stack-layer])');
    const rect = main?.getBoundingClientRect();
    const bar = document.getElementById('mobileAppBar');
    const toolbar = document.querySelector('.mobileToolbarBar');
    const left = rect && Math.max(0, rect.left), right = rect && Math.min(innerWidth, rect.right);
    const top = rect && Math.max(0, rect.top, bar ? bar.getBoundingClientRect().bottom : 0);
    const bottom = rect && Math.min(innerHeight, rect.bottom, toolbar ? toolbar.getBoundingClientRect().top : innerHeight);
    const targets = rect && right > left && bottom > top
      ? [0.25, 0.5, 0.75].map(f => describe(document.elementFromPoint((left + right) / 2, top + (bottom - top) * f))) : [];
    const nav = app.navigationStack;
    return {
      pageState: app.buf.pageState, surface: view._frameSurface(overrides),
      listRenderMode: app.buf.listRenderMode, grid: !!view._gridRender,
      listScroll: !!overrides?.listScroll, functionMode: !!app.buf.easyReadingFunctionMode,
      listState: app.listSession?.state ?? null, boardListState: app.boardListSession?.state ?? null,
      queue: { idle: app.commandQueue?.idle ?? null, inFlightKind: app.commandQueue?.inFlightKind ?? null },
      stack: { pages: nav?.stack?.pages?.map(p => p.kind) || [], pending: nav?.pending?.kind ?? null,
        handoff: !!nav?.handoff, captured: nav?.captured?.filter(Boolean).length ?? 0 },
      homeVisible: app.homeDashboard?.state?.visible ?? null, modalShown: !!app.modalShown,
      main: geometry(main), content: geometry(main?.querySelector('#mainContainer')),
      covers: [...document.querySelectorAll('#homeDashboard, [data-stack-layer]')].map(geometry), targets,
    };
  }

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
    // The reader's own key that opened easy reading's native mirror over an
    // article (help or reply), until the mirror ends: a hit's `nativeKey`.
    const er = app.easyReading;
    if (er && er.enterNativeRoute) {
      const enterNativeRoute = er.enterNativeRoute;
      er.enterNativeRoute = function(ch) {
        if (!app.buf.easyReadingFunctionMode) state.nativeKey = ch;
        return enterNativeRoute.apply(this, arguments);
      };
    }
    const render = view._renderScreenLines;
    view._renderScreenLines = function(lines, dropHidden, inlinePreview, hoverPreview, overrides) {
      if (!app.buf.easyReadingFunctionMode) state.nativeKey = null;
      const result = render.apply(this, arguments);
      try {
        const buf = app.buf;
        if (buf.getRowText(0, 0, buf.cols).includes('主功能表')) state.loggedIn = true;
        else if (state.loggedIn && loginPrompt(buf)) state.loggedIn = false;
        latest = overrides;
        onGrid = this._gridRender && !(overrides && overrides.listScroll);
        if (diagnostics) record('render', snapshot(app, view, overrides));
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
      if (diagnostics) record('paint', snapshot(app, view, overrides));
      const prefs = window.__readPrefs ? window.__readPrefs() : null;
      // Done (true) unless the frame is covered: a pref change or login redraws.
      if (!state.loggedIn || !prefs || !prefs.enableEasyReading) return true;
      if (!shown()) return false;
      report({
        surface: view._frameSurface(overrides),
        pageState: buf.pageState,
        functionMode: !!buf.easyReadingFunctionMode,
        nativeKey: (buf.easyReadingFunctionMode && state.nativeKey) || null,
        listRenderMode: buf.listRenderMode,
        title: buf.getRowText(0, 0, buf.cols).trim().replace(/\s+/g, ' ').slice(0, 40),
        // Context for classifying a hit: a reconnect resume in flight, the
        // list owner's state.
        resume: (app.reconnectResume && app.reconnectResume.diagnostics().pendingKind) || null,
        listState: app.listSession ? app.listSession.state : null,
        // Whether a main menu offers My Favorites: only such a menu is the
        // home screen the dashboard covers (home_dashboard.isHomeScreen).
        favorites: hasFavoritesItem(buf),
        ...(diagnostics ? { diagnostics: { timeline: [...timeline] } } : {}),
      });
      return true;
    }
  }

  function hasFavoritesItem(buf) {
    for (let row = 1; row < buf.rows - 1; row++) {
      if (buf.getRowText(row, 0, buf.cols).includes('(F)avorite')) return true;
    }
    return false;
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
    const identity = { ...hit };
    delete identity.diagnostics;
    const key = JSON.stringify(identity);
    if (seen.has(key)) return;
    seen.add(key);
    state.hits.push(hit);
    state.log.push(hit);
    if (log) console.debug(tag + (state.log.length - 1));
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
  // Easy-reading gaps (#161): main-menu areas shown natively on every visit
  // (mobile_easy_reading_gaps.offline.spec.js). The areas easy reading does
  // not present have no entrance and no entry (#231, docs/easy-reading.md).
  // The mailbox is shown by easy reading (#196) and has no entry either.
  ...[
    [199, '休閒聊天區'],
  ].map(([issue, title]) => ({ issue, why: `easy-reading gap: ${title}`, match: (hit) => hit.title.includes(title) })),
  // A reply key over an article opens PTT's reply flow natively. A help key
  // opens the help sheet (#222), and PttChrome's own operations hold the
  // article (#209): neither is allowed.
  { issue: 208, why: 'native reply flow under an open article',
    match: (hit) => hit.functionMode && !!hit.nativeKey && !'hH?'.includes(hit.nativeKey) },
  // A fixture's frame, not real PTT: no issue removes it. The dashboard covers
  // only a main menu that offers My Favorites (home_dashboard.isHomeScreen,
  // #187) and leaves any other native by design. Real PTT shows the item to
  // every member; the bare main menu of the nested-search fixture
  // (helpers/article_shortcut_search.js without `homeMenu`) does not.
  { issue: 'fixture', why: 'a fixture main menu without My Favorites is no home screen and stays native',
    match: (hit) => hit.title.includes('主功能表') && hit.favorites === false },
];

function allowedIssue(hit, where) {
  const entry = ALLOWED.find((a) => a.match(hit, where));
  return entry ? entry.issue : null;
}

// Judged hits per page, for a spec that waits until the guard has judged one.
const judgedWaiters = new WeakMap();

// Resolves once the guard has judged (and in fail mode, failed on) a hit that
// matches; the page record alone runs ahead of the console line.
function nativeGridJudged(page, match) {
  return new Promise((resolve) => {
    if (!judgedWaiters.has(page)) judgedWaiters.set(page, []);
    judgedWaiters.get(page).push({ match, resolve });
  });
}

const guardedPages = new WeakSet();
const diagnosticWrites = new WeakMap();

async function flushNativeGridDiagnostics(page) {
  await page.evaluate(() => true).catch(() => {});
  await diagnosticWrites.get(page);
}

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
  let pending = Promise.resolve();
  let saved = false;
  if (mode === 'fail' || mode === 'report') {
    page.on('console', (msg) => {
      const text = msg.text();
      if (!text.startsWith(TAG)) return;
      const judge = async () => {
        let info;
        try {
          info = test.info();
        } catch {
          return; // after the test ended
        }
        const index = Number(text.slice(TAG.length));
        const hit = await page.evaluate((i) => window.__nativeGridGuard.log[i], index).catch(() => null);
        if (!hit) return; // the page closed or navigated away
        const where = { spec: info.file.replace(/^.*\/tests\/e2e\//, ''), test: info.title };
        const issue = hit.guardError ? null : allowedIssue(hit, where);
        if (mode === 'report') {
          fs.appendFileSync(out, JSON.stringify({ ...where, allowed: issue, hit }) + '\n');
        } else if (issue == null) {
          try {
            const assertionHit = { ...hit };
            delete assertionHit.diagnostics;
            expect
              .soft(assertionHit, 'native grid painted under easy reading (tests/e2e/helpers/native_grid_guard.js)')
              .toBeUndefined();
          } catch {
            // the test ended while the hit was read
          }
          if (opts.diagnostics && !saved) {
            saved = true;
            const artifact = info.outputPath('native-grid-diagnostics.json');
            fs.writeFileSync(artifact, JSON.stringify(hit, null, 2));
            await info.attach('native-grid-diagnostics', { path: artifact, contentType: 'application/json' });
          }
        }
        const waiters = judgedWaiters.get(page) || [];
        for (const waiter of waiters.filter((w) => w.match(hit))) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(hit);
        }
      };
      if (opts.diagnostics) {
        pending = pending.then(judge);
        diagnosticWrites.set(page, pending);
      } else {
        void judge();
      }
    });
  }
  await page.addInitScript(pageGuard, { tag: TAG, log: mode === 'fail' || mode === 'report', diagnostics: !!opts.diagnostics });
}

module.exports = { installNativeGridGuard, allowedIssue, nativeGridJudged, flushNativeGridDiagnostics };
