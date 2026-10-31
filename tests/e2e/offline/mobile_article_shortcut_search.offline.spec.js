const { test, expect } = require('@playwright/test');
const { bootGestureArticle, revealArticleDrawer, gestureSent, DRAWER } = require('../helpers/article_gestures');
const { bootShortcutSearch, searchAuthor, nativeBack, openSearchResult, visibleText, waitSearchResults } = require('../helpers/article_shortcut_search');

test('the author shortcut starts a direct serialized search without an editable search dialog', async ({ page }) => {
  await bootGestureArticle(page);
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="author"]').tap();
  await expect(page.locator(DRAWER)).toHaveCount(0);
  await expect(page.locator('input[name="searchKeyword"]')).toHaveCount(0);
  // The fixture has no article URL, so the existing identity lookup asks Q first.
  await expect.poll(() => gestureSent(page)).toBe('Q');
});

for (const filtered of [false, true]) {
  test(`author search uses the whole board and returns through results to the source (filtered origin: ${filtered})`, async ({ page }) => {
    await bootShortcutSearch(page, { filtered });
    await searchAuthor(page);
    await waitSearchResults(page);
    const beforeOpen = await gestureSent(page);
    expect(beforeOpen).toContain('#1gIeu-3A\r');
    expect(beforeOpen).toContain('a\f');
    expect(beforeOpen).toContain('test\r');
    if (filtered) expect(beforeOpen.indexOf('\x1b[D')).toBeLessThan(beforeOpen.indexOf('a\f'));
    await openSearchResult(page);
    await nativeBack(page);
    await expect.poll(() => visibleText(page)).toContain('Source article');
    await nativeBack(page);
    await expect.poll(() => visibleText(page)).toContain('Original reading position.');
    await expect(page.locator('input[name="searchKeyword"]')).toHaveCount(0);
  });
}

test('an empty author search restores the source and explains the result', async ({ page }) => {
  await bootShortcutSearch(page, { empty: true });
  await searchAuthor(page);
  // The source covers the screen until it is open again, in easy reading
  // throughout (#83).
  await expect.poll(() => page.locator('body').innerText()).toContain('No matching articles. Returned to the source article.');
  await expect.poll(() => visibleText(page)).toContain('Original reading position.');
  await expect(page.locator('#mobileAppBar .mobileAppBarTitle')).toContainText('Source article');
});

test('a deleted origin never opens a replacement article', async ({ page }) => {
  await bootShortcutSearch(page, { deleted: true });
  await searchAuthor(page);
  await waitSearchResults(page);
  await nativeBack(page);
  await expect.poll(() => page.locator('body').innerText(), { timeout: 15000 }).toContain('The source article could not be verified or was deleted');
  expect(await visibleText(page)).not.toContain('Original reading position.');
  expect(await visibleText(page)).toContain('看板《Test》');
});

test('input cannot submit or replace a query while the native prompt is still loading', async ({ page }) => {
  await bootShortcutSearch(page, { pausePrompt: true });
  await searchAuthor(page);
  await expect.poll(() => gestureSent(page)).toContain('a\f');
  const sent = await gestureSent(page);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  expect(await gestureSent(page)).toBe(sent);
  expect(sent).not.toContain('test\r');
});

test('an unrecognized native prompt stops without sending the author as commands', async ({ page }) => {
  await bootShortcutSearch(page, { wrongPrompt: true });
  await searchAuthor(page);
  await expect.poll(() => page.locator('body').innerText(), { timeout: 12000 }).toContain('Article search stopped because the current screen could not be verified');
  expect(await gestureSent(page)).not.toContain('test\r');
});
