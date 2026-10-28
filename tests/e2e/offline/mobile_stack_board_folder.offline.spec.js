// A board list opened from a board list's row, such as a class group, stacks
// like a board (#25): it slides in over the board list it was opened from,
// and Back from it reveals that list at once. Replays the recorded route
// (scn-stack-boardlist-folder.json): 分類看板 → 市民廣場, a group row opened, Back
// twice.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootScenario, loadCassette, waitFed } = require('../helpers/replay');
const { MAIN, boardListEngaged, holdBackReply, heldBack, watchReveals, revealedSinceWatch } = require('../helpers/stack_routes');

const folder = loadCassette('scn-stack-boardlist-folder.json');
const BOARD_LAYER = '[data-stack-layer="boardList"]';

// The board names on the engaged board list in `root`.
const boardsIn = (page, root) => page.locator(`${root} .listCard[data-list-board]`).evaluateAll(
  cards => cards.map(card => card.dataset.listBoard));

// The engaged list shows `board` among its entries.
const listShows = (page, board) => expect.poll(() => boardsIn(page, MAIN)).toContain(board);

test('a group opened from a board list stacks over it, and Back reveals that list at once', async ({ page }) => {
  await bootScenario(page, ptt, folder);
  await ptt.applyPrefs(page, folder.meta.prefs);
  await boardListEngaged(page);
  await listShows(page, 'OtherBBS');
  await ptt.sendKey(page, 'Enter');
  await listShows(page, 'FPGinPTT');
  await boardListEngaged(page);
  // The open slid in and ended: the list it came from waits hidden below.
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0, { timeout: 10000 });

  await holdBackReply(page);
  const release = () => page.evaluate(() => window.__heldBack());
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await expect(page.locator(BOARD_LAYER)).toBeVisible();
  expect(await page.evaluate(() => window.__app.articleGestures.stack.handingOff)).toBe(true);
  expect(await boardsIn(page, BOARD_LAYER)).toContain('OtherBBS');
  await release();
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await listShows(page, 'OtherBBS');
  await boardListEngaged(page);

  // The class list above the group's list was never stacked.
  await watchReveals(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitFed(page, folder.steps.length);
  expect(await revealedSinceWatch(page)).toBe(false);
});
