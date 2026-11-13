const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { waitRectStable, waitScrollStable } = require('../helpers/layout');

const RECENT_KEY = 'pttchrome.homeRecentBoards.v2';
const FAVORITES_KEY = 'pttchrome.homeFavorites.v1';
const COLUMN = '.PrefModal .PrefModal__Grid__Col--right';
const FOOTER = '.PrefModal .PrefModal__SubpageFooter';
const BOARDS = ['C_Chat', 'Stock', 'Gossiping', 'Steam', 'Test', 'BoardA', 'BoardB', 'BoardC'];
const recentNames = page => page.locator('#homeDashboard [data-home-recent]')
  .evaluateAll(entries => entries.map(entry => entry.dataset.homeRecent));
const sent = page => page.evaluate(() => window.__sent);
const section = (manager, name) => manager.locator(`[data-manager-section="${name}"]`);
const entry = (manager, name) => manager.locator(`[data-manager-entry="${name}"]`);
const names = (manager, name) => section(manager, name).locator('[data-manager-entry]')
  .evaluateAll(entries => entries.map(entry => entry.dataset.managerEntry));
const action = (settings, name) => settings.locator(`[data-manager-action="${name}"]`);
const history = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), RECENT_KEY);
const label = (page, key) => page.evaluate(key => window.__i18n(key), key);

async function bootMenu(page, boards = BOARDS, pinned = []) {
  await bootOffline(page, ptt);
  await page.evaluate(({ boards, pinned, favoritesKey }) => {
    const home = window.__app.homeDashboard;
    for (const name of [...boards].reverse()) home._noteRecent(name);
    if (pinned.length) home.updateRecentHistory(current => ({
      pinned: current.recent.filter(entry => pinned.includes(entry.text))
        .map(entry => ({ text: entry.text, auto: false })),
      recent: current.recent.filter(entry => !pinned.includes(entry.text)),
    }));
    const favorites = [{ name: 'Stock', desc: 'Favorite board', unread: true }];
    const now = Date.now();
    window.localStorage.setItem(favoritesKey, JSON.stringify({ at: now, boards: favorites }));
    home._set({ boards: favorites, fetchedAt: now, savedAt: now });
  }, { boards, pinned, favoritesKey: FAVORITES_KEY });
  await drawMainMenu(page);
  await expect.poll(() => recentNames(page)).toEqual(boards);
  await page.evaluate(() => {
    window.__sent = [];
    window.__stubWSSent = bytes => window.__sent.push(bytes);
  });
}

async function openManager(page) {
  const settings = page.locator('.PrefModal');
  await page.locator('[data-key="__more"]').tap();
  const settingsItem = page.locator('[data-key="__settings"]');
  await expect(settingsItem).toBeVisible();
  await waitRectStable(page, '[data-key="__settings"]', { fullRect: true });
  await settingsItem.tap();
  await expect(settings).toBeVisible();
  await settings.locator('[data-pref-category="local"]').tap();
  await settings.locator('[data-pref-subpage="recentBoards"]').tap();
  const manager = settings.locator('[data-recent-boards-manager]');
  await expect(manager).toBeVisible();
  return { settings, manager };
}

for (const width of [320, 412]) {
  test(`deleting a recent board updates home and preserves favorites at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 640 });
    await bootMenu(page, BOARDS, ['C_Chat']);
    const pinnedBoard = page.locator('#homeDashboard [data-home-recent="C_Chat"]');
    const recentBoard = page.locator('#homeDashboard [data-home-recent="Stock"]');
    await expect(pinnedBoard).toHaveAttribute('data-pinned', '');
    await expect(recentBoard).not.toHaveAttribute('data-pinned');
    const pinnedColor = await pinnedBoard.evaluate(button => getComputedStyle(button).backgroundColor);
    const recentColor = await recentBoard.evaluate(button => getComputedStyle(button).backgroundColor);
    expect(pinnedColor).not.toBe(recentColor);
    await info.attach(`home-recent-boards-${width}px`, { body: await page.screenshot(), contentType: 'image/png' });
    const favoriteCache = await page.evaluate(key => localStorage.getItem(key), FAVORITES_KEY);
    const { settings, manager } = await openManager(page);
    const remove = action(settings, 'delete');
    await expect(remove).toBeDisabled();
    await expect(manager.locator('[data-manager-entry]')).toHaveCount(BOARDS.length);
    await expect(settings.locator('.PrefModal__Grid__Col--right__Reset:visible')).toHaveCount(0);
    await entry(manager, 'Stock').locator('[data-manager-text]').tap();
    await expect(remove).toBeEnabled();
    await expect(entry(manager, 'Stock').locator('input')).toBeChecked();

    // Measure the footer at the end of its scroll range, where no row may hide under it.
    await settings.locator('.PrefModal__Grid__Col--right').evaluate(column => {
      column.scrollTop = column.scrollHeight;
    });
    await waitScrollStable(page, COLUMN);
    await waitRectStable(page, FOOTER);
    const layout = await settings.evaluate(root => {
      const column = root.querySelector('.PrefModal__Grid__Col--right');
      const footer = root.querySelector('.PrefModal__SubpageFooter').getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      const entries = [...root.querySelectorAll('[data-manager-entry]')];
      const last = entries.at(-1).getBoundingClientRect();
      return {
        width: column.clientWidth,
        scrollWidth: column.scrollWidth,
        footerBottom: footer.bottom,
        columnBottom: columnRect.bottom,
        lastBottom: last.bottom,
        footerTop: footer.top,
        rowHeights: entries.map(entry => entry.getBoundingClientRect().height),
        background: getComputedStyle(root).backgroundColor,
        scheme: document.documentElement.getAttribute('data-mantine-color-scheme'),
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    expect(Math.abs(layout.footerBottom - layout.columnBottom)).toBeLessThanOrEqual(1);
    expect(layout.lastBottom).toBeLessThanOrEqual(layout.footerTop + 1);
    for (const height of layout.rowHeights) expect(height).toBeGreaterThanOrEqual(44);
    expect(layout.scheme).toBe('dark');
    const background = layout.background.match(/[\d.]+/g).slice(0, 3).map(Number);
    expect(Math.max(...background)).toBeLessThan(100);
    await info.attach(`recent-boards-${width}px`, { body: await page.screenshot(), contentType: 'image/png' });

    await remove.tap();
    const remaining = BOARDS.filter(name => name !== 'Stock');
    await expect(manager.locator('[data-manager-entry]')).toHaveCount(remaining.length);
    expect(await history(page)).toEqual({
      pinned: [{ text: 'C_Chat', auto: false }],
      recent: remaining.filter(name => name !== 'C_Chat').map(text => ({ text, uses: 1 })),
    });
    await expect.poll(() => recentNames(page)).toEqual(remaining);
    expect(await page.evaluate(key => localStorage.getItem(key), FAVORITES_KEY)).toBe(favoriteCache);
    await expect(page.locator('#homeDashboard [data-home-board="Stock"]')).toHaveCount(1);
    expect(await sent(page)).toEqual([]);

    await settings.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(settings).toBeHidden();
    await expect(page.locator('#homeDashboard [data-home-board="Stock"]')).toBeVisible();
    await expect(page.locator('#homeDashboard [data-home-recent="Stock"]')).toHaveCount(0);
  });
}

test('select all clears recent boards immediately and Back returns one settings level without PTT input', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 640 });
  await bootMenu(page, ['Stock', 'C_Chat', 'Steam']);
  const { settings, manager } = await openManager(page);
  const selectAll = manager.locator('[data-manager-select-all="recent"]');
  const remove = action(settings, 'delete');

  await selectAll.tap();
  await expect(selectAll).toBeChecked();
  await expect(manager.locator('[data-manager-entry] input:checked')).toHaveCount(3);
  await remove.tap();
  await expect(manager.locator('[data-manager-entry]')).toHaveCount(0);
  await expect(manager.getByText(await label(page, 'recentBoardsManager_empty'), { exact: true })).toBeVisible();
  await expect(selectAll).toBeDisabled();
  await expect(remove).toBeDisabled();
  expect(await history(page)).toEqual({ pinned: [], recent: [] });
  await expect.poll(() => recentNames(page)).toEqual([]);
  await expect(page.locator('#homeDashboard [data-home-board="Stock"]')).toHaveCount(1);
  expect(await sent(page)).toEqual([]);

  await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
  await page.goBack();
  await expect(manager).toHaveCount(0);
  await expect(settings).toBeVisible();
  const entry = settings.locator('[data-pref-subpage="recentBoards"]');
  await expect(entry).toBeVisible();
  expect(await sent(page)).toEqual([]);

  await entry.tap();
  await expect(manager.getByText(await label(page, 'recentBoardsManager_empty'), { exact: true })).toBeVisible();
  await expect(remove).toBeDisabled();
  expect(await sent(page)).toEqual([]);
});

test('batch pinning, moving and unpinning preserve selected order and update home immediately', async ({ page }, info) => {
  await page.setViewportSize({ width: 412, height: 840 });
  await bootMenu(page, ['Stock', 'C_Chat', 'Steam', 'Test']);
  const { settings, manager } = await openManager(page);
  for (const board of ['Stock', 'C_Chat', 'Steam']) {
    await entry(manager, board).locator('[data-manager-text]').tap();
  }
  await action(settings, 'pin').tap();
  await expect.poll(() => names(manager, 'pinned')).toEqual(['Stock', 'C_Chat', 'Steam']);
  await expect(page.locator('#homeDashboard [data-home-recent="C_Chat"]')).toHaveAttribute('data-pinned', '');
  await expect.poll(() => names(manager, 'recent')).toEqual(['Test']);
  await expect(manager.locator('[data-manager-entry] input:checked')).toHaveCount(3);
  await expect(action(settings, 'pin')).toBeDisabled();
  await expect(action(settings, 'up')).toBeDisabled();
  await expect(action(settings, 'down')).toBeDisabled();

  await entry(manager, 'Stock').locator('[data-manager-text]').tap();
  await action(settings, 'up').tap();
  await expect.poll(() => names(manager, 'pinned')).toEqual(['C_Chat', 'Steam', 'Stock']);
  await expect(entry(manager, 'C_Chat').locator('input')).toBeChecked();
  await expect(entry(manager, 'Steam').locator('input')).toBeChecked();
  await expect(action(settings, 'up')).toBeDisabled();
  await expect(action(settings, 'down')).toBeEnabled();
  await waitRectStable(page, FOOTER);
  await info.attach('recent-boards-pinned-and-recent', { body: await page.screenshot(), contentType: 'image/png' });

  await action(settings, 'down').tap();
  await expect.poll(() => names(manager, 'pinned')).toEqual(['Stock', 'C_Chat', 'Steam']);
  await action(settings, 'unpin').tap();
  await expect.poll(() => names(manager, 'pinned')).toEqual(['Stock']);
  await expect(page.locator('#homeDashboard [data-home-recent="C_Chat"]')).not.toHaveAttribute('data-pinned');
  await expect.poll(() => names(manager, 'recent')).toEqual(['C_Chat', 'Steam', 'Test']);
  await expect(manager.locator('[data-manager-entry] input:checked')).toHaveCount(2);
  expect(await history(page)).toEqual({
    pinned: [{ text: 'Stock', auto: false }],
    recent: [{ text: 'C_Chat', uses: 0 }, { text: 'Steam', uses: 0 }, { text: 'Test', uses: 1 }],
  });
  await expect.poll(() => recentNames(page)).toEqual(['Stock', 'C_Chat', 'Steam', 'Test']);

  // One delete can span both sections, and then clears the selection.
  await entry(manager, 'Stock').locator('[data-manager-text]').tap();
  await action(settings, 'delete').tap();
  await expect.poll(() => recentNames(page)).toEqual(['Test']);
  await expect(manager.locator('[data-manager-entry] input:checked')).toHaveCount(0);
  await expect(action(settings, 'delete')).toBeDisabled();
  expect(await sent(page)).toEqual([]);
});

test('automatic pinning is marked and unpinning returns the visit count to zero', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 640 });
  await bootMenu(page, ['Stock', 'C_Chat']);
  // Prepare ten completed visits; the interactions under test use real taps.
  await page.evaluate(() => {
    for (let visit = 1; visit < 10; visit++) window.__app.homeDashboard._noteRecent('C_Chat');
  });
  const { settings, manager } = await openManager(page);
  await expect.poll(() => names(manager, 'pinned')).toEqual(['C_Chat']);
  await expect(entry(manager, 'C_Chat').locator('[data-manager-auto]')).toBeVisible();
  await expect(entry(manager, 'Stock').locator('[data-manager-uses]')).toHaveText('1');
  await expect.poll(() => recentNames(page)).toEqual(['C_Chat', 'Stock']);

  await entry(manager, 'C_Chat').locator('[data-manager-text]').tap();
  await action(settings, 'unpin').tap();
  await expect.poll(() => names(manager, 'pinned')).toEqual([]);
  await expect.poll(() => names(manager, 'recent')).toEqual(['C_Chat', 'Stock']);
  await expect(entry(manager, 'C_Chat').locator('[data-manager-uses]')).toHaveText('0');
  await expect(entry(manager, 'C_Chat').locator('[data-manager-auto]')).toHaveCount(0);
  expect(await history(page)).toEqual({
    pinned: [], recent: [{ text: 'C_Chat', uses: 0 }, { text: 'Stock', uses: 1 }],
  });
  expect(await sent(page)).toEqual([]);
});
