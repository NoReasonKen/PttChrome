// The toolbar's key panel (#mobileKeypad) shortens the reading view instead of
// moving it (#256): opening or closing it leaves every card where it was, the
// view runs from the App Bar down to the panel, every row can be scrolled into
// that view, and a selection the panel would cover is scrolled just far enough
// to show above it. The article page already behaves this way
// (mobile_toolbar.offline.spec.js); this spec holds every list kind and the
// online user list's query page to the same rule (docs/mobile.md).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { waitRectStable, waitScrollStable } = require('../helpers/layout');
const { MAIN, bootArticleList, bootBoardList, boardListEngaged } = require('../helpers/stack_routes');
const { bootScenario, loadCassette } = require('../helpers/replay');
const { bootMailbox, mailListActive } = require('../helpers/mail_box');
const { bootUserList, sendRaw, userListActive } = require('../helpers/user_list');

const VIEW = `${MAIN} .listBodyView`;
const keysButton = (page) => page.locator('#mobileToolbar [data-key="__keys"]');
const keypadKey = (page, key) => page.locator(`#mobileKeypad [data-key="${key}"]`);

// What the reader sees of the list: each card's top edge by its text, the
// selected card, the view's edges, and where the App Bar ends and the toolbar
// (or the key panel over it) begins.
const listGeometry = (page) => page.evaluate((viewSel) => {
  const view = document.querySelector(viewSel);
  const v = view.getBoundingClientRect();
  const panel = document.getElementById('mobileKeypad');
  const toolbar = document.querySelector('.mobileToolbarBar');
  const cards = [...view.querySelectorAll(':scope > .listCard')]
    // The key leaves out the cursor mark, which moves with the selection.
    .map((card) => ({ card, key: card.textContent.replace(/\s+/g, ' ').trim().replace(/^>\s*/, '') }))
    .filter(({ key }) => /\d/.test(key));
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  };
  const selected = cards.find(({ card }) => card.querySelector('.listCardTitle .listCardCursor')?.textContent === '>');
  return {
    tops: Object.fromEntries(cards.map(({ card, key }) => [key, card.getBoundingClientRect().top])),
    first: cards.length ? rect(cards[0].card) : null,
    last: cards.length ? rect(cards[cards.length - 1].card) : null,
    selected: selected ? { key: selected.key, ...rect(selected.card) } : null,
    viewTop: v.top,
    viewBottom: v.bottom,
    barBottom: document.getElementById('mobileAppBar').getBoundingClientRect().bottom,
    coverTop: (panel || toolbar).getBoundingClientRect().top,
    scrollTop: view.scrollTop,
    clientHeight: view.clientHeight,
  };
}, VIEW);

// The list at rest after a layout change.
async function settledList(page) {
  await waitScrollStable(page, VIEW);
  await waitRectStable(page, VIEW, { fullRect: true });
  return listGeometry(page);
}

async function toggleKeypad(page, open) {
  await keysButton(page).tap();
  if (open) await waitRectStable(page, '#mobileKeypad');
  else await expect(page.locator('#mobileKeypad')).toHaveCount(0);
  return settledList(page);
}

// The view spans the App Bar to whatever covers the bottom (toolbar or panel).
function expectViewBetweenBars(g) {
  expect(Math.abs(g.viewTop - g.barBottom), 'the view starts at the App Bar').toBeLessThan(1);
  expect(Math.abs(g.viewBottom - g.coverTop), 'the view ends where the toolbar or the key panel begins').toBeLessThan(1);
}

// Every card that was visible is where it was.
function expectCardsUnmoved(before, after, coverTop) {
  const keys = Object.keys(before.tops).filter((k) => before.tops[k] >= before.barBottom - 0.5 &&
    before.tops[k] < coverTop);
  expect(keys.length, 'cards visible in both layouts').toBeGreaterThan(1);
  for (const k of keys) expect(Math.abs(after.tops[k] - before.tops[k]), `card "${k}" moved`).toBeLessThan(0.5);
}

function expectSelectionShown(g) {
  expect(g.selected, 'a selected card is drawn').toBeTruthy();
  expect(g.selected.top, 'the selection is below the App Bar').toBeGreaterThanOrEqual(g.barBottom - 0.5);
  expect(g.selected.bottom, 'the selection is above the key panel').toBeLessThanOrEqual(g.coverTop + 0.5);
}

// The selection is visible above where the panel will be: the panel opens and
// closes without moving a card, and the view shrinks to the space above it.
async function expectPanelKeepsCards(page) {
  const before = await settledList(page);
  expectViewBetweenBars(before);
  expectSelectionShown(before);
  const open = await toggleKeypad(page, true);
  expect(before.selected.bottom, 'precondition: the panel leaves the selection uncovered').toBeLessThanOrEqual(open.coverTop);
  expectViewBetweenBars(open);
  expectCardsUnmoved(before, open, open.coverTop);
  expectSelectionShown(open);
  const closed = await toggleKeypad(page, false);
  expectViewBetweenBars(closed);
  expectCardsUnmoved(open, closed, open.coverTop);
  return toggleKeypad(page, true);
}

// The selection sits where the panel will be: opening it scrolls just far
// enough to show the selection right above the panel.
async function expectPanelRevealsSelection(page) {
  const before = await settledList(page);
  expectSelectionShown(before);
  const open = await toggleKeypad(page, true);
  expect(before.selected.bottom, 'precondition: the panel covers the selection').toBeGreaterThan(open.coverTop + 1);
  expectViewBetweenBars(open);
  expectSelectionShown(open);
  expect(Math.abs(open.selected.bottom - open.coverTop), 'the least scroll: the selection ends at the panel').toBeLessThan(1);
  // Everything moved together by that distance.
  const shift = before.selected.bottom - open.selected.bottom;
  for (const k of Object.keys(before.tops).filter((key) => key in open.tops))
    expect(Math.abs(before.tops[k] - open.tops[k] - shift), `card "${k}" moved by the reveal's distance`).toBeLessThan(1);
  return open;
}

// With the panel open, the first and the last loaded rows each scroll into
// the view between the App Bar and the panel.
async function expectEveryRowReachable(page) {
  await page.evaluate((sel) => { const v = document.querySelector(sel); v.scrollTop = v.scrollHeight; }, VIEW);
  const end = await settledList(page);
  expect(end.last.bottom, 'the last card shows above the panel').toBeLessThanOrEqual(end.coverTop + 0.5);
  expect(end.last.top).toBeGreaterThanOrEqual(end.barBottom - 0.5);
  await page.evaluate((sel) => { document.querySelector(sel).scrollTop = 0; }, VIEW);
  const start = await settledList(page);
  expect(start.first.top, 'the first card shows below the App Bar').toBeGreaterThanOrEqual(start.barBottom - 0.5);
  expect(start.first.bottom).toBeLessThanOrEqual(start.coverTop + 0.5);
}

// Each key of the panel keeps the selection in the view above it, scrolling
// only once it would leave the view.
async function expectArrowsKeepSelection(page, key, presses, settled) {
  for (let i = 0; i < presses; i++) {
    const before = await listGeometry(page);
    await keypadKey(page, key).tap();
    await expect.poll(async () => (await listGeometry(page)).selected?.key).not.toBe(before.selected.key);
    await settled(page);
    const g = await settledList(page);
    expectSelectionShown(g);
    // A move inside the view moves no card.
    const height = before.selected.bottom - before.selected.top;
    const step = key === 'ArrowDown' ? height : -height;
    const inside = before.selected.top + step >= before.barBottom - 0.5 &&
      before.selected.bottom + step <= before.coverTop + 0.5;
    if (inside) expect(Math.abs(g.tops[before.selected.key] - before.selected.top), 'no card moves for a move inside the view').toBeLessThan(1);
    else expect(Math.abs(key === 'ArrowDown' ? g.selected.bottom - g.coverTop : g.selected.top - g.barBottom),
      'the least scroll: the selection lands at the edge it crossed').toBeLessThan(1);
  }
}

const rowsHeight = (page) => page.evaluate(() => window.__app.buf.rows);

test.describe('the key panel shortens the list view (#256)', () => {
  test('article list: the panel keeps every card in place and every row reachable', async ({ page }) => {
    test.setTimeout(90000);
    await bootArticleList(page);
    const rows = await rowsHeight(page);
    // PgUp moves the selection up a page, away from where the panel will be.
    await page.locator('#t').focus();
    await page.keyboard.press('PageUp');
    await expectPanelKeepsCards(page);
    await expectEveryRowReachable(page);
    expect(await rowsHeight(page), 'terminal rows (NAWS) are unchanged').toBe(rows);
  });

  test('article list: opening the panel over the selection scrolls just enough to show it', async ({ page }) => {
    test.setTimeout(90000);
    await bootArticleList(page);
    await expectPanelRevealsSelection(page);
  });

  // The recorded board list ends a few boards below its selection.
  test('board list: opening the panel over the selection scrolls just enough to show it', async ({ page }) => {
    test.setTimeout(90000);
    await bootBoardList(page);
    await expectPanelRevealsSelection(page);
  });

  // 分類看板 → 市民廣場 (scn-stack-boardlist-folder.json): the selection is at the top.
  test('board list: the panel keeps every card in place and every row reachable', async ({ page }) => {
    test.setTimeout(90000);
    await bootScenario(page, ptt, loadCassette('scn-stack-boardlist-folder.json'));
    await boardListEngaged(page);
    await expectPanelKeepsCards(page);
    await expectEveryRowReachable(page);
  });

  test('mail list: opening the panel over the newest mail scrolls just enough, and ↑/↓ keep it shown', async ({ page }) => {
    test.setTimeout(90000);
    await bootMailbox(page, { count: 30 });
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    await expectPanelRevealsSelection(page);
    const open = await listGeometry(page);
    const shown = Math.floor((open.coverTop - open.barBottom) / (open.selected.bottom - open.selected.top));
    await expectArrowsKeepSelection(page, 'ArrowUp', shown + 2, mailListActive);
    await expectArrowsKeepSelection(page, 'ArrowDown', shown + 2, mailListActive);
    await expectEveryRowReachable(page);
  });

  test('user list: the panel keeps every card in place, ↑/↓ keep the selection shown, every row is reachable', async ({ page }) => {
    test.setTimeout(90000);
    await bootUserList(page, { count: 60 });
    await sendRaw(page, '\x1au');
    await userListActive(page);
    const open = await expectPanelKeepsCards(page);
    const shown = Math.floor((open.coverTop - open.barBottom) / (open.selected.bottom - open.selected.top));
    await expectArrowsKeepSelection(page, 'ArrowDown', shown + 2, userListActive);
    await expectArrowsKeepSelection(page, 'ArrowUp', shown + 2, userListActive);
    await expectEveryRowReachable(page);
  });

  test('user query page: the panel keeps its rows in place and its end reachable', async ({ page }) => {
    test.setTimeout(90000);
    const plan = Array.from({ length: 12 }, (_, i) => `名片第 ${i + 1} 行`);
    await bootUserList(page, { plans: { 3: plan } });
    await sendRaw(page, '\x1au');
    await userListActive(page);
    await page.locator(`${MAIN} .listCard[data-user-id="user003"]`).tap();
    const queryPage = page.locator('[data-user-query-page]');
    await expect(queryPage).toBeVisible();
    await page.waitForFunction(() => window.__app.userQuery.phase === 'shown' && window.__app.commandQueue.idle &&
      document.querySelector('[data-user-query-page]').getAnimations().length === 0);
    const rows = () => page.evaluate(() => {
      const box = document.querySelector('[data-user-query-page]');
      const scroller = box.querySelector('.userQueryScroll');
      const items = [...scroller.querySelectorAll('.userQueryRow, [data-user-query-plan] *')]
        .filter((el) => el.children.length === 0 || el.classList.contains('userQueryRow'));
      const panel = document.getElementById('mobileKeypad');
      return {
        tops: items.map((el) => el.getBoundingClientRect().top),
        lastBottom: Math.max(...items.map((el) => el.getBoundingClientRect().bottom)),
        bottom: box.getBoundingClientRect().bottom,
        coverTop: (panel || document.querySelector('.mobileToolbarBar')).getBoundingClientRect().top,
        barBottom: document.getElementById('mobileAppBar').getBoundingClientRect().bottom,
        top: box.getBoundingClientRect().top,
      };
    });
    const before = await rows();
    await keysButton(page).tap();
    await waitRectStable(page, '#mobileKeypad');
    await waitRectStable(page, '[data-user-query-page]', { fullRect: true });
    const open = await rows();
    expect(open.tops).toEqual(before.tops);
    expect(Math.abs(open.bottom - open.coverTop)).toBeLessThan(1);
    expect(Math.abs(open.top - open.barBottom)).toBeLessThan(1);
    await page.evaluate(() => {
      const s = document.querySelector('[data-user-query-page] .userQueryScroll');
      s.scrollTop = s.scrollHeight;
    });
    await waitScrollStable(page, '[data-user-query-page] .userQueryScroll');
    const end = await rows();
    expect(end.lastBottom, 'the end of the page shows above the panel').toBeLessThanOrEqual(end.coverTop + 0.5);
    await page.evaluate(() => { document.querySelector('[data-user-query-page] .userQueryScroll').scrollTop = 0; });
    await waitScrollStable(page, '[data-user-query-page] .userQueryScroll');
    await keysButton(page).tap();
    await expect(page.locator('#mobileKeypad')).toHaveCount(0);
    await waitRectStable(page, '[data-user-query-page]', { fullRect: true });
    expect((await rows()).tops).toEqual(before.tops);
  });

  // The user list stays under its query page, held while the page shows and
  // until PTT draws the list again after the page is left (user_query.js). A
  // panel closed over the page lengthens the list's view under it too: the
  // list shown again fills the space down to the toolbar, with no band left
  // unpainted where the panel was.
  test('user list under its query page: closing the panel there lengthens the list too', async ({ page }) => {
    test.setTimeout(90000);
    await bootUserList(page, { count: 60, sleepMs: 1500 });
    await sendRaw(page, '\x1au');
    await userListActive(page);
    const closed = await settledList(page);
    expectViewBetweenBars(closed);
    const open = await toggleKeypad(page, true);
    expectViewBetweenBars(open);
    await page.locator(`${MAIN} .listCard[data-user-id="user003"]`).tap();
    await expect(page.locator('[data-user-query-page]')).toBeVisible();
    await page.waitForFunction(() => window.__app.userQuery.phase === 'shown' && window.__app.commandQueue.idle);
    await keysButton(page).tap();
    await expect(page.locator('#mobileKeypad')).toHaveCount(0);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    await expect(page.locator('[data-user-query-page]')).toHaveCount(0);
    // PTT still sleeps on its query screen: the list shown is the held one.
    const held = await settledList(page);
    expect(await page.evaluate(() => window.__app.userQuery.holding), 'the list is still held').toBe(true);
    expectViewBetweenBars(held);
    expect(held.last.bottom, 'cards fill the view down to the toolbar').toBeGreaterThanOrEqual(held.coverTop - 0.5);
    await userListActive(page);
    expectViewBetweenBars(await settledList(page));
  });
});
