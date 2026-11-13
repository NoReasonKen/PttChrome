const { test, expect } = require('@playwright/test');
const { gestureSent } = require('../helpers/article_gestures');
const {
  bootNestedShortcutSearch, nativeBack, visibleText, waitArticle, waitList, readToMiddle, topLine, waitIdle, tapShortcut
} = require('../helpers/article_shortcut_search');
const ptt = require('../helpers/ptt');
const { MAIN, recordHints, recordedHints } = require('../helpers/stack_routes');
const { recordSearchTaps, attachSearchTapFailure } = require('../helpers/search_tap_diagnostics');

test.afterEach(async ({ page }, info) => attachSearchTapFailure(page, info));

// The real screen, not a prepared list layer kept underneath it.
const SCREEN = `${MAIN} #mainContainer`;

const tapCard = async (page, title) => {
  await expect(page.locator(`${SCREEN} .listBodyView`)).toBeVisible();
  await page.locator(`${SCREEN} .listCard`, { hasText: title }).locator('.listCardBody').tap();
};

const MISSING = 'The source article could not be verified or was deleted';
const hinted = page => recordedHints(page).then(hints => hints.some(hint => hint.includes(MISSING)));

test('a deleted nested source stays shown with a notice, and Back keeps the earlier origins', async ({ page }) => {
  await bootNestedShortcutSearch(page);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await tapShortcut(page, 'thread');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
  await page.evaluate(() => window.__shortcutServer.state.deleted.add('1gIeu-3B'));
  await recordHints(page);

  await nativeBack(page);
  await expect.poll(() => hinted(page), { timeout: 15000 }).toBe(true);
  await waitIdle(page);
  await nativeBack(page);
  await waitList(page, { has: ['Alpha topic', 'Re: [Talk] Beta topic'] });
  await nativeBack(page);
  await waitList(page, { has: ['Alpha topic'], lacks: ['Re: [Talk] Beta topic', 'Delta topic'] });
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
});

test('an unrelated search from the search sheet replaces the route instead of borrowing it by board name', async ({ page }) => {
  await bootNestedShortcutSearch(page);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await page.locator('[data-key="__search"]').tap();
  const input = page.locator('input[name="searchKeyword"]');
  await input.fill('Beta');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await waitList(page, { has: ['□ [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic'] });
  await expect.poll(() => page.evaluate(() => window.__app.searchInFlight)).toBe(false);

  const sent = (await gestureSent(page)).length;
  await nativeBack(page);
  // Native Back leaves the unrelated results; no source article is reopened
  // (no AID jump goes out).
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  expect((await gestureSent(page)).slice(sent)).not.toContain('#');
  expect(await visibleText(page)).not.toContain('Alpha line 04:');
});

test('a deleted author-search source still rebuilds its author results before stopping on the board list', async ({ page }) => {
  await bootNestedShortcutSearch(page);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await tapShortcut(page, 'thread');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
  await nativeBack(page);
  await waitArticle(page, 'Beta');
  await page.evaluate(() => window.__shortcutServer.state.deleted.add('1gIeu-3A'));
  await recordHints(page);

  // The author query does not need its deleted source article.
  await nativeBack(page);
  await waitList(page, { has: ['□ [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic'] });

  await nativeBack(page);
  await expect.poll(() => hinted(page), { timeout: 15000 }).toBe(true);
  await waitIdle(page);
  await nativeBack(page);
  await waitList(page, { has: ['Beta topic', 'Delta topic'] });
});

test('an in-article search key in a result article keeps the route', async ({ page }) => {
  await bootNestedShortcutSearch(page);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await ptt.sendKey(page, 'Enter');
  await waitArticle(page, 'Beta');
  // Inside an article `/` is PTT's in-article text search, not a board search.
  await ptt.sendKey(page, '/');
  await waitIdle(page);

  await nativeBack(page);
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
});

// The easy-reading list (cards) owns every list screen,
// including search results and rebuilt results. Result articles open by tap.
test.describe('with the easy-reading list', () => {

  test('single-level author and thread searches return to the source position', async ({ page }) => {
    await bootNestedShortcutSearch(page);
    const position = await readToMiddle(page);
    await tapShortcut(page, 'author');
    await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
    await expect(page.locator(`${SCREEN} .listBodyView`)).toBeVisible();
    await tapCard(page, '[Talk] Beta topic');
    await waitArticle(page, 'Beta');
    await nativeBack(page);
    await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
    await nativeBack(page);
    await waitArticle(page, 'Alpha');
    await expect.poll(() => topLine(page)).toBe(position);

    await tapShortcut(page, 'thread');
    await waitList(page, { has: ['Alpha topic'], lacks: ['Beta topic', 'Delta topic'] });
    await nativeBack(page);
    await waitArticle(page, 'Alpha');
    await expect.poll(() => topLine(page)).toBe(position);
  });

  test('mixed exploration unwinds one step at a time to the first source position', async ({ page }) => {
    await recordSearchTaps(page, () => bootNestedShortcutSearch(page));
    const position = await readToMiddle(page);
    await tapShortcut(page, 'author');
    await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
    await tapCard(page, '[Talk] Beta topic');
    await waitArticle(page, 'Beta');
    await tapShortcut(page, 'thread');
    await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
    await tapCard(page, 'Re: [Talk] Beta topic');
    await waitArticle(page, 'Charlie');
    await tapShortcut(page, 'author');
    await waitList(page, { has: ['Re: [Talk] Beta topic', 'Delta topic'], lacks: ['Alpha topic', '□ [Talk] Beta topic'] });
    await tapCard(page, 'Delta topic');
    await waitArticle(page, 'Delta');

    await nativeBack(page);
    await waitList(page, { has: ['Delta topic'], lacks: ['Alpha topic'] });
    await nativeBack(page);
    await waitArticle(page, 'Charlie');
    await nativeBack(page);
    await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic'] });
    await expect(page.locator(`${SCREEN} .listBodyView`)).toBeVisible();
    await nativeBack(page);
    await waitArticle(page, 'Beta');
    await nativeBack(page);
    await waitList(page, { has: ['Alpha topic', '□ [Talk] Beta topic'], lacks: ['Re: [Talk] Beta topic'] });
    await nativeBack(page);
    await waitArticle(page, 'Alpha');
    await expect.poll(() => topLine(page)).toBe(position);

    // The route is spent: Back from the first source is ordinary article exit.
    const sent = (await gestureSent(page)).length;
    await nativeBack(page);
    await waitList(page, { has: ['Delta topic', 'Alpha topic'] });
    expect((await gestureSent(page)).slice(sent)).toMatch(/^\x1b\[D/);
  });
});
