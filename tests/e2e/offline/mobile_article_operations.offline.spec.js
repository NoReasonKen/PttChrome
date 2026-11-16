// PttChrome's own operations over an easy-reading article (#209): copying the
// article's link, a long comment, a jump by article code, logging out. Each
// drives PTT through native screens; every painted frame shows the article,
// never PTT's grid. An operation that returns to the article leaves it at the
// reading position; one that fails holds the article with a message, and
// pull-to-refresh retries from what PTT shows (#193).
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { FAR_BOARD, bootThreadBoard, listActive } = require('../helpers/thread_jump');
const { watchHold, expectArticleHeld, pullDown } = require('../helpers/article_hold');
const { installPaintedFrameProbe } = require('../helpers/layout');

const body = num => `Body of article ${num} by`;

// Every painted frame: what the reading area shows (a cover over it, or the
// page itself), and whether it is the terminal grid.
async function watchFrames(page, num) {
  await installPaintedFrameProbe(page);
  await page.evaluate((text) => {
    const app = window.__app;
    const frames = window.__opFrames = [];
    const sample = () => {
      const main = document.querySelector('.main:not([data-stack-layer])');
      // The article's cover (hidden_article_route.coverWithArticle), not a
      // kept list layer below the page.
      const layer = [...document.querySelectorAll('[data-stack-layer]')].find(el => el.style.zIndex === '150');
      const grid = !layer && !!app.view._gridRender;
      frames.push({ grid, article: (layer || main).textContent.includes(text), functionMode: !!app.buf.easyReadingFunctionMode });
    };
    window.__stopOpFrames = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  }, `of article ${num}`);
  // Past login: the guard judges every frame from here (fails on a hit).
  await page.evaluate(() => {
    window.__nativeGridGuard.loggedIn = true;
    window.__nativeGridGuard.reset();
  });
}

async function stopFrames(page) {
  await page.waitForFunction((n) => window.__opFrames.length >= n, await page.evaluate(() => window.__opFrames.length + 4));
  return page.evaluate(() => {
    window.__stopOpFrames();
    return window.__opFrames;
  });
}

function expectArticleEveryFrame(frames) {
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    expect(frame.grid, JSON.stringify(frames)).toBe(false);
    expect(frame.article, JSON.stringify(frames)).toBe(true);
  }
}

const guardHits = page => page.evaluate(() => window.__nativeGridGuard.hits);

// An article whose last line carries its AID, so the app reads it without Q.
const SHORT = FAR_BOARD.map(a => (a.num === 600 ? { ...a, url: true } : a));
// A long article with its header, read from the middle.
const LONG = FAR_BOARD.map(a => (a.num === 600 ? { ...a, lines: 120, withHeader: true } : a));

test.describe('operations over an easy-reading article', () => {
  test.setTimeout(60000);

  test('copying the link keeps the article on every frame and returns to the reading position', async ({ page }) => {
    await bootThreadBoard(page, { open: 600, thread: LONG });
    await expect.poll(() => page.locator('.main').first().innerText()).toContain('Line 120 of article 600.');
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
    await page.evaluate(() => {
      const main = document.querySelector('.main:not([data-stack-layer])');
      main.scrollTop = main.scrollHeight / 2;
    });
    const line = await page.evaluate(() => window.__app.view.currentLineIndex());
    expect(line).toBeGreaterThan(10);
    await watchFrames(page, 600);

    expect(await page.evaluate(() => window.__app.deepLinkController.copyCurrentPostLink())).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__threadSent.join(''))).toContain('Q');
    await expect.poll(() => page.evaluate(() => {
      const app = window.__app;
      return !app.articleHold.holding && app.commandQueue.idle && !app.buf.easyReadingFunctionMode;
    }), { timeout: 15000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__app.view.currentLineIndex())).toBe(line);
    expectArticleEveryFrame(await stopFrames(page));
    expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(false);
    expect(await guardHits(page)).toEqual([]);
  });

  test('a long comment PTT never answers holds the article; pull-to-refresh presents it again', async ({ page }) => {
    await bootThreadBoard(page, { open: 600, thread: SHORT });
    await watchHold(page);
    await watchFrames(page, 600);
    await page.evaluate(() => {
      const reply = window.__stubWSSent;
      window.__stubWSSent = data => (window.__answer || !data.includes('X') ? reply(data) : window.__keys.push(data));
    });
    expect(await page.evaluate(() => window.__app.longPush.startPreflight({}))).toBe(true);
    await expectArticleHeld(page, {
      message: ['長推文未完成：下拉重新整理以重試。', 'The long comment did not finish. Pull down to refresh and retry.'],
      source: 'longPush', text: body(600)
    });
    expectArticleEveryFrame(await stopFrames(page));
    expect(await guardHits(page)).toEqual([]);

    // The long comment's own error dialog tells what happened; closed, the
    // held article is under it.
    await expect(page.getByTestId('longPushErrorMessage')).toBeVisible();
    await page.getByRole('dialog').getByRole('button').last().click();
    await expect(page.getByTestId('longPushErrorMessage')).toHaveCount(0);
    expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(true);

    await page.evaluate(() => { window.__answer = true; });
    await pullDown(page);
    await expect.poll(() => page.evaluate(() => window.__app.articleHold.held)).toBe(false);
    await expect(page.locator('.main').first()).toContainText(body(600));
  });

  test('a jump by article code PTT never answers holds the article', async ({ page }) => {
    await bootThreadBoard(page, { open: 600, thread: SHORT });
    await watchHold(page);
    await watchFrames(page, 600);
    const aid = await page.evaluate(() => window.__threadServer.aidOf(window.__threadServer.articles[39]));
    await page.evaluate(() => { window.__stubWSSent = data => window.__keys.push(data); });
    await page.evaluate(([aid]) => window.__app.aidNavigation.start(aid, 'Test'), [aid]);
    await expect.poll(() => page.evaluate(() => window.__app.aidNavigation.active), { timeout: 15000 }).toBe(false);
    expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(true);
    await expect(page.locator('[data-stack-layer]').first()).toContainText(body(600));
    expect(await page.evaluate(() => window.__wentNative)).toBe(false);
    expect(await page.evaluate(() => window.__hints.at(-1))).toMatch(/^AID 跳文失敗：.*，下拉重新整理以重試。$/);
    expect(await page.evaluate(() => window.__bugs)).toEqual([expect.objectContaining({ source: 'aidNavigation' })]);
    expectArticleEveryFrame(await stopFrames(page));
    expect(await guardHits(page)).toEqual([]);
  });

  test('logging out keeps the article; a logout PTT does not follow holds it', async ({ page }) => {
    await bootThreadBoard(page, { open: 600, thread: SHORT });
    await watchHold(page);
    await watchFrames(page, 600);
    expect(await page.evaluate(() => window.__app.startLogout())).toBe(true);
    // ← leaves the article to the list, where this board has no way out.
    await expect.poll(() => page.evaluate(() => window.__app.logout.active), { timeout: 15000 }).toBe(false);
    expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(true);
    expect(await page.evaluate(() => window.__hints.at(-1))).toMatch(/^登出失敗：.*，下拉重新整理以重試。$/);
    expect(await page.evaluate(() => window.__wentNative)).toBe(false);
    await expect(page.locator('[data-stack-layer]').first()).toContainText(body(600));
    expectArticleEveryFrame(await stopFrames(page));
    expect(await guardHits(page)).toEqual([]);

    await pullDown(page);
    await listActive(page);
    expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(false);
  });
});
