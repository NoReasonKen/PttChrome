// A key that acts on the row under PTT's cursor, sent from the easy-reading
// article list while a background read of more pages is still on the wire.
// The read moves PTT's cursor (a number jump to the buffer's edge, a page
// key) after the list last learned where it was, so the key must not trust
// that PTT's cursor is still on the selected article: PTT's cursor is moved
// back to the selection first, behind the read. Here the key is Back: PTT
// keeps the board's position from its cursor (getkeep) and the next entry
// lands there. Querying an author (#254), marking read and tagging go
// through the same check.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList } = require('../helpers/article_shortcut_search');

test('Back while a background read is on the wire leaves PTT on the selected article', async ({ page }) => {
  await bootNestedShortcutSearch(page, { startAtMain: true, extraArticles: 60 });
  // Background reads stay on (the default prefetch count).
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    // The article PTT's cursor is on when Back reaches it (articles number from 101).
    window.__cursorAtBack = null;
    const answer = window.__stubWSSent;
    window.__stubWSSent = (bytes) => {
      if (bytes.includes('\x1b[D') && server.state.surface === 'list' && window.__cursorAtBack == null)
        window.__cursorAtBack = 101 + server.state.cursor;
      answer(bytes);
    };
    // The list shows at once, and every answer after it is held, so the
    // first background read stays on the wire.
    server.state.holdResponses = true;
    server.state.surface = 'list';
    server.state.cursor = 63; // the newest of 64 articles
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Extra topic 60'] });
  // The list learned PTT's cursor from the page it showed: the selection.
  await expect.poll(() => page.evaluate(() => {
    const s = window.__app.listSession;
    return s.state === 'active' && s._selectedNum === 164 && s._serverNum === 164 &&
      /^prefetch/.test(window.__app.commandQueue.inFlightKind || '');
  })).toBe(true);
  // The read already moved PTT's cursor; its answer has not come back.
  expect(await page.evaluate(() => window.__shortcutServer.state.cursor)).not.toBe(63);

  await ptt.sendKey(page, 'ArrowLeft');
  await page.evaluate(() => window.__shortcutServer.releaseResponses());
  await expect.poll(() => page.evaluate(() => window.__shortcutServer.state.surface)).toBe('main');
  expect(await page.evaluate(() => window.__cursorAtBack)).toBe(164);
});
