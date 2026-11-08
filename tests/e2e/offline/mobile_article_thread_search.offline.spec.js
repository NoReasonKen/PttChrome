const { test, expect } = require('@playwright/test');
const { revealArticleDrawer, gestureSent, PANEL } = require('../helpers/article_gestures');
const { bootShortcutSearch, nativeBack, openSearchResult, visibleText, hinted } = require('../helpers/article_shortcut_search');
const { waitScreenSettled } = require('../helpers/replay');
const { MAIN } = require('../helpers/stack_routes');
const ptt = require('../helpers/ptt');

test('all five article shortcuts appear in the agreed order with equal-height rows', async ({ page }) => {
  await bootShortcutSearch(page);
  await revealArticleDrawer(page);
  const buttons = page.locator(`${PANEL} button`);
  expect(await buttons.evaluateAll(nodes => nodes.map(node => node.dataset.articleShortcut))).toEqual(['thread', '[', '=', ']', 'author']);
  const heights = await buttons.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeCloseTo(heights[0], 1);
});

for (const filtered of [false, true]) {
  test(`same-thread search uses native subject matching and returns through its results (filtered origin: ${filtered})`, async ({ page }) => {
    await bootShortcutSearch(page, { filtered });
    await revealArticleDrawer(page);
    await page.locator('[data-article-shortcut="thread"]').tap();
    await expect.poll(() => hinted(page, 'Same-thread search results')).toBe(true);
    const sent = await gestureSent(page);
    expect(sent).toContain('#1gIeu-3A\r');
    expect(sent).toContain('S\f');
    expect(sent).not.toContain('/');
    if (filtered) expect(sent.indexOf('\x1b[D')).toBeLessThan(sent.indexOf('S\f'));
    await expect(page.locator('input[name="searchKeyword"]')).toHaveCount(0);
    await openSearchResult(page, { thread: true });
    await nativeBack(page);
    await expect(page.locator('#mainContainer .listBodyView')).toBeVisible();
    await expect.poll(() => visibleText(page)).toContain('Source article');
    await nativeBack(page);
    await expect.poll(() => visibleText(page)).toContain('Original reading position.');
  });
}

// The source article covers the screen until the easy-reading list presents
// the results, after a quiet wait. A result opened by Enter within that wait
// is shown at once with its swipes, not left under the cover until its bound.
test('a result opened before the results present shows at once with its swipes', async ({ page }) => {
  await bootShortcutSearch(page);
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="thread"]').tap();
  // The search has finished; its cover waits for the list to present.
  await page.waitForFunction(() => {
    const search = window.__app.articleShortcutSearch;
    return !search.active && !!search.cover;
  }, null, { polling: 'raf' });
  await ptt.sendKey(page, 'Enter');
  await waitScreenSettled(page, { 1: 'Re: [Test] Source article' });
  // Both follow the settle itself; the cover's bound is seconds away.
  await expect(page.locator(MAIN)).toHaveClass(/articleHorizontalGestures/, { timeout: 1000 });
  await expect(page.locator('#mobileAppBar .mobileAppBarTitle')).toContainText('Re: [Test] Source article', { timeout: 1000 });
  await expect(page.locator(`${MAIN} #mainContainer`)).toContainText('A matching result article.');
});

test('an empty same-thread search returns to the source with a notice', async ({ page }) => {
  await bootShortcutSearch(page, { empty: true });
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="thread"]').tap();
  await expect.poll(() => page.locator('body').innerText()).toContain('No matching articles. Returned to the source article.');
  await expect.poll(() => visibleText(page)).toContain('Original reading position.');
});
