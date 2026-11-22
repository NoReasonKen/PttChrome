// A board list opened from a board list's row, such as a class group, stacks
// like a board (#25): it slides in over the board list it was opened from,
// and Back from it reveals that list at once. Replays the recorded route
// (scn-stack-boardlist-folder.json): 分類看板 → 市民廣場, a group row opened, Back
// twice.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootScenario, loadCassette, waitFed } = require('../helpers/replay');
const { waitScrollStable } = require('../helpers/layout');
const { MAIN, boardListEngaged, holdBackReply, heldBack, watchReveals, revealedSinceWatch, withoutFolderReturnPrefetch } = require('../helpers/stack_routes');

const folder = loadCassette('scn-stack-boardlist-folder.json');
const BOARD_LAYER = '[data-stack-layer="boardList"]:not([data-stack-parked])';

// The board names on the engaged board list in `root`.
const boardsIn = (page, root) => page.locator(`${root} .listCard[data-list-board]`).evaluateAll(
  cards => cards.map(card => card.dataset.listBoard));

// The engaged list shows `board` among its entries.
const listShows = (page, board) => expect.poll(() => boardsIn(page, MAIN)).toContain(board);

test('a group opened from a board list stacks over it, and Back reveals that list at once', async ({ page }) => {
  const route = withoutFolderReturnPrefetch(folder);
  await bootScenario(page, ptt, route);
  await ptt.applyPrefs(page, folder.meta.prefs);
  await boardListEngaged(page);
  await listShows(page, 'OtherBBS');
  await ptt.sendKey(page, 'Enter');
  await listShows(page, 'FPGinPTT');
  await boardListEngaged(page);
  // The open slid in and ended: the list it came from waits hidden below.
  await expect(page.locator('[data-stack-layer]:not([data-stack-parked])')).toHaveCount(0, { timeout: 10000 });

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
  await waitFed(page, route.steps.length);
  expect(await revealedSinceWatch(page)).toBe(false);
});

test('Back keeps the parent board list when only a description changes', async ({ page }) => {
  // PTT's returning pages have the same numbers and board identities, but a
  // newer description. Keep the opening pages unchanged.
  const changed = structuredClone(folder);
  for (const step of changed.steps.slice(6, 9)) {
    const bytes = Buffer.from(step.recv, 'base64').toString('latin1');
    expect(bytes).toContain('PCman');
    step.recv = Buffer.from(bytes.replaceAll('PCman', 'XXman'), 'latin1').toString('base64');
  }

  await bootScenario(page, ptt, withoutFolderReturnPrefetch(changed));
  await ptt.applyPrefs(page, changed.meta.prefs);
  await boardListEngaged(page);
  await listShows(page, 'OtherBBS');
  const view = page.locator(`${MAIN} .listBodyView`);
  const box = await view.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 160);
  await waitScrollStable(page, `${MAIN} .listBodyView`);
  await boardListEngaged(page);
  const snapshot = () => page.locator(MAIN).evaluate(main => ({
    rows: [...main.querySelectorAll('.listCard[data-list-board]')].map(card => ({
      board: card.dataset.listBoard,
      mark: card.dataset.listMark || '',
      text: card.textContent,
    })),
    selected: window.__app.boardListSession._selectedNum,
    scroll: main.querySelector('.listBodyView').scrollTop,
  }));
  const before = await snapshot();
  expect(before.scroll).toBeGreaterThan(0);
  expect(before.rows.some(row => row.text.includes('PCman'))).toBe(true);

  await ptt.sendKey(page, 'Enter');
  await listShows(page, 'FPGinPTT');
  await boardListEngaged(page);
  await holdBackReply(page);
  await ptt.sendKey(page, 'q');
  await heldBack(page);
  await expect(page.locator(BOARD_LAYER)).toContainText('PCman');
  await page.evaluate(() => window.__heldBack());
  await expect(page.locator(BOARD_LAYER)).toHaveCount(0, { timeout: 10000 });
  await boardListEngaged(page);
  expect(await snapshot()).toEqual(before);

  // Answer the real refresh transaction with a keyword prompt and the updated
  // full screen. Later positioning requests receive the corresponding page.
  await page.evaluate(({ landing, end }) => {
    const send = window.__stubWSSent;
    let refreshing = false;
    const feed = bytes => setTimeout(() => window.__app.onData(atob(bytes)), 0);
    window.__stubWSSent = data => {
      const key = data.replace(/\x0c$/, '');
      if (key === '/') {
        refreshing = true;
        const text = '請輸入看板中文關鍵字';
        let bytes = '';
        for (const ch of text) {
          const c = ch.charCodeAt(0);
          bytes += String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
        }
        setTimeout(() => window.__app.onData('\x1b[23;1H\x1b[2K' + bytes + '\x1b[23;1H'), 0);
      } else if (refreshing && key === '\r') {
        feed(landing);
      } else if (refreshing && /^\d+\r$/.test(key)) {
        feed(key === '18\r' ? end : landing);
      } else {
        send(data);
      }
    };
  }, { landing: changed.steps[8].recv, end: changed.steps[7].recv });
  await page.keyboard.press('F5');
  await expect(page.locator(`${MAIN} .listCard[data-list-board="PttExtra"]`)).toContainText('XXman');
  await boardListEngaged(page);
});
