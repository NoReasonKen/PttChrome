// Pull-to-refresh waits for an easy-reading list's top (#278).
//
// A list whose rows above the first held one are still to be read can sit at
// scrollTop 0 (the blank top reserve). A drag down there is the reader
// reaching for those rows, not a refresh. Pulling at #1 still refreshes
// (mobile_refresh.offline.spec.js).
const { test, expect } = require('@playwright/test');
const { touchDrag } = require('../helpers/real_input');
const { bootThreadBoard } = require('../helpers/thread_jump');

const VIEW = '.main:not([data-stack-layer]) .listBodyView';

test('no refresh from scrollTop 0 while the rows above are unread', async ({ page }) => {
  await bootThreadBoard(page, { open: 1200, fromList: true, stayOnList: true });
  const state = () => page.evaluate((sel) => ({
    first: (window.__app.buf.listLineNums || []).find((n) => n != null),
    edgeUp: window.__app.listSession._edgeUp,
    top: document.querySelector(sel).scrollTop,
  }), VIEW);
  expect(await state()).toMatchObject({ edgeUp: false });
  expect((await state()).first).toBeGreaterThan(300);

  // PTT answers nothing from here: the rows above stay unread.
  await page.evaluate(() => {
    window.__sent = [];
    window.__stubWSSent = (s) => window.__sent.push(s);
  });
  await page.locator(VIEW).evaluate((el) => { el.scrollTop = 0; });
  expect((await state()).top).toBe(0);
  const box = await page.locator(VIEW).boundingBox();
  const x = box.x + box.width / 2;
  await touchDrag(page, { x, y: box.y + 40 }, { x, y: box.y + 300 });
  // sleep-ok: a refresh would be sent within a frame or two of the release
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__sent.join(''))).not.toMatch(/\bs/);
  expect(await page.evaluate(() => window.__app.screenRefresh.cooldownLeftMs())).toBe(0);
  await expect(page.locator('.pullRefreshIndicator.visible')).toHaveCount(0);
});
