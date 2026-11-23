// PTT's `v` question on the easy-reading article list, answered in the app's
// choice sheet (#299): `v` opens it; U (all unread), V (all read) and W (read
// up to the selected article) each run the serialized `v` -> prompt -> answer
// path; cancelling sends nothing. The right-click 「設為全部已讀」 stays a direct
// entrance. The phone's entrance is in mobile_read_state_choice.offline.spec.js.
//
// The list is the controlled PTT of helpers/article_shortcut_search.js
// (`readMarks`): it asks bbs.c#b_mark_read_unread's prompt on `v` and applies
// the answer line to its articles' read marks.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList } = require('../helpers/article_shortcut_search');
const { recordHints, recordedHints } = require('../helpers/stack_routes');
const { rightClickElement } = require('../helpers/real_input');

const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const dialog = (page) => page.getByRole('dialog');
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__gestureSent.length; });
const sentSinceMark = (page) => page.evaluate(() =>
  window.__gestureSent.slice(window.__sentMark).map((s) => s.replace(/\f/g, '')).filter(Boolean));
const selectedNum = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
const serverState = (page) => page.evaluate(() => {
  const s = window.__shortcutServer.state;
  return { surface: s.surface, answers: s.readAnswers.slice(), unread: [...s.unread].sort() };
});
const settled = (page) => expect.poll(() => page.evaluate(() => {
  const app = window.__app;
  return app.listSession.state === 'active' && app.commandQueue.idle && !app.markAllReadInFlight &&
    app.buf.listRenderMode === 'buffer';
})).toBe(true);
const menuItem = (page, label) =>
  page.locator('.DropdownMenu').first().getByRole('menuitem').filter({ hasText: label });
const ALL = ['1gIeu-3A', '1gIeu-3B', '1gIeu-3C', '1gIeu-3D'];

async function openList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true, readMarks: true });
  await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await settled(page);
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => window.__app.commandQueue.idle ? window.__gestureSent.length : -1);
    const quiet = n >= 0 && n === last;
    last = n;
    return quiet;
  }, { intervals: [400] }).toBe(true);
  await recordHints(page);
  expect((await serverState(page)).unread).toEqual(ALL);
}

const strip = (d) => d.replace(/\f/g, '');

test.describe('read-state choice on the desktop article list', () => {
  test('v opens the sheet with the three answers and sends nothing until one is picked', async ({ page }) => {
    await openList(page);
    await markSent(page);
    await page.keyboard.press('v');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(await text(page, 'markReadChoice_title'));
    for (const a of ['U', 'V', 'W', 'cancel']) await expect(dialog(page).locator(`[data-mark-read="${a}"]`)).toBeVisible();
    expect(await sentSinceMark(page)).toEqual([]);
    // Cancel (and Escape) send nothing and the list keeps working.
    await dialog(page).locator('[data-mark-read="cancel"]').click();
    await expect(dialog(page)).toHaveCount(0);
    await page.keyboard.press('v');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await sentSinceMark(page)).toEqual([]);
    expect((await serverState(page)).answers).toEqual([]);
    const before = await selectedNum(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(before + 1);
  });

  test('V: the prompt opens first, then v+Enter; every article ends read, selection unchanged', async ({ page }) => {
    await openList(page);
    const num = await selectedNum(page);
    await markSent(page);
    await page.keyboard.press('v');
    await dialog(page).locator('[data-mark-read="V"]').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(async () => (await serverState(page)).answers).toEqual(['v']);
    await settled(page);
    const sent = (await sentSinceMark(page));
    expect(sent.indexOf('v')).toBeGreaterThanOrEqual(0);
    expect(sent.indexOf('v')).toBeLessThan(sent.indexOf('v\r'));
    expect(sent).not.toContain('vv\r');
    const s = await serverState(page);
    expect(s.unread).toEqual([]);
    expect(s.surface).toBe('list');
    expect(await selectedNum(page)).toBe(num);
    expect((await recordedHints(page)).some((h) => h.includes('已讀'))).toBe(true);
  });

  test('U: the prompt opens first, then u+Enter; every article ends unread', async ({ page }) => {
    await openList(page);
    // Read everything first, so U has something to undo.
    await page.keyboard.press('v');
    await dialog(page).locator('[data-mark-read="V"]').click();
    await expect.poll(async () => (await serverState(page)).unread).toEqual([]);
    await settled(page);
    await markSent(page);
    await page.keyboard.press('v');
    await dialog(page).locator('[data-mark-read="U"]').click();
    await expect.poll(async () => (await serverState(page)).answers).toEqual(['v', 'u']);
    await settled(page);
    const sent = await sentSinceMark(page);
    expect(sent.indexOf('v')).toBeLessThan(sent.indexOf('u\r'));
    expect(sent).not.toContain('vu\r');
    expect((await serverState(page)).unread).toEqual(ALL);
    expect((await recordedHints(page)).some((h) => h.includes('未讀'))).toBe(true);
  });

  test('W: the cursor article and everything above it end read, the rest unread', async ({ page }) => {
    await openList(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedNum(page)).toBe(102);
    await markSent(page);
    await page.keyboard.press('v');
    await dialog(page).locator('[data-mark-read="W"]').click();
    await expect.poll(async () => (await serverState(page)).answers).toEqual(['w']);
    await settled(page);
    const sent = await sentSinceMark(page);
    // PTT's cursor goes to the article first; the answer follows the prompt.
    expect(sent.indexOf('102\r')).toBeLessThan(sent.indexOf('v'));
    expect(sent.indexOf('v')).toBeLessThan(sent.indexOf('w\r'));
    expect(sent).not.toContain('vw\r');
    expect((await serverState(page)).unread).toEqual(['1gIeu-3C', '1gIeu-3D']);
    expect(await selectedNum(page)).toBe(102);
  });

  test('right-click 設為全部已讀 stays a direct entrance: no sheet, same two steps', async ({ page }) => {
    await openList(page);
    await rightClickElement(page, 'span[type="bbsrow"][data-list-title*="Delta topic"]');
    const item = menuItem(page, await text(page, 'cmenu_markAllRead'));
    await expect(item).toBeVisible();
    await item.click();
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(async () => (await serverState(page)).answers).toEqual(['v']);
    expect((await serverState(page)).unread).toEqual([]);
    await settled(page);
  });

  test('v while a transaction is in flight sends nothing and says so', async ({ page }) => {
    await openList(page);
    // PTT's reply is held, so the open is still in flight when `v` is pressed.
    await page.evaluate(() => { window.__shortcutServer.state.holdResponses = true; });
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__app.listSession.state)).not.toBe('active');
    await markSent(page);
    await page.keyboard.press('v');
    await expect(dialog(page)).toHaveCount(0);
    expect((await sentSinceMark(page)).map(strip)).not.toContain('v');
    await page.evaluate(() => window.__shortcutServer.releaseResponses());
  });
});
