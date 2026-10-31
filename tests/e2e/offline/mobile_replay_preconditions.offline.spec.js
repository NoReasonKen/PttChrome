const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, loadCassette, replayCassette, replayListCassette } = require('../helpers/replay');
const { MAIN, ARTICLE_CARD, bootArticleListAtCard, waitArticleOpened } = require('../helpers/stack_routes');

test.describe('recording geometry preflight', () => {
  test.use({ viewport: { width: 412, height: 850 } });

  test('an incompatible viewport rejects list replay before feeding its first frame', async ({ page }) => {
    await bootOffline(page, ptt);
    const before = await page.evaluate(() => window.__app.buf.getRowText(0));
    await expect(replayListCassette(page, loadCassette('cchat-list-nav')))
      .rejects.toThrow(/cassette 80x24.*terminal 80x\d+.*viewport 412x850/);
    expect(await page.evaluate(() => window.__app.buf.getRowText(0))).toBe(before);
    expect(await page.evaluate(() => window.__replay)).toBeUndefined();
  });

  test('native static replay can explicitly allow unused space in a larger terminal', async ({ page }) => {
    await bootOffline(page, ptt);
    const rows = await page.evaluate(() => window.__app.buf.rows);
    expect(rows).toBeGreaterThan(24);
    await replayCassette(page, loadCassette('cchat-list-nav'), { easyReading: false, allowLargerTerminal: true });
    expect(await page.evaluate(() => window.__app.buf.rows)).toBe(rows);
    expect(await page.evaluate(() => window.__replay.fed)).toBeGreaterThan(0);
  });

  test('article reading stays strict even if the native-only exception is requested', async ({ page }) => {
    await bootOffline(page, ptt);
    await expect(replayCassette(page, loadCassette('cchat-list-nav'), { easyReading: true, allowLargerTerminal: true }))
      .rejects.toThrow(/Replay terminal size mismatch/);
  });
});

test('article readiness waits for navigation instead of the shared gesture class', async ({ page }) => {
  await bootArticleListAtCard(page);
  await expect(page.locator(MAIN)).toHaveClass(/articleHorizontalGestures/);
  await expect(waitArticleOpened(page, { timeout: 250 })).rejects.toThrow(/Timeout/);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(2);
  await page.locator(ARTICLE_CARD).first().tap();
  await waitArticleOpened(page);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(3);
});
