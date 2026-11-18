// Querying a user from the online user list (#199 phase 2) in list easy
// reading: a tap on a user card, or 查詢網友 in the toolbar's More sheet,
// shows PTT's query screen as a page of its own stacked over the list, and
// leaving the page shows the list again at once while PTT sleeps before it
// draws the list. PTT's grid never shows on this route, so the native grid
// guard (helpers/native_grid_guard.js, failing on offline-mobile) must see no
// frame of it.
//
// The list is the controlled PTT of helpers/user_list.js with invented users;
// Ctrl+Z u is sent to PTT as it is until the home dashboard has an entrance.
const { test, expect } = require('@playwright/test');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { bootUserList, sendRaw, userListActive, userListSurface } = require('../helpers/user_list');

const UNSUPPORTED_KEY = '好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）';
const text = (page, key) => page.evaluate((k) => window.__i18n(k), key);
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const main = (page) => page.locator('.main:not([data-stack-layer])');
const queryPage = (page) => page.locator('[data-user-query-page]');
const field = (page, name) => queryPage(page).locator(`.userQueryRow[data-field="${name}"] .userQueryValue`);
const selectedId = (page) => main(page).evaluate((el) => {
  const card = [...el.querySelectorAll('.listCard[data-user-id]')]
    .find((c) => c.querySelector('.listCardTitle .listCardCursor')?.textContent === '>');
  return card ? card.getAttribute('data-user-id') : null;
});
const sentSinceMark = (page) => page.evaluate(() => window.__userListSent.slice(window.__sentMark));
const markSent = (page) => page.evaluate(() => { window.__sentMark = window.__userListSent.length; });
const holding = (page) => page.evaluate(() => window.__app.userQuery.holding);

async function enterUserList(page) {
  await page.evaluate(() => window.__nativeGridGuard.reset());
  await sendRaw(page, '\x1au');
  await userListActive(page);
  expect(await userListSurface(page)).toBe('list:all');
}

// The query page is up, PTT shows its query screen and nothing else is sent.
async function pageShown(page, id) {
  await expect(queryPage(page)).toBeVisible();
  await expect(queryPage(page)).toHaveAttribute('data-user-id', id);
  await page.waitForFunction(() => window.__app.userQuery.phase === 'shown' && window.__app.commandQueue.idle &&
    document.querySelector('[data-user-query-page]').getAnimations().length === 0);
  expect(await userListSurface(page)).toBe('query');
}

async function queryFromMore(page, id) {
  await page.locator('[data-key="__more"]').tap();
  await page.locator('[data-key="__userQuery"]').tap();
  const input = page.locator('[data-search-modal] input[name="searchKeyword"]');
  await expect(input).toBeVisible();
  await expect(page.locator('.mobileSheet')).toContainText(await text(page, 'userQuery_title'));
  await input.fill(id);
  await input.press('Enter');
}

test.describe('querying a user from the online user list', () => {
  test('a tap on a user card shows the user as a page, never PTT\'s grid', async ({ page }) => {
    await bootUserList(page);
    await enterUserList(page);
    await markSent(page);
    await main(page).locator('.listCard[data-user-id="user003"]').tap();
    await pageShown(page, 'user003');
    // `Q`, then the ID and Enter only after PTT asked for it.
    expect((await sentSinceMark(page)).map((s) => s.replace(/\f$/, ''))).toEqual(['Q', 'user003\r']);
    await expect(field(page, 'id')).toHaveText('user003');
    await expect(field(page, 'nick')).toHaveText('暱稱3');
    await expect(field(page, 'money')).toHaveText('清寒');
    await expect(field(page, 'logins')).toHaveText('12 次 (同天內只計一次)');
    await expect(field(page, 'posts')).toHaveText('3 篇 (退:0)');
    await expect(field(page, 'activity')).toHaveText('使用者名單');
    await expect(field(page, 'mail')).toHaveText('最近無新信件');
    await expect(field(page, 'lastLogin')).toHaveText('01/02/2026 03:04:05 Fri');
    await expect(field(page, 'lastHost')).toHaveText('西岸');
    await expect(field(page, 'record')).toHaveText('五子棋 0 勝 0 敗 0 和／象棋 0 勝 0 敗 0 和');
    await expect(queryPage(page).locator('[data-user-query-plan="none"]')).toContainText(await text(page, 'userQuery_noPlan'));
    // The page is not PTT's grid: no 請按任意鍵繼續 bar, no 《 》 labels.
    await expect(queryPage(page)).not.toContainText('請按任意鍵繼續');
    await expect(queryPage(page)).not.toContainText('《');
    await expect(page.locator('#mobileAppBar')).toContainText(await text(page, 'userQuery_title'));
    // A left swipe opens nothing (the page has no drawer) and leaves nothing.
    const box = await queryPage(page).boundingBox();
    const y = box.y + box.height / 2;
    const contact = await beginArticleTouch(page, { x: box.x + box.width - 24, y });
    await contact.move({ x: box.x + box.width - 60, y });
    await contact.move({ x: box.x + 40, y });
    await contact.release();
    await expect(queryPage(page)).toBeVisible();
    await expect(page.locator('.articleShortcutDrawer')).toHaveCount(0);
    expect(await userListSurface(page)).toBe('query');
    expect(await guardHits(page)).toEqual([]);
  });

  test('Back shows the list at once and holds it through PTT\'s sleep', async ({ page }) => {
    await bootUserList(page, { sleepMs: 1500 });
    await enterUserList(page);
    await main(page).locator('.listCard[data-user-id="user005"]').tap();
    await pageShown(page, 'user005');
    await markSent(page);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    // The page is gone and the list shows with the same card selected while
    // PTT still sleeps on its query screen.
    await expect(queryPage(page)).toHaveCount(0);
    expect(await holding(page)).toBe(true);
    await expect(main(page).locator('.listCard[data-user-id="user005"]')).toBeVisible();
    expect(await selectedId(page)).toBe('user005');
    await userListActive(page);
    expect(await holding(page)).toBe(false);
    expect(await selectedId(page)).toBe('user005');
    // One key for PTT's 請按任意鍵繼續.
    expect((await sentSinceMark(page)).map((s) => s.replace(/\f$/, ''))).toEqual([' ']);
    expect(await guardHits(page)).toEqual([]);
  });

  // On a phone ← and Esc are also the toolbar keypad's keys
  // (view.sendKeyAsUser), not a keydown on window: each leaves the page as
  // Back does, with the one key for PTT's 請按任意鍵繼續, never the busy hint
  // of the query. The keypad's ↓ scrolls the page.
  test('the keypad\'s ← and Esc leave the page as Back does', async ({ page }) => {
    await bootUserList(page, { sleepMs: 400, plans: { 2: Array.from({ length: 30 }, (_, i) => '  名片第 ' + (i + 1) + ' 行') } });
    await enterUserList(page);
    // The keypad covers the cards: each user is queried with ↓ and Enter.
    await page.locator('[data-key="__keys"]').tap();
    for (const [id, how] of [['user002', 'ArrowLeft'], ['user003', 'Escape']]) {
      await page.focus('#t');
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => selectedId(page)).toBe(id);
      await page.keyboard.press('Enter');
      await pageShown(page, id);
      if (id === 'user002') {
        await page.locator('#mobileKeypad [data-key="ArrowDown"]').tap();
        await expect.poll(() => queryPage(page).evaluate((el) => el.firstChild.scrollTop)).toBeGreaterThan(0);
        expect(await page.evaluate(() => window.__app.userQuery.phase)).toBe('shown');
      }
      await markSent(page);
      await page.locator(`#mobileKeypad [data-key="${how}"]`).tap();
      await expect(queryPage(page)).toHaveCount(0);
      await userListActive(page);
      expect(await selectedId(page)).toBe(id);
      expect((await sentSinceMark(page)).map((s) => s.replace(/\f$/, ''))).toEqual([' ']);
    }
    await expect(page.locator('.ListHint', { hasText: await text(page, 'userQuery_busy') })).toHaveCount(0);
    expect(await guardHits(page)).toEqual([]);
  });

  // The query page marks itself a modal; the toolbar's Keys and More, the
  // keypad's keys and the soft keyboard's text must still work over it.
  test('Keys opens over the page: the keypad scrolls it and its ← leaves; unsupported keys get the hint', async ({ page }) => {
    await bootUserList(page, { sleepMs: 300, plans: { 2: Array.from({ length: 30 }, (_, i) => '  名片第 ' + (i + 1) + ' 行') } });
    await enterUserList(page);
    await main(page).locator('.listCard[data-user-id="user002"]').tap();
    await pageShown(page, 'user002');
    await expect(page.locator('[data-key="__keys"]')).toBeEnabled();
    await expect(page.locator('[data-key="__more"]')).toBeEnabled();
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toBeVisible();
    await markSent(page);
    // Enter and → would act on the list held under the page: refused with the hint.
    for (const k of ['Enter', 'ArrowRight', 'Backspace']) {
      await page.locator(`#mobileKeypad [data-key="${k}"]`).tap();
      await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
    }
    expect(await sentSinceMark(page)).toEqual([]);
    await expect(queryPage(page)).toBeVisible();
    await page.locator('#mobileKeypad [data-key="ArrowLeft"]').tap();
    await expect(queryPage(page)).toHaveCount(0);
    await userListActive(page);
    expect(await selectedId(page)).toBe('user002');
    expect((await sentSinceMark(page)).map((s) => s.replace(/\f$/, ''))).toEqual([' ']);
    expect(await guardHits(page)).toEqual([]);
  });

  test('the keypad\'s keyboard button opens the soft keyboard; q typed on it leaves, another letter shows the hint', async ({ page }) => {
    await bootUserList(page, { sleepMs: 300 });
    await enterUserList(page);
    await main(page).locator('.listCard[data-user-id="user003"]').tap();
    await pageShown(page, 'user003');
    await page.locator('[data-key="__keys"]').tap();
    await page.locator('#mobileKeypad [data-key="__keyboard"]').tap();
    expect(await page.evaluate(() => window.__app.softKeyboard)).toBe(true);
    await expect(page.locator('#t')).toBeFocused();
    await markSent(page);
    await page.keyboard.insertText('w');
    await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
    await page.keyboard.insertText('你好');
    await expect(queryPage(page)).toBeVisible();
    expect(await sentSinceMark(page)).toEqual([]);
    await page.keyboard.insertText('q');
    await expect(queryPage(page)).toHaveCount(0);
    await userListActive(page);
    expect(await selectedId(page)).toBe('user003');
    expect((await sentSinceMark(page)).map((s) => s.replace(/\f$/, ''))).toEqual([' ']);
    expect(await guardHits(page)).toEqual([]);
  });

  // The owner's sequence: the keypad is already open (with its keyboard button)
  // when the query page appears.
  test('a keypad opened before the page: Keys closes it and opens it again, its keyboard button opens the soft keyboard', async ({ page }) => {
    await bootUserList(page, { sleepMs: 300 });
    await enterUserList(page);
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toBeVisible();
    // The keypad covers the cards: the user is queried with ↓ and Enter.
    await page.focus('#t');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedId(page)).toBe('user002');
    await page.keyboard.press('Enter');
    await pageShown(page, 'user002');
    await expect(page.locator('#mobileKeypad')).toBeVisible();
    await expect(page.locator('[data-key="__keys"]')).toBeEnabled();
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toHaveCount(0);
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toBeVisible();
    await page.locator('#mobileKeypad [data-key="__keyboard"]').tap();
    expect(await page.evaluate(() => window.__app.softKeyboard)).toBe(true);
    await page.keyboard.insertText('x');
    await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
    await page.keyboard.insertText('q');
    await expect(queryPage(page)).toHaveCount(0);
    await userListActive(page);
    expect(await selectedId(page)).toBe('user002');
    expect(await guardHits(page)).toEqual([]);
  });

  // The page ends where the toolbar (and the keypad over it) begins, both ways:
  // nothing of the list under it shows, and the keypad covers none of the page.
  const bottomGap = (page) => page.evaluate(() => {
    const bar = document.getElementById('mobileToolbar');
    const pad = document.getElementById('mobileKeypad');
    const top = Math.min(...[bar, pad].filter(Boolean).map((el) => el.getBoundingClientRect().top));
    return Math.round(top - document.querySelector('[data-user-query-page]').getBoundingClientRect().bottom);
  });

  // The page starts at the App Bar's bottom edge and its first row shows.
  const topGap = (page) => page.evaluate(() => {
    const bar = document.getElementById('mobileAppBar').getBoundingClientRect();
    const box = document.querySelector('[data-user-query-page]').getBoundingClientRect();
    const first = document.querySelector('[data-user-query-page] .userQueryRow').getBoundingClientRect();
    return { gap: Math.round(box.top - bar.bottom), firstClear: first.top >= bar.bottom - 0.5 };
  });
  const placed = async (page) => {
    await expect.poll(() => bottomGap(page)).toBe(0);
    await expect.poll(() => topGap(page)).toEqual({ gap: 0, firstClear: true });
  };

  test('the page\'s bottom edge follows the keypad: closing it brings the page down, opening it moves the page up', async ({ page }) => {
    await bootUserList(page, { sleepMs: 300 });
    await enterUserList(page);
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toBeVisible();
    await page.focus('#t');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selectedId(page)).toBe('user002');
    await page.keyboard.press('Enter');
    await pageShown(page, 'user002');
    await placed(page);
    const withKeypad = (await queryPage(page).boundingBox()).height;
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toHaveCount(0);
    await placed(page);
    expect((await queryPage(page).boundingBox()).height).toBeGreaterThan(withKeypad);
    await page.locator('[data-key="__keys"]').tap();
    await expect(page.locator('#mobileKeypad')).toBeVisible();
    await placed(page);
    expect((await queryPage(page).boundingBox()).height).toBe(withKeypad);
    // The soft keyboard covers the page (it overlays the bar), the page stays put.
    await page.locator('#mobileKeypad [data-key="__keyboard"]').tap();
    await placed(page);
    expect(await guardHits(page)).toEqual([]);
  });

  test('More opens over the page: what acts on the held list is not offered, logout is disabled', async ({ page }) => {
    await bootUserList(page, { sleepMs: 300 });
    await enterUserList(page);
    await main(page).locator('.listCard[data-user-id="user004"]').tap();
    await pageShown(page, 'user004');
    // Every slot that would act on the held list is empty or disabled.
    for (const k of ['X', '__reply', '__post', '__search']) await expect(page.locator(`#mobileToolbar [data-key="${k}"]`)).toHaveCount(0);
    await expect(page.locator('[data-key="__refresh"]')).toBeDisabled();
    await expect(page.locator('[data-key="__end"]')).toBeDisabled();
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-panel="more"]')).toBeVisible();
    for (const k of ['__userQuery', '__userListToggle', '__unreadJump', '__markAllRead', '__help', '__selectAll'])
      await expect(page.locator(`[data-panel="more"] [data-key="${k}"]`)).toHaveCount(0);
    await expect(page.locator('[data-panel="more"] [data-key="__logout"]')).toBeDisabled();
    await expect(page.locator('[data-panel="more"] [data-key="__select"]')).toBeEnabled();
    await expect(page.locator('[data-panel="more"] [data-key="__settings"]')).toBeEnabled();
    // The sheet keeps the system Back: it closes the sheet, the page stays.
    await markSent(page);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    await expect(page.locator('[data-panel="more"]')).toHaveCount(0);
    await expect(queryPage(page)).toBeVisible();
    expect(await sentSinceMark(page)).toEqual([]);
    // Esc closes the top-most layer only: the sheet; a second Esc leaves the page.
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-panel="more"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel="more"]')).toHaveCount(0);
    await expect(queryPage(page)).toBeVisible();
    expect(await sentSinceMark(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(queryPage(page)).toHaveCount(0);
    await userListActive(page);
    expect((await sentSinceMark(page)).map((s) => s.replace(/\f$/, ''))).toEqual([' ']);
    expect(await guardHits(page)).toEqual([]);
  });

  test('More → 查詢網友 asks for an ID and shows that user with the plan; ← and a swipe leave', async ({ page }) => {
    await bootUserList(page, { plans: { 7: ['  第一行的名片', '', '  第三行 ~~~'] }, sleepMs: 400 });
    await enterUserList(page);
    await queryFromMore(page, 'user007');
    await pageShown(page, 'user007');
    await expect(queryPage(page).locator('.userQueryPlanText')).toHaveText('  第一行的名片\n\n  第三行 ~~~');
    await page.keyboard.press('ArrowLeft');
    await expect(queryPage(page)).toHaveCount(0);
    await userListActive(page);
    expect(await selectedId(page)).toBe('user001');

    await main(page).locator('.listCard[data-user-id="user002"]').tap();
    await pageShown(page, 'user002');
    const box = await queryPage(page).boundingBox();
    const y = box.y + box.height / 2;
    const contact = await beginArticleTouch(page, { x: box.x + 20, y });
    await contact.move({ x: box.x + 36, y });
    await contact.move({ x: box.x + 160, y });
    await contact.move({ x: box.x + box.width - 20, y });
    await contact.release();
    await expect(queryPage(page)).toHaveCount(0);
    await userListActive(page);
    expect(await selectedId(page)).toBe('user002');
    expect(await guardHits(page)).toEqual([]);
  });

  test('an ID nobody online has stays on the list with 找不到這個使用者', async ({ page }) => {
    await bootUserList(page);
    await enterUserList(page);
    await queryFromMore(page, 'nobody9');
    await expect(page.locator('.ListHint')).toHaveText(await text(page, 'userQuery_notFound'));
    await userListActive(page);
    await expect(queryPage(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__app.userQuery.phase)).toBe('idle');
    expect(await guardHits(page)).toEqual([]);
  });

  test('PTT\'s usage-limit alert is dismissed: a denial stays on the list, a slowdown shows the user', async ({ page }) => {
    await bootUserList(page);
    await enterUserList(page);
    await page.evaluate(() => { window.__userListServer.state.flood = 'denied'; });
    await markSent(page);
    await main(page).locator('.listCard[data-user-id="user003"]').tap();
    await expect(page.locator('.ListHint')).toHaveText(await text(page, 'userQuery_flood'));
    await userListActive(page);
    await expect(queryPage(page)).toHaveCount(0);
    expect((await sentSinceMark(page)).map((s) => s.replace(/\f$/, ''))).toEqual(['Q', 'user003\r', ' ']);

    await page.evaluate(() => { window.__userListServer.state.flood = 'slowed'; });
    await main(page).locator('.listCard[data-user-id="user004"]').tap();
    await pageShown(page, 'user004');
    expect(await guardHits(page)).toEqual([]);
  });
});
