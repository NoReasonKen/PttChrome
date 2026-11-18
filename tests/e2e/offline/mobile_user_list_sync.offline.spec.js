// The online user list (#199) keeps showing PTT's current rows, and the
// selected card's `>` and its highlight stay on one card.
//
// PTT lists users from a snapshot it takes again, sorted, when it reloads a
// page 10 s or more after the last one (talk.c#pickup), so a login or a
// logout moves every user below it. The rows easy reading holds from the old
// snapshot must not mix with PTT's new pages.
//
// The list is the controlled PTT of helpers/user_list.js with invented users.
// Ctrl+Z u is sent to PTT as it is: the entrance is
// mobile_user_list_entry.offline.spec.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { waitRectStable } = require('../helpers/layout');
const { bootUserList, sendRaw, userListActive } = require('../helpers/user_list');

const main = (page) => page.locator('.main:not([data-stack-layer])');
const idle = (page) => page.waitForFunction(() => window.__app.commandQueue.idle && !window.__app.buf._settleTimer);
// The user cards shown, with the card that carries `>` and the highlighted one.
const cards = (page) => main(page).evaluate((el) => [...el.querySelectorAll('.listCard')]
  .filter((card) => /\d/.test(card.querySelector('.listCardNum')?.textContent || ''))
  .map((card) => ({
    num: +card.querySelector('.listCardNum').textContent.trim(),
    id: card.getAttribute('data-user-id'),
    mark: card.querySelector('.listCardTitle .listCardCursor')?.textContent === '>',
    lit: !!card.querySelector('.listCardBody.cursorBrighten'),
  })));
const loaded = (page) => page.evaluate(() => (window.__app.buf.listLineNums || []).filter((n) => n != null).length);
const pttIds = (page) => page.evaluate(() => window.__userListServer.users.map((u) => u.id));

// Every card is PTT's current row at its number, and no user shows twice.
async function expectPttRows(page) {
  const shown = await cards(page);
  const ids = await pttIds(page);
  expect(shown.filter((c) => ids[c.num - 1] !== c.id).map((c) => c.num)).toEqual([]);
  const seen = shown.map((c) => c.id);
  expect(seen.filter((id, i) => seen.indexOf(id) !== i)).toEqual([]);
}

async function enterAndFill(page, count) {
  await bootUserList(page, { count });
  await sendRaw(page, '\x1au');
  await userListActive(page);
  // ↓ near the end of the rows held reads the next pages.
  for (let i = 0; i < 5; i++) await ptt.sendKey(page, 'ArrowDown');
  await expect.poll(() => loaded(page)).toBe(count);
  await idle(page);
}

// Two users log in at the top of PTT's sort: every user moves down two rows
// in the snapshot PTT takes next.
const twoLogIn = (page) => page.evaluate(() => {
  const { users } = window.__userListServer;
  users.unshift({ ...users[1], id: 'newcomer1', nick: '新來的' }, { ...users[2], id: 'newcomer2', nick: '新來的' });
});

test.describe('the user list follows PTT\'s snapshot', () => {
  test('after a query, PTT\'s re-sorted page replaces the old rows and the selection stays on its user', async ({ page }) => {
    await enterAndFill(page, 60);
    await twoLogIn(page);
    // A query and back: PTT draws its list again from the new snapshot.
    await main(page).locator('.listCard[data-user-id="user010"]').tap();
    await page.waitForFunction(() => window.__app.userQuery.phase === 'shown' && window.__app.commandQueue.idle);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    await userListActive(page);
    await idle(page);
    await expectPttRows(page);
    // The rows above PTT's page are read again from the new snapshot.
    await expect.poll(() => loaded(page)).toBeGreaterThanOrEqual(60);
    await idle(page);
    await expectPttRows(page);
    const marked = (await cards(page)).filter((c) => c.mark);
    expect(marked).toEqual([{ num: 12, id: 'user010', mark: true, lit: true }]);
  });

  test('a selected user who logged off leaves the selection at the same number', async ({ page }) => {
    await enterAndFill(page, 60);
    await ptt.sendKey(page, 'Home');
    await idle(page);
    for (let i = 0; i < 9; i++) await ptt.sendKey(page, 'ArrowDown');
    expect((await cards(page)).filter((c) => c.mark).map((c) => c.id)).toEqual(['user010']);
    await page.evaluate(() => {
      const { users } = window.__userListServer;
      users.splice(users.findIndex((u) => u.id === 'user010'), 1);
    });
    // `q` asks PTT for user010, who is no longer online: PTT draws its list
    // again, from the new snapshot.
    await ptt.sendKey(page, 'q');
    await page.waitForFunction(() => window.__app.userQuery.phase === 'idle');
    await userListActive(page);
    await expect.poll(() => loaded(page)).toBeGreaterThanOrEqual(59);
    await idle(page);
    await expectPttRows(page);
    const marked = (await cards(page)).filter((c) => c.mark).map((c) => c.num);
    expect(marked).toEqual([10]);
  });
});

test.describe('the selected card', () => {
  // A tap on a key of the phone's keypad also reaches the page as a mouse
  // move, at the keypad, below the list.
  test('keeps `>` and the highlight on one card while the keypad\'s arrows move it', async ({ page }) => {
    await enterAndFill(page, 60);
    await ptt.sendKey(page, 'Home');
    await idle(page);
    await page.locator('[data-key="__keys"]').tap();
    await waitRectStable(page, '#mobileKeypad');
    const steps = [];
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp']) {
      await page.locator(`[data-key="${key}"]`).tap();
      await idle(page);
      const shown = await cards(page);
      steps.push({ mark: shown.filter((c) => c.mark).map((c) => c.num), lit: shown.filter((c) => c.lit).map((c) => c.num) });
    }
    expect(steps).toEqual([
      { mark: [2], lit: [2] },
      { mark: [3], lit: [3] },
      { mark: [4], lit: [4] },
      { mark: [5], lit: [5] },
      { mark: [4], lit: [4] },
    ]);
  });
});
