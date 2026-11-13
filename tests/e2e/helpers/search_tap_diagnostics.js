// Bounded observations for rare search-result taps, without layout sampling.
const fs = require('node:fs/promises');
async function recordSearchTaps(page, boot) {
  // Observe capture events before application handlers can consume them.
  await page.addInitScript(() => {
    const events = [];
    const append = (kind, event, info) => {
      const app = window.__app;
      if (!app) return;
      const target = event?.target;
      events.push({
        kind, at: Math.round(performance.now()), trusted: event?.isTrusted,
        x: event?.clientX, y: event?.clientY,
        target: typeof target?.className === 'string' ? target.className : target?.nodeName,
        connected: target?.isConnected,
        author: target?.closest?.('[data-list-author]')?.dataset.listAuthor,
        layer: !!target?.closest?.('[data-stack-layer], .stackUnderlay'),
        selectionCollapsed: window.getSelection().isCollapsed,
        modal: app.modalShown, contextMenu: app.contextMenuShown,
        page: app.buf.pageState, list: app.listSession.state,
        renderMode: app.listSession._renderMode,
        queue: app.commandQueue.inFlightKind,
        entry: app.articleGestures.entry?.state, info
      });
      if (events.length > 128) events.shift();
    };
    const types = ['pointerdown', 'pointerup', 'pointercancel', 'click'];
    const onInput = event => append(event.type, event);
    for (const type of types) window.addEventListener(type, onInput, true);
    window.__searchTapDiagnostics = {
      events, append,
      release() {
        for (const type of types) window.removeEventListener(type, onInput, true);
      }
    };
  });
  await boot();
  await page.evaluate(() => {
    const app = window.__app;
    const diagnostic = window.__searchTapDiagnostics;
    const { append, release } = diagnostic;
    const trace = app._traceListTap;
    app._traceListTap = function (outcome, event) {
      append('listTap', event, { outcome });
      return trace.call(this, outcome, event);
    };
    const onClick = app.listSession.onMouseClick;
    app.listSession.onMouseClick = function (row, col) {
      append('listClick', null, { row, col });
      return onClick.call(this, row, col);
    };
    diagnostic.release = () => {
      release();
      app._traceListTap = trace;
      app.listSession.onMouseClick = onClick;
    };
  });
}

async function attachSearchTapFailure(page, info) {
  const evidence = await page.evaluate(() => {
    const diagnostic = window.__searchTapDiagnostics;
    if (!diagnostic) return null;
    diagnostic.release();
    delete window.__searchTapDiagnostics;
    const app = window.__app;
    return {
      events: diagnostic.events, sent: window.__gestureSent,
      final: {
        page: app.buf.pageState, list: app.listSession.state,
        renderMode: app.listSession._renderMode, modal: app.modalShown,
        surface: window.__shortcutServer.state.surface,
        article: window.__shortcutServer.state.open?.body,
        text: document.querySelector('.main:not([data-stack-layer]) #mainContainer')?.textContent.slice(0, 1200)
      }
    };
  }).catch(() => null);
  if (evidence && info.status !== info.expectedStatus) {
    // CI uploads test-results with the line reporter, which does not persist
    // inline attachment bodies. Keep the JSON there as an actual file.
    const file = info.outputPath('search-result-tap-events.json');
    await fs.writeFile(file, JSON.stringify(evidence, null, 2));
    await info.attach('search-result-tap-events', {
      path: file, contentType: 'application/json'
    });
  }
}

module.exports = { recordSearchTaps, attachSearchTapFailure };
