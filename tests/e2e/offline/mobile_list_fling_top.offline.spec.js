// A fast fling up an easy-reading list stops at its first row (#255).
//
// While the top of a list is not known yet, the list keeps blank space above
// its first held row (the top reserve, list_scroll.listReservePx), so rows
// read in above it appear in place without moving the reader. A fling fast
// enough reached #1 with part of that space still above it, and the space
// cannot be taken away under the reader once it is shown
// (screen._syncListReserve). So rows read in past what the reserve holds drop
// it, and it is never more than the rows that can still be above: every list
// ListSession reads is numbered by position from 1 (read.c's read_renderer
// shows the view index + 1, search results included; talk.c's pickup numbers
// the users).
//
// The lists are the controlled PTTs of helpers/mail_box.js,
// helpers/thread_jump.js and helpers/user_list.js with invented text. The
// mail and article lists open on their last rows; the user list is read down
// until its early rows are dropped. Either way the top is unknown when the
// fling starts.
const { test, expect } = require('@playwright/test');
const { touchDrag } = require('../helpers/real_input');
const { revealArticleDrawer } = require('../helpers/article_gestures');
const { bootMailbox, mailListActive } = require('../helpers/mail_box');
const { bootThreadBoard, listActive } = require('../helpers/thread_jump');
const { bootUserList, sendRaw, userListActive } = require('../helpers/user_list');

const VIEW = '.main:not([data-stack-layer]) .listBodyView';

// The rows held, whether the top is known, and where card #1 sits below the
// list's top edge (null while it is not shown).
const state = (page) => page.evaluate((sel) => {
  const app = window.__app;
  const nums = (app.buf.listLineNums || []).filter((n) => n != null);
  const view = document.querySelector(sel);
  const first = [...view.querySelectorAll('.listCard')]
    .find((card) => card.querySelector('.listCardNum')?.textContent.trim() === '1');
  return {
    first: nums[0],
    edgeUp: app.listSession._edgeUp,
    idle: app.commandQueue.idle,
    gap: first ? Math.round(first.getBoundingClientRect().top - view.getBoundingClientRect().top) : null,
  };
}, VIEW);

// Fast upward flings, one after another, until the list holds #1, knows it
// is the top and shows card #1 no higher than its top edge (a fling can end
// with #1 still above the screen). No more after that: a pull at the top
// refreshes the list.
async function flingToTop(page) {
  const start = await state(page);
  expect(start.first).toBeGreaterThan(300);
  expect(start.edgeUp).toBe(false);
  let s = start;
  const atTop = (t) => t.first === 1 && t.edgeUp && t.idle && t.gap != null && t.gap >= 0;
  for (let i = 0; i < 200 && !atTop(s); i++) {
    await touchDrag(page, { x: 200, y: 90 }, { x: 200, y: 330 }, 3);
    s = await state(page);
  }
  expect(s).toMatchObject({ first: 1, edgeUp: true });
}

// Card #1 ends at the list's top edge: no blank space above it, also once the
// list is idle.
async function stopsAtFirstRow(page) {
  await expect.poll(async () => (await state(page)).gap, { timeout: 5000 }).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
  await expect.poll(() => page.locator(VIEW).evaluate((el) => el.style.getPropertyValue('--list-reserve'))).toBe('');
  expect((await state(page)).gap).toBe(0);
}

// Scroll to the end of the rows held, again and again, until rows up to
// #300 are dropped.
async function readDownPastEarlyRows(page) {
  for (let i = 0; i < 80 && !((await state(page)).first > 300); i++) {
    await page.locator(VIEW).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    // sleep-ok: the scroll event asks for the next pages before the queue is checked
    await page.waitForTimeout(150);
    await page.waitForFunction(() => window.__app.commandQueue.idle);
  }
}

test.describe('a fast fling up an easy-reading list stops at #1', () => {
  test('the online user list', async ({ page }) => {
    await bootUserList(page, { count: 1200 });
    await sendRaw(page, '\x1au');
    await userListActive(page);
    await readDownPastEarlyRows(page);
    await flingToTop(page);
    await stopsAtFirstRow(page);
  });

  test('the mail list', async ({ page }) => {
    await bootMailbox(page, { count: 1000 });
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    await flingToTop(page);
    await stopsAtFirstRow(page);
  });

  test('an article list', async ({ page }) => {
    await bootThreadBoard(page, { open: 1200, fromList: true, stayOnList: true });
    await flingToTop(page);
    await stopsAtFirstRow(page);
  });

  // Search results are numbered by their place among the results (read.c:
  // the view index + 1 in MODE_SELECT too), not by the articles' numbers.
  test('author search results', async ({ page }) => {
    // Article 601 is a filler's: the results are every article but the
    // thread's four, numbered 1–1196.
    await bootThreadBoard(page, { open: 601, fromList: true });
    await revealArticleDrawer(page);
    await page.locator('[data-article-shortcut="author"]').tap();
    await expect.poll(() => page.evaluate(() => window.__threadServer.state.byAuthor)).toBe('filler');
    await listActive(page);
    await expect.poll(() => page.locator(VIEW).innerText()).toContain('1196');
    await flingToTop(page);
    await stopsAtFirstRow(page);
    // #1 of the results is the board's article 2.
    const first = page.locator(VIEW).locator('.listCard').filter({ has: page.locator('.listCardNum', { hasText: /^\s*1\s*$/ }) });
    await expect(first).toContainText(/Filler 2(?!\d)/);
  });
});
