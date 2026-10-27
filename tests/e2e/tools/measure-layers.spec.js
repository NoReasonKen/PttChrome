// What live layers cost (#48): DOM nodes, JS heap and render time of each
// layer kind, and of a deep stack with every layer alive. Layers are built
// with today's mechanism (a full re-render of the page's last frame). Article
// layers do not exist yet (#49); they are simulated the same way, with the
// shared screen renderer over the article's frame.
//
// Not part of any suite: `yarn measure:layers` (MEASURE_LAYERS=1). Results are
// printed and merged into $MEASURE_OUT (default: layer-cost.json in the OS temp
// directory; Playwright clears test-results on every run). Desktop Chromium with
// the mobile project's emulation: node counts and heap match a phone closely,
// times are only comparable with each other.
const fs = require('fs');
const os = require('os');
const { test } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootOffline, replayCassette } = require('../helpers/replay');
const {
  bootArticleList, bootBoardList, bootDashboard, boardOpened, articleRead
} = require('../helpers/stack_routes');

test.skip(!process.env.MEASURE_LAYERS, 'only with yarn measure:layers (MEASURE_LAYERS=1)');
test.describe.configure({ mode: 'serial' });

const results = [];
test.afterAll(() => {
  const file = process.env.MEASURE_OUT || `${os.tmpdir()}/layer-cost.json`;
  // Merged by label, so a run of a few cases (-g) updates only those.
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const labels = new Set(results.map(r => r.label));
  fs.writeFileSync(file, JSON.stringify([...previous.filter(r => !labels.has(r.label)), ...results], null, 2));
  console.log(`\n[measure] layer cost in ${file} (nodes: layer subtree / CDP delta; heap: CDP delta after GC; pss: renderer process)`);
  for (const r of results) console.log('[measure]', JSON.stringify(r));
});

// The renderer processes' proportional set size (Linux): DOM and layout
// memory that the JS heap does not count.
async function rendererPssKB(browserCdp) {
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
  let kb = 0;
  for (const { id, type } of processInfo) {
    if (type !== 'renderer') continue;
    try {
      kb += Number(/^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${id}/smaps_rollup`, 'utf8'))[1]);
    } catch { /* gone, or not Linux */ }
  }
  return kb;
}

// Renderer metrics after a forced garbage collection.
async function snapshot(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map(x => [x.name, x.value]));
  return { nodes: m.Nodes, heap: m.JSHeapUsedSize, pssKB: await rendererPssKB(cdp.browserCdp) };
}

async function openCdp(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  cdp.browserCdp = await page.context().browser().newBrowserCDPSession();
  return cdp;
}

// In the page: helpers that build layers and keep them alive in
// window.__kept. Each returns { kind, renderMs, subtreeNodes, rows, images }.
async function installLayerKit(page) {
  await page.evaluate(async () => {
    const { renderScreen } = await import('/src/js/term_ui.js');
    const countNodes = root => {
      let n = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
      while (walker.nextNode()) n++;
      return n;
    };
    const describe = (kind, el, renderMs) => ({
      kind, renderMs: Math.round(renderMs * 10) / 10, subtreeNodes: countNodes(el),
      rows: el.querySelectorAll('.listCard').length || el.querySelectorAll('[data-row]').length,
      images: el.querySelectorAll('img, video').length
    });
    window.__kept = window.__kept || [];
    window.__frames = window.__frames || {};
    const stack = () => window.__app.articleGestures.stack;
    const timed = fn => {
      const t = performance.now();
      const layer = fn();
      return { layer, ms: performance.now() - t };
    };
    // A copy of the current frame, so a deep stack can be composed later.
    window.__saveFrame = name => {
      const view = window.__app.view;
      const rect = view.mainDisplay.getBoundingClientRect();
      window.__frames[name] = { props: view.componentScreen.props, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
    };
    // Today's list layer (article list, search results or board list).
    window.__keepListLayer = kind => {
      const { layer, ms } = timed(() => {
        if (kind === 'boardList') stack().captureBoardList('C_Chat');
        else stack().captureList();
        return stack().takePending();
      });
      if (!layer) throw new Error('no list layer captured');
      window.__kept.push(layer);
      return describe(kind, layer.el, ms);
    };
    window.__keepHomeLayer = () => {
      const { layer, ms } = timed(() => {
        stack().captureHome('C_Chat');
        return stack().takePending();
      });
      if (!layer) throw new Error('no home layer captured');
      window.__kept.push(layer);
      return describe('home', layer.el, ms);
    };
    // A simulated article layer: the same renderer over a saved or current
    // article frame, into its own box, as StackListLayer does for lists.
    window.__keepFrameLayer = (kind, name) => {
      const view = window.__app.view;
      const saved = name ? window.__frames[name] : null;
      const props = saved ? saved.props : view.componentScreen.props;
      const rect = saved ? saved.rect : view.mainDisplay.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = view.mainDisplay.className;
      Object.assign(el.style, {
        position: 'absolute', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px',
        height: rect.height + 'px', margin: '0', overflow: 'auto', zIndex: '2'
      });
      el.setAttribute('data-measure-layer', kind);
      const enhance = kind === 'articleList' || kind === 'boardList'
        ? Object.assign({}, props.enhance, { listScroll: Object.assign({}, props.enhance.listScroll, { scrollable: true }) })
        : props.enhance;
      const t = performance.now();
      renderScreen(props.lines, props.forceWidth, false, false, el, enhance);
      const ms = performance.now() - t;
      window.__kept.push({ el, parent: view.mainDisplay.parentNode, show() { this.parent.appendChild(el); }, hide() { el.remove(); } });
      return describe(kind, el, ms);
    };
    // Lay the newest kept layer out once, as a reveal does, then detach it.
    window.__revealLast = () => {
      const layer = window.__kept[window.__kept.length - 1];
      const t = performance.now();
      layer.show(false);
      void layer.el.getBoundingClientRect().height;
      void document.body.offsetHeight;
      const ms = performance.now() - t;
      layer.hide();
      return Math.round(ms * 10) / 10;
    };
    // The page the reader is on.
    window.__pageNodes = () => countNodes(document.body);
  });
}

// Keep one layer built by `build` (a page function name and args) and report
// its cost.
async function measure(page, cdp, label, build, ...args) {
  const before = await snapshot(cdp);
  const info = await page.evaluate(([fn, a]) => window[fn](...a), [build, args]);
  const after = await snapshot(cdp);
  const revealMs = await page.evaluate(() => window.__revealLast());
  const r = {
    label, ...info, revealMs, cdpNodes: after.nodes - before.nodes,
    heapKB: Math.round((after.heap - before.heap) / 1024), pssKB: after.pssKB - before.pssKB
  };
  results.push(r);
  return r;
}

async function measurePage(page, cdp, label) {
  const s = await snapshot(cdp);
  const r = {
    label, kind: 'page', pageNodes: await page.evaluate(() => window.__pageNodes()), cdpNodes: s.nodes,
    heapKB: Math.round(s.heap / 1024), pssKB: s.pssKB
  };
  results.push(r);
  return r;
}

async function bootArticle(page, name) {
  const cassette = loadCassette(name);
  // Mobile rows follow the viewport height (16px each): fit the recording's.
  await page.setViewportSize({ width: 412, height: cassette.rows * 16 + 6 });
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true, mergeSameAuthorComments: false });
  await replayCassette(page, cassette, { easyReading: true });
  await page.waitForFunction(() => window.__replay.done, null, { timeout: 60000 });
  // Image previews and the last render settle; nothing else is fed.
  await page.waitForTimeout(1500);
}

test('article list layer', async ({ page }) => {
  await bootArticleList(page);
  const cdp = await openCdp(page);
  await installLayerKit(page);
  await measurePage(page, cdp, 'article list page');
  await measure(page, cdp, 'article list layer', '__keepListLayer', 'articleList');
});

test('board list layer', async ({ page }) => {
  await bootBoardList(page);
  const cdp = await openCdp(page);
  await installLayerKit(page);
  await measurePage(page, cdp, 'board list page');
  await measure(page, cdp, 'board list layer', '__keepListLayer', 'boardList');
});

test('home dashboard layer', async ({ page }) => {
  await bootDashboard(page);
  const cdp = await openCdp(page);
  await installLayerKit(page);
  await measurePage(page, cdp, 'home dashboard page');
  await measure(page, cdp, 'home dashboard layer', '__keepHomeLayer');
});

for (const [name, label] of [
  ['test-xmen', 'short article (1 page)'],
  ['stock-huang', 'article with comments (5 pages)'],
  ['ezsoft-longpost', 'long article (150 pages)']
]) {
  test(`simulated article layer: ${label}`, async ({ page }) => {
    test.setTimeout(180000);
    await bootArticle(page, name);
    const cdp = await openCdp(page);
    await installLayerKit(page);
    await measurePage(page, cdp, `${label} page`);
    await measure(page, cdp, `${label} layer (simulated)`, '__keepFrameLayer', 'article');
  });
}

// A deep stack of the kind #49 allows: dashboard → board → article → search
// results → article → search results → article, every lower page alive.
// Results and later articles are copies of the board's list and the first
// article, which is what such layers cost structurally.
test('deep stack: dashboard, board, three articles, two search results', async ({ page }) => {
  test.setTimeout(180000);
  const cassette = loadCassette('scn-stack-home-article-back');
  await bootDashboard(page, cassette);
  const cdp = await openCdp(page);
  await installLayerKit(page);
  await measurePage(page, cdp, 'deep stack: dashboard page, no layers');
  await measure(page, cdp, 'deep stack: home layer', '__keepHomeLayer');
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
  await page.evaluate(() => window.__saveFrame('list'));
  await measure(page, cdp, 'deep stack: list layer', '__keepListLayer', 'articleList');
  for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
  await ptt.sendKey(page, 'Enter');
  await articleRead(page);
  await page.evaluate(() => window.__saveFrame('article'));
  await measure(page, cdp, 'deep stack: article layer (simulated)', '__keepFrameLayer', 'article');
  for (let level = 2; level <= 3; level++) {
    await measure(page, cdp, `deep stack: results ${level - 1} layer (copy of list)`, '__keepFrameLayer', 'articleList', 'list');
    if (level < 3) await measure(page, cdp, `deep stack: article ${level} layer (copy)`, '__keepFrameLayer', 'article', 'article');
  }
  await measurePage(page, cdp, 'deep stack: on article 3 with six layers alive');
  const layers = results.filter(r => r.label.startsWith('deep stack:') && r.kind !== 'page');
  results.push({
    label: 'deep stack: total added by six layers', kind: 'total', layers: layers.length,
    cdpNodes: layers.reduce((n, r) => n + r.cdpNodes, 0), heapKB: layers.reduce((n, r) => n + r.heapKB, 0),
    pssKB: layers.reduce((n, r) => n + r.pssKB, 0)
  });
});

// The same costs reach a debug recording, which is how they are measured on
// the device: each captured layer, and the simulated article layer when an
// article shortcut search starts.
test('a debug recording logs each layer cost', async ({ page }) => {
  const cassette = loadCassette('scn-stack-home-article-back');
  await bootDashboard(page, cassette);
  await page.evaluate(async () => {
    const { startDebugRecording } = await import('/src/js/debug_record_control.js');
    startDebugRecording(window.__app);
  });
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
  for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
  await ptt.sendKey(page, 'Enter');
  await articleRead(page);
  await page.evaluate(() => window.__app.articleGestures.stack.diagArticleLayerCost());
  await page.waitForTimeout(300);
  const logged = await page.evaluate(() =>
    window.__app.debugRecorder.events.filter(e => e.tag === 'stack.layerCost').map(e => e.info));
  for (const info of logged) results.push({ label: `recording: ${info.kind}`, ...info, kind: 'recording', layerKind: info.kind });
  const kinds = logged.map(info => info.kind);
  if (!kinds.includes('home') || !kinds.includes('articleList') || !kinds.includes('article (simulated)')) {
    throw new Error('missing layer costs: ' + JSON.stringify(kinds));
  }
});
