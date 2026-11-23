// PTT's `v` read-state question on the phone (#299): the More sheet's one
// 「已讀／未讀設定…」 entry (it replaced 「設為全部已讀」) opens the same choice
// sheet as `v`, whose answers run the serialized `v` -> prompt -> answer path
// and redraw the cards with the new read marks. Runs only in the offline-mobile
// project. The controlled PTT is helpers/article_shortcut_search.js (`readMarks`).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitList, waitIdle } = require('../helpers/article_shortcut_search');
const { recordHints, recordedHints } = require('../helpers/stack_routes');

const SHEET = '[data-sheet="markReadChoice"]';
const ALL = ['1gIeu-3A', '1gIeu-3B', '1gIeu-3C', '1gIeu-3D'];
const sent = (page) => page.evaluate(() => window.__gestureSent.map((s) => s.replace(/\f/g, '')).filter(Boolean));
const serverState = (page) => page.evaluate(() => {
  const s = window.__shortcutServer.state;
  return { answers: s.readAnswers.slice(), unread: [...s.unread].sort() };
});
const selected = (page) => page.evaluate(() => window.__app.listSession._selectedNum);
// The cards' own read marks (render/list_card.js → data-list-mark).
const unreadCards = (page) => page.locator('.listCard[data-list-mark="unread"]').count();
const listSettled = (page) => expect.poll(() => page.evaluate(() => {
  const app = window.__app;
  return app.listSession.state === 'active' && app.commandQueue.idle && !app.markAllReadInFlight;
})).toBe(true);

async function bootList(page) {
  await bootNestedShortcutSearch(page, { startAtMain: true, readMarks: true });
  await ptt.applyPrefs(page, { enableEasyReading: true, easyReadingListPrefetchCount: 0 });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await expect.poll(() => page.evaluate(() => window.__app.listSession.state)).toBe('active');
  // The list's own reads (the cursor to the end, the next page) finish first:
  // the keys counted afterwards are the sequence's alone.
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => window.__app.commandQueue.idle ? window.__gestureSent.length : -1);
    const quiet = n >= 0 && n === last;
    last = n;
    return quiet;
  }, { intervals: [400] }).toBe(true);
  await recordHints(page);
}

async function openSheet(page) {
  await page.locator('[data-key="__more"]').tap();
  await expect(page.locator('[data-key="__markAllRead"]')).toContainText(/已讀／未讀設定|Read \/ unread/);
  await page.locator('[data-key="__markAllRead"]').tap();
  await expect(page.locator(SHEET)).toBeVisible();
}
const pick = (page, answer) => page.locator(`${SHEET} [data-mark-read="${answer}"]`).tap();

test.describe('手機：已讀／未讀設定 (#299)', () => {
  test('More has one entry; it opens the sheet and sends nothing until a pick', async ({ page }) => {
    await bootList(page);
    await waitIdle(page);
    const before = (await sent(page)).length;
    await page.locator('[data-key="__more"]').tap();
    // 「設為全部已讀」 became this one entry: no second read-state entry.
    await expect(page.locator('[data-panel="more"] [data-key="__markAllRead"]')).toHaveCount(1);
    await page.locator('[data-key="__markAllRead"]').tap();
    await expect(page.locator(SHEET)).toBeVisible();
    for (const a of ['U', 'V', 'W', 'cancel']) await expect(page.locator(`${SHEET} [data-mark-read="${a}"]`)).toBeVisible();
    expect((await sent(page)).length).toBe(before);
    await page.locator(`${SHEET} [data-mark-read="cancel"]`).tap();
    await expect(page.locator(SHEET)).toHaveCount(0);
    expect((await sent(page)).length).toBe(before);
    expect((await serverState(page)).answers).toEqual([]);
  });

  test('V then U: each sends the prompt first, then its answer, and the cards follow', async ({ page }) => {
    await bootList(page);
    await waitIdle(page);
    const num = await selected(page);
    expect(await unreadCards(page)).toBeGreaterThan(0);
    await openSheet(page);
    await pick(page, 'V');
    await expect(page.locator(SHEET)).toHaveCount(0);
    await expect.poll(async () => (await serverState(page)).answers).toEqual(['v']);
    await listSettled(page);
    await expect.poll(() => unreadCards(page)).toBe(0);
    let all = await sent(page);
    expect(all.indexOf('v')).toBeLessThan(all.indexOf('v\r'));
    expect(all).not.toContain('vv\r');
    expect(await selected(page)).toBe(num);

    await openSheet(page);
    await pick(page, 'U');
    await expect.poll(async () => (await serverState(page)).answers).toEqual(['v', 'u']);
    await listSettled(page);
    expect((await serverState(page)).unread).toEqual(ALL);
    await expect.poll(() => unreadCards(page)).toBeGreaterThan(0);
    all = await sent(page);
    expect(all.lastIndexOf('v')).toBeLessThan(all.indexOf('u\r'));
    expect(all).not.toContain('vu\r');
    expect(await selected(page)).toBe(num);
    expect((await recordedHints(page)).some((h) => h.includes('未讀'))).toBe(true);
  });

  test('W: read up to the selected article, unread after', async ({ page }) => {
    await bootList(page);
    await waitIdle(page);
    // Select Beta (102): a tap on its card would open it, so move the
    // selection with the list's own key path (the list starts on 101).
    await page.evaluate(() => window.__app.view.sendKeyAsUser('ArrowDown'));
    await expect.poll(() => selected(page)).toBe(102);
    await openSheet(page);
    await pick(page, 'W');
    await expect.poll(async () => (await serverState(page)).answers).toEqual(['w']);
    await listSettled(page);
    const all = await sent(page);
    expect(all.lastIndexOf('102\r')).toBeLessThan(all.lastIndexOf('v'));
    expect(all.lastIndexOf('v')).toBeLessThan(all.indexOf('w\r'));
    expect((await serverState(page)).unread).toEqual(['1gIeu-3C', '1gIeu-3D']);
    expect(await selected(page)).toBe(102);
  });

  test('the entry is offered on the article list only', async ({ page }) => {
    await bootNestedShortcutSearch(page, { startAtMain: true, readMarks: true });
    await ptt.applyPrefs(page, { enableEasyReading: true });
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-panel="more"]')).toBeVisible();
    await expect(page.locator('[data-key="__markAllRead"]')).toHaveCount(0);
  });
});
