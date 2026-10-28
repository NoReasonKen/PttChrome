const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const ptt = require('../helpers/ptt');
const {
  bootNestedShortcutSearch, waitList, waitArticle, tapCard, tapShortcut
} = require('../helpers/article_shortcut_search');
const { MAIN } = require('../helpers/stack_routes');
const { waitRectStable } = require('../helpers/layout');

const PORTRAIT = { width: 412, height: 896 };
const LANDSCAPE = { width: 896, height: 412 };
const LIST = `${MAIN} .listBodyView`;

// The controlled server negotiates rows independently from the stored screen.
// NAWS redraws that old screen; only a verified CompleteBoard cancellation
// rebuilds read.c's list at the new height. App state and rendering remain real.
async function openList(page, options = {}) {
  // The shared boot uses a fixed 24-row article. Install the dynamic server
  // before increasing the viewport and exercising real NAWS responses.
  await bootNestedShortcutSearch(page, { easyList: true, dynamicRows: true, ...options });
  await ptt.applyPrefs(page, { easyReadingListPrefetchCount: 200 });
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, { has: ['Alpha topic'] });
  await stableList(page);
  await rotate(page, PORTRAIT);
}

async function stableList(page) {
  await page.waitForFunction(() => {
    const app = window.__app;
    return app.buf.pageState === 2 && app.listSession.state === 'active' &&
      app.listSession._renderMode === 'buffer' && app.commandQueue.idle &&
      !app.buf._settleTimer && !app.listResize.active && !app.listResize.pending &&
      !app.articleGestures.stack.handingOff && !app.articleGestures.entry;
  });
  await expect(page.locator(LIST)).toBeVisible();
}

const position = page => page.evaluate(() => window.__app.listSession.readingPosition());

const cardAtTop = page => page.locator(LIST).evaluate(view => {
  const top = view.getBoundingClientRect().top;
  const card = [...view.querySelectorAll('.listCard')].find(node => node.getBoundingClientRect().bottom > top + 1);
  return card && {
    title: card.dataset.listTitle,
    offset: card.getBoundingClientRect().top - top
  };
});

async function rotate(page, bounds) {
  const before = await page.evaluate(() => ({
    rows: window.__app.buf.rows, sizes: window.__shortcutServer.state.sizeChanges.length
  }));
  await page.setViewportSize(bounds);
  await expect.poll(() => page.evaluate(() => window.__shortcutServer.state.sizeChanges.length)).toBeGreaterThan(before.sizes);
  await stableList(page);
  expect(await page.evaluate(() => window.__app.buf.rows)).not.toBe(before.rows);
  expect(await page.evaluate(() => window.__app.listSession._boardName)).toBe('Test');
}

async function preservePosition(page, before) {
  await expect.poll(async () => (await position(page)).topNum).toBe(before.topNum);
  await expect.poll(async () => Math.abs((await position(page)).scrollFrac - before.scrollFrac)).toBeLessThan(1);
  expect((await position(page)).cursorNum).toBe(before.cursorNum);
}

async function search(page, key, value) {
  await ptt.sendKey(page, key);
  const input = page.locator('input[name="searchKeyword"]');
  await input.fill(value);
  await input.press('Enter');
  await stableList(page);
}

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const state = await page.evaluate(() => {
    const app = window.__app;
    const server = window.__shortcutServer?.state;
    return {
      page: app?.buf.pageState, rows: app?.buf.rows, state: app?.listSession.state,
      render: app?.listSession._renderMode, position: app?.listSession.readingPosition(),
      command: app?.commandQueue.inFlightKind,
      resize: { active: app?.listResize.active, pending: app?.listResize.pending, phase: app?.listResize.command?.phase },
      server: server && { surface: server.surface, rows: server.terminalRows, applicationRows: server.applicationRows, cursor: server.cursor, filtered: !!server.filter, sizes: server.sizeChanges },
      sent: window.__gestureSent?.slice(-30), stack: app?.articleGestures.stack.stack,
      route: app?.articleShortcutSearch.route
    };
  }).catch(() => null);
  await writeFile(info.outputPath('list-rotation-state.json'), JSON.stringify(state, null, 2));
  await info.attach('list-rotation-state', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
});

test('both orientations preserve a long list viewport and local selection independently of the server cursor', async ({ page }, info) => {
  await openList(page, { extraArticles: 40 });
  await ptt.sendKey(page, 'End');
  await stableList(page);
  await expect.poll(() => page.evaluate(() => window.__app.buf.listLines.length)).toBe(44);
  await page.locator(LIST).hover();
  await page.mouse.wheel(0, -3000);
  await expect.poll(async () => (await position(page)).topNum).toBe(101);
  await page.mouse.wheel(0, 530);
  await expect.poll(async () => (await position(page)).topNum).toBeGreaterThan(101);
  await expect.poll(async () => (await position(page)).topNum).toBeLessThan(130);
  await waitRectStable(page, LIST);
  await stableList(page);
  const before = await position(page);
  const card = await cardAtTop(page);
  expect(await page.evaluate(() => window.__app.listSession._serverNum)).not.toBe(before.cursorNum);
  await rotate(page, LANDSCAPE);
  await preservePosition(page, before);
  expect((await cardAtTop(page)).title).toBe(card.title);
  expect(Math.abs((await cardAtTop(page)).offset - card.offset)).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('landscape-list.png') });
  await rotate(page, PORTRAIT);
  await preservePosition(page, before);
  await page.screenshot({ path: info.outputPath('portrait-list.png') });
});

test('ordinary title and author filters survive rotation without resubmitting the query', async ({ page }) => {
  await openList(page);
  await search(page, '/', 'Beta');
  await search(page, 'a', 'bob');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic', 'alice'] });
  const before = await position(page);
  const sent = await page.evaluate(() => window.__gestureSent.length);
  await rotate(page, LANDSCAPE);
  await preservePosition(page, before);
  expect((await position(page)).mode).toBe('select');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic', 'alice'] });
  const commands = await page.evaluate(n => window.__gestureSent.slice(n).filter(bytes => !bytes.includes('\xff\xfa\x1f')), sent);
  expect(commands).toEqual(['s\f', '\x03\f']);
  // Back still exits the same filtered list, rather than another board visit.
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
});

test('shortcut results retain their search return history and source layer through rotation', async ({ page }) => {
  await openList(page);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await stableList(page);
  const route = await page.evaluate(() => JSON.stringify(window.__app.articleShortcutSearch.route));
  const stack = await page.evaluate(() => window.__app.articleGestures.stack.stack.pages);
  expect(stack.some(entry => entry.kind === 'article' && entry.layer)).toBe(true);
  await rotate(page, LANDSCAPE);
  expect(await page.evaluate(() => JSON.stringify(window.__app.articleShortcutSearch.route))).toBe(route);
  expect(await page.evaluate(() => window.__app.articleGestures.stack.stack.pages)).toEqual(stack);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitArticle(page, 'Alpha');
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0);
});

test('short lists retain a pinned selection without needing a numeric jump', async ({ page }) => {
  await openList(page, { pinned: true });
  await ptt.sendKey(page, 'End');
  await stableList(page);
  await expect.poll(() => page.evaluate(() => window.__app.listSession._selectedPinnedKey)).toBeTruthy();
  const selected = await page.evaluate(() => window.__app.listSession._selectedPinnedKey);
  const sent = await page.evaluate(() => window.__gestureSent.length);
  await rotate(page, LANDSCAPE);
  expect(await page.evaluate(() => window.__app.listSession._selectedPinnedKey)).toBe(selected);
  await expect(page.locator(`${MAIN} .listCard`, { hasText: 'Pinned rules' })).toBeVisible();
  const commands = await page.evaluate(n => window.__gestureSent.slice(n).filter(bytes => !bytes.includes('\xff\xfa\x1f')), sent);
  expect(commands).toEqual(['s\f', '\x03\f']);
  await rotate(page, PORTRAIT);
  expect(await page.evaluate(() => window.__app.listSession._selectedPinnedKey)).toBe(selected);
});

test('rotation waits for an in-flight prefetch and coalesces repeated viewport changes', async ({ page }) => {
  await openList(page, { extraArticles: 40 });
  await page.evaluate(() => { window.__shortcutServer.state.holdResponses = true; });
  await page.locator(LIST).hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.inFlightKind)).toMatch(/^prefetch/);
  const rows = await page.evaluate(() => window.__app.buf.rows);
  const sizes = await page.evaluate(() => window.__shortcutServer.state.sizeChanges.length);
  await page.setViewportSize(LANDSCAPE);
  // Resize is debounced for 500ms; the background command's ordinary probe
  // expires at 850ms. Observe that bounded waiting state before releasing it.
  await expect.poll(() => page.evaluate(() => ({
    pending: !!window.__app.listResize.pending,
    rows: window.__app.buf.rows,
    active: window.__app.listResize.active,
    list: window.__app.listSession.state,
    render: window.__app.listSession._renderMode,
    command: window.__app.commandQueue.inFlightKind,
  })), { intervals: [20], timeout: 1000 }).toMatchObject({ pending: true });
  expect(await page.evaluate(() => window.__app.listResize.active)).toBe(false);
  expect(await page.evaluate(() => window.__app.buf.rows)).toBe(rows);
  await page.setViewportSize(PORTRAIT);
  await page.setViewportSize(LANDSCAPE);
  await expect.poll(() => page.evaluate(() => !!window.__app.listResize.pending)).toBe(true);
  expect(await page.evaluate(() => window.__shortcutServer.state.sizeChanges.length)).toBe(sizes);
  await page.evaluate(() => window.__shortcutServer.releaseResponses());
  await stableList(page);
  expect(await page.evaluate(() => window.__app.buf.rows)).toBeLessThan(rows);
  expect(await page.evaluate(() => window.__shortcutServer.state.sizeChanges.length)).toBe(sizes + 1);
  expect((await position(page)).board).toBe('Test');
});

test('rotation during Back waits for the revealed list handoff before redrawing its terminal', async ({ page }) => {
  await openList(page);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await page.waitForFunction(() => !window.__app.articleGestures.entry);
  const rows = await page.evaluate(() => window.__app.buf.rows);
  await page.evaluate(() => { window.__shortcutServer.state.holdResponses = true; });
  await ptt.sendKey(page, 'ArrowLeft');
  await expect(page.locator('[data-stack-layer="articleList"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__app.articleGestures.stack.handingOff)).toBe(true);
  await page.setViewportSize(LANDSCAPE);
  await expect.poll(() => page.evaluate(() => !!window.__app.listResize.pending)).toBe(true);
  expect(await page.evaluate(() => window.__app.buf.rows)).toBe(rows);
  await page.evaluate(() => window.__shortcutServer.releaseResponses());
  await stableList(page);
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  expect(await page.evaluate(() => window.__app.listSession._boardName)).toBe('Test');
  expect(await page.evaluate(() => window.__app.buf.rows)).toBeLessThan(rows);
});
