// The online user list (#199) keeps showing PTT's current rows, and the
// selected card's `>` and its highlight stay on one card.
//
// PTT lists users from a snapshot it takes again when it reloads a page 10 s
// or more after the last one (talk.c#pickup), so a login or a logout moves
// every user below it. The rows easy reading holds from the old snapshot
// must not mix with PTT's new pages. Within one snapshot PTT's pages overlap:
// a page skips the users hidden from the reader and reads on, and the next
// page starts with its last users again.
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
const sentCount = (page) => page.evaluate(() => window.__userListSent.length);
// The ID PTT lists at each number of `nums`, on the page it draws there.
const pttIdsAt = (page, nums) => page.evaluate((nums) => {
  const { pageRows, PAGE } = window.__userListServer;
  return nums.map((num) => {
    const top = Math.floor((num - 1) / PAGE) * PAGE + 1;
    const user = pageRows(top)[num - top];
    return user ? user.id : null;
  });
}, nums);
// Nothing more is sent to PTT for a while: the reading on stopped.
async function readingStops(page) {
  let last = -1;
  await expect.poll(async () => {
    const n = await page.evaluate(() => (window.__app.commandQueue.idle ? window.__userListSent.length : -1));
    const same = n >= 0 && n === last;
    last = n;
    return same;
  }, { intervals: [1000], timeout: 20000 }).toBe(true);
}
// Every fourth user is hidden from the reader.
const everyFourth = (count) => Array.from({ length: Math.floor(count / 4) }, (_, i) => 4 * (i + 1));

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
    // A query and back: PTT draws its list again from the new snapshot.
    await main(page).locator('.listCard[data-user-id="user010"]').tap();
    await page.waitForFunction(() => window.__app.userQuery.phase === 'shown' && window.__app.commandQueue.idle);
    // The users log in while PTT shows the query, so the list PTT draws on the
    // way back is the first page from the new snapshot. Before the query, the
    // tap can read on below the rows held (PgDn); from the new snapshot that
    // page lists users at numbers no row held has, and nothing tells it from
    // a page of the old one (userListPageDisagrees).
    await twoLogIn(page);
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

test.describe('reading on through PTT\'s pages', () => {
  test('pages that list users of the page above again read on only as far as the window needs', async ({ page }) => {
    // One user is logged in twice.
    await bootUserList(page, { count: 1200, hidden: everyFourth(1200), twins: [30] });
    await sendRaw(page, '\x1au');
    await userListActive(page);
    await idle(page);
    const before = await sentCount(page);
    await ptt.sendKey(page, 'ArrowDown');
    await readingStops(page);
    const pages = await page.evaluate((from) => window.__userListSent.slice(from)
      .filter((keys) => keys.includes('\x1b[6~')).length, before);
    expect(pages).toBeGreaterThan(0);
    expect(pages).toBeLessThanOrEqual(4);
    const shown = await cards(page);
    expect(shown.filter((c) => c.mark).map((c) => c.num)).toEqual([2]);
    // The rows held are PTT's, number by number, from user 1 on.
    const nums = await page.evaluate(() => window.__app.buf.listLineNums.filter((n) => n != null));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    const held = await page.evaluate(() => {
      const { listLines, listLineNums } = window.__app.buf;
      return listLineNums.map((n, i) => (n == null ? null : (listLines[i].map((c) => (c ? c.ch : " ")).join('').match(/^.{10}(\S+)/) || [])[1]))
        .filter((id) => id != null);
    });
    expect(held).toEqual(await pttIdsAt(page, nums));
  });

  test('a list that changes between reads settles once the reader stops', async ({ page }) => {
    await bootUserList(page, { count: 400, hidden: everyFourth(400), snapshotMs: 600 });
    await sendRaw(page, '\x1au');
    await userListActive(page);
    await idle(page);
    // Users keep logging in at the top of PTT's list; each read is of a new
    // snapshot.
    await page.evaluate(() => {
      const { users } = window.__userListServer;
      let n = 0;
      window.__logins = setInterval(() => {
        n++;
        users.unshift({ ...users[1], id: 'login' + n, nick: '新來的', hidden: false });
      }, 100);
    });
    for (const key of ['PageDown', 'PageDown', 'PageDown', 'PageUp', 'PageDown']) {
      await ptt.sendKey(page, key);
      await page.waitForTimeout(700); // sleep-ok: each read comes after PTT took a new snapshot (snapshotMs)
    }
    await readingStops(page);
    const settled = await sentCount(page);
    await page.waitForTimeout(2000); // sleep-ok: nothing more may be sent over this time
    expect(await sentCount(page)).toBe(settled);
    expect(await page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
    await page.evaluate(() => clearInterval(window.__logins));
    // One selected card, and no number listed twice.
    const shown = await cards(page);
    expect(shown.filter((c) => c.mark)).toHaveLength(1);
    const nums = await page.evaluate(() => window.__app.buf.listLineNums.filter((n) => n != null));
    expect(nums.filter((n, i) => nums.indexOf(n) !== i)).toEqual([]);
  });

  test('a list that changes on every page PTT draws stops being read again', async ({ page }) => {
    await bootUserList(page, { count: 400 });
    await sendRaw(page, '\x1au');
    await userListActive(page);
    for (let i = 0; i < 5; i++) await ptt.sendKey(page, 'ArrowDown');
    await readingStops(page);
    // From here a user logs in at the top before every page PTT draws, so
    // every page that lists a number held disagrees with the rows held.
    await page.evaluate(() => {
      const { users } = window.__userListServer;
      const send = window.__stubWSSent;
      let n = 0;
      window.__stubWSSent = (bytes) => {
        n++;
        users.unshift({ ...users[1], id: 'login' + n, nick: '新來的' });
        send(bytes);
      };
    });
    // A query and back: PTT draws its list again.
    await main(page).locator('.listCard[data-user-id="user010"]').tap();
    await page.waitForFunction(() => window.__app.userQuery.phase === 'shown' && window.__app.commandQueue.idle);
    await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
    await page.goBack();
    await userListActive(page);
    await readingStops(page);
    const settled = await sentCount(page);
    await page.waitForTimeout(2000); // sleep-ok: nothing more may be sent over this time
    expect(await sentCount(page)).toBe(settled);
    const shown = await cards(page);
    expect(shown.filter((c) => c.mark)).toHaveLength(1);
  });
});
