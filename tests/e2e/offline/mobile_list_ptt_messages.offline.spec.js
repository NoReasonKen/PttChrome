// What PTT writes over the easy-reading article list never paints the native
// list (#206): a search that finds nothing (PTT answers with a vmsg the list
// dismisses and reports), a waterball and a broadcast (shown as a hint over
// the list). Every painted frame is sampled; the native grid guard judges the
// same run. The controlled PTT board is helpers/article_shortcut_search.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, waitArticle, tapCard } = require('../helpers/article_shortcut_search');
const { installPaintedFrameProbe } = require('../helpers/layout');
const { recordHints, recordedHints } = require('../helpers/stack_routes');

const BOARD = { has: ['Alpha topic', 'Beta topic'] };
const NOT_FOUND = '找不到符合條件的文章';

async function openList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true });
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, BOARD);
  await expect.poll(() => page.evaluate(() => window.__app.listSession.state)).toBe('active');
}

// The list is quiet: nothing on the wire and no server write waiting for its
// settle, so the next settle is PTT's message alone.
async function waitQuiet(page) {
  await expect.poll(() => page.evaluate(() => {
    const app = window.__app;
    return !app.listSession._queue.inFlightKind && app.buf._settleChangedRows.size === 0;
  })).toBe(true);
}

async function watchFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(() => {
    window.__frames = [];
    const visible = (el) => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const sample = () => {
      const content = document.getElementById('mainContainer');
      const text = visible(content) ? content.textContent || '' : '';
      window.__frames.push({
        cards: visible(content?.querySelector('.listBodyView')),
        native: text.includes('看板《Test》') || text.includes('按任意鍵繼續'),
        state: window.__app.listSession.state,
        render: window.__app.listSession._renderMode,
      });
    };
    window.__stopFrames = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  });
}

async function stopFrames(page) {
  await page.waitForFunction((n) => window.__frames.length >= n,
    await page.evaluate(() => window.__frames.length + 8));
  return page.evaluate(() => { window.__stopFrames(); return window.__frames; });
}

const shown = (frames) => frames.filter((f) => !f.cards || f.native || f.render === 'native');

// Text to Big5 bytes from the table the app loaded (as message_inbox does).
function big5(page, text) {
  return page.evaluate((s) => [...s].map((ch) => {
    const c = ch.charCodeAt(0);
    return c < 0x80 ? ch
      : String.fromCharCode(window.lib.u2bArray[2 * c]) + String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
  }).join(''), text);
}

test('a search that finds nothing stays on the list, every frame, and says so', async ({ page }) => {
  await openList(page);
  await page.locator('[data-key="__search"]').tap();
  const input = page.locator('input[name="searchKeyword"]');
  await input.fill('Nothing here');
  await watchFrames(page);
  await recordHints(page);
  const sent = await page.evaluate(() => window.__gestureSent.length);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect.poll(async () => (await recordedHints(page)).some((hint) => hint.includes(NOT_FOUND))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__app.listSession.state)).toBe('active');
  await expect.poll(() => page.evaluate(() => window.__app.searchInFlight)).toBe(false);
  const frames = await stopFrames(page);
  expect(shown(frames)).toEqual([]);
  // The vmsg was dismissed with one key, as PTT asks.
  const keys = await page.evaluate((n) => window.__gestureSent.slice(n), sent);
  expect(keys.filter((bytes) => bytes.replace(/\f/g, '') === ' ')).toHaveLength(1);
  expect(await page.evaluate(() => window.__shortcutServer.state.surface)).toBe('list');
  await waitList(page, BOARD);
});

const MESSAGES = [
  {
    name: 'a waterball',
    bytes: (b) => '\x1b[' + b.row + ';1H\x1b[1;33;46m★' + b.from + '\x1b[0;1;37;45m ' + b.msg + ' \x1b[m\x1b[K' + b.back,
    from: 'friend01',
    msg: '晚上吃飯嗎',
    hint: '★friend01 晚上吃飯嗎',
  },
  {
    name: 'a broadcast',
    bytes: (b) => '\x1b[' + b.row + ';1H\x1b[1;37;45m' + b.msg + '\x1b[m\x1b[K' + b.back,
    msg: '系統廣播：今晚維修',
    hint: '系統廣播：今晚維修',
  },
];

for (const message of MESSAGES) {
  test(`${message.name} over the list is a hint on the list, every frame, and the list keeps working`, async ({ page }) => {
    await openList(page);
    await waitQuiet(page);
    await watchFrames(page);
    await recordHints(page);
    const raw = message.bytes({
      // PTT's bottom row: the terminal's height follows the phone.
      row: await page.evaluate(() => window.__app.buf.rows),
      // PTT puts the cursor back where it was (outmsg).
      back: await page.evaluate(() => `\x1b[${window.__app.buf.cur_y + 1};${window.__app.buf.cur_x + 1}H`),
      from: message.from,
      msg: await big5(page, message.msg),
    });
    await page.evaluate((s) => window.__app.onData(s), raw);
    await expect.poll(() => recordedHints(page)).toContain(message.hint);
    const frames = await stopFrames(page);
    expect(shown(frames)).toEqual([]);
    expect(frames.filter((f) => f.state !== 'active')).toEqual([]);
    // The list still answers the reader.
    await tapCard(page, 'Alpha topic');
    await waitArticle(page, 'Alpha');
  });
}
