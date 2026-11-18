// The online user list (#199) in list easy reading: PTT's 【休閒聊天】 (all
// users) and 【好友列表】 (friends only) are shown as user cards, scrolling
// reads more of the list, a number jump selects that user, and the friends
// view with no friend online shows an empty-state row. With easy reading on,
// PttChrome presents every screen on this route, so the native grid guard
// (helpers/native_grid_guard.js, failing on offline-mobile) must see no frame
// of PTT's grid.
//
// The list is the controlled PTT of helpers/user_list.js with invented users.
// Ctrl+Z u and `f` are sent to PTT as they are here: this spec is about the
// list itself, whatever brought the view. The entrance, the key policy and
// the in-place toggle are mobile_user_list_entry.offline.spec.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootUserList, sendRaw, userListActive, userListSurface } = require('../helpers/user_list');

const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const main = (page) => page.locator('.main:not([data-stack-layer])');
// The user cards shown: a short list is padded with blank filler cards.
const cards = (page) => main(page).evaluate((el) => [...el.querySelectorAll('.listCard')]
  .filter((card) => /\d/.test(card.querySelector('.listCardNum')?.textContent || ''))
  .map((card) => ({
    num: card.querySelector('.listCardNum').textContent.trim(),
    id: card.getAttribute('data-user-id'),
    friend: card.hasAttribute('data-user-friend'),
    gone: card.hasAttribute('data-user-gone'),
    selected: card.querySelector('.listCardTitle .listCardCursor')?.textContent === '>',
  })));
const selected = async (page) => (await cards(page)).find((c) => c.selected);
const loadedNums = (page) => page.evaluate(() => (window.__app.buf.listLineNums || []).filter((n) => n != null));
const contiguousFrom1 = (nums) => nums.every((n, i) => n === i + 1);

async function enterUserList(page) {
  await page.evaluate(() => window.__nativeGridGuard.reset());
  await sendRaw(page, '\x1au');
  await userListActive(page);
  expect(await userListSurface(page)).toBe('list:all');
}

test.describe('the online user list in easy reading', () => {
  test('Ctrl+Z u shows the user list as user cards, never PTT\'s grid', async ({ page }) => {
    await bootUserList(page, { friends: [2], gone: 4 });
    await enterUserList(page);
    expect(await page.evaluate(() => window.__app.listSession.userListView())).toBe('all');
    await expect(page.locator('#homeDashboard')).toBeHidden();
    const shown = await cards(page);
    expect(shown[0]).toEqual({ num: '1', id: 'user001', friend: false, gone: false, selected: true });
    expect(shown[1]).toMatchObject({ num: '2', id: 'user002', friend: true });
    // A user who logged off has no ID and is greyed.
    expect(shown[3]).toMatchObject({ num: '4', id: null, gone: true });
    // PTT's pager column and the users' homes are not shown.
    const user2 = main(page).locator('.listCard[data-user-id="user002"]');
    await expect(user2).toContainText('暱稱2');
    await expect(user2).not.toContainText('東區網路');
    expect(await guardHits(page)).toEqual([]);
  });

  test('scrolling reads the next pages, End shows the short last page and Home goes back', async ({ page }) => {
    await bootUserList(page, { count: 60 });
    await enterUserList(page);
    const page1 = await loadedNums(page);
    const PAGE = await page.evaluate(() => window.__userListServer.PAGE);
    for (let i = 0; i < 2; i++) {
      await ptt.sendKey(page, 'PageDown');
      await userListActive(page);
    }
    await expect.poll(async () => Math.max(...await loadedNums(page))).toBeGreaterThan(Math.max(...page1, PAGE));
    expect(contiguousFrom1(await loadedNums(page))).toBe(true);

    await ptt.sendKey(page, 'End');
    await userListActive(page);
    await expect.poll(async () => (await selected(page))?.num).toBe('60');
    expect(Math.max(...await loadedNums(page))).toBe(60);

    await ptt.sendKey(page, 'Home');
    await userListActive(page);
    await expect.poll(async () => (await selected(page))?.num).toBe('1');
    expect(await guardHits(page)).toEqual([]);
  });

  test('a number jump selects that user', async ({ page }) => {
    await bootUserList(page, { count: 60 });
    await enterUserList(page);
    await ptt.sendKey(page, '5');
    await page.locator('[data-list-input]').fill('50');
    await page.locator('[data-list-input]').press('Enter');
    await expect.poll(async () => (await selected(page))?.num).toBe('50');
    await userListActive(page);
    expect((await selected(page)).id).toBe('user050');
    expect(await guardHits(page)).toEqual([]);
  });

  // On a phone the digits come from the soft keyboard (text typed into the
  // terminal, which easy reading takes as keys) and Enter, ⌫ and Esc from the
  // toolbar's keypad (view.sendKeyAsUser); neither is a keydown the input sees.
  // While the number input is open they are its keys, never the list's: on
  // the user list Enter would query the selected user under the input.
  test('a number jump typed on a phone: the keypad edits, closes and commits the input', async ({ page }) => {
    await bootUserList(page, { count: 60 });
    await enterUserList(page);
    const input = page.locator('[data-list-input]');
    const keypad = (key) => page.locator(`#mobileKeypad [data-key="${key}"]`).tap();
    await page.locator('[data-key="__keys"]').tap();
    await page.focus('#t');
    await page.keyboard.insertText('5');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('5');
    // A character the soft keyboard still types into the terminal goes to the input.
    await page.focus('#t');
    await page.keyboard.insertText('0');
    await expect(input).toHaveValue('50');
    await input.focus();
    await page.keyboard.insertText('9');
    await keypad('Backspace');
    await expect(input).toHaveValue('50');
    await keypad('Enter');
    await expect(input).toHaveCount(0);
    await expect.poll(async () => (await selected(page))?.num).toBe('50');
    await userListActive(page);
    expect(await page.evaluate(() => window.__app.userQuery.phase)).toBe('idle');
    await expect(page.locator('[data-user-query-page]')).toHaveCount(0);

    await page.focus('#t');
    await page.keyboard.insertText('7');
    await expect(input).toHaveValue('7');
    await keypad('Escape');
    await expect(input).toHaveCount(0);
    expect((await selected(page)).num).toBe('50');
    expect(await guardHits(page)).toEqual([]);
  });

  test('f shows the friends view, an empty one as an empty-state row, and f again all users', async ({ page }) => {
    await bootUserList(page, { count: 30 });
    await enterUserList(page);
    await sendRaw(page, 'f');
    await expect(main(page).locator('[data-list-empty="friends"]')).toBeVisible();
    await userListActive(page);
    expect(await userListSurface(page)).toBe('list:friends');
    expect(await page.evaluate(() => window.__app.listSession.userListView())).toBe('friends');
    expect(await cards(page)).toEqual([]);
    await expect(main(page).locator('.listEmptyText')).not.toHaveText('');
    expect(await guardHits(page)).toEqual([]);

    await sendRaw(page, 'f');
    await expect.poll(async () => (await cards(page))[0]?.id).toBe('user001');
    await userListActive(page);
    expect(await page.evaluate(() => window.__app.listSession.userListView())).toBe('all');
    await expect(main(page).locator('[data-list-empty]')).toHaveCount(0);
    expect(await guardHits(page)).toEqual([]);
  });

  test('the friends view with friends online shows them as cards of their own numbering', async ({ page }) => {
    await bootUserList(page, { count: 30, friends: [3, 12] });
    await enterUserList(page);
    await sendRaw(page, 'F');
    await expect.poll(async () => (await cards(page)).map((c) => c.id)).toEqual(['user003', 'user012']);
    await userListActive(page);
    const shown = await cards(page);
    expect(shown.map((c) => c.num)).toEqual(['1', '2']);
    expect(shown.every((c) => c.friend)).toBe(true);
    await expect(main(page).locator('[data-list-empty]')).toHaveCount(0);
    expect(await guardHits(page)).toEqual([]);
  });
});
