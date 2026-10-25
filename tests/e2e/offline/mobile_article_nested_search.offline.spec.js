const { test, expect } = require('@playwright/test');
const { gestureSent } = require('../helpers/article_gestures');
const {
  bootNestedShortcutSearch, nativeBack, visibleText, waitArticle, waitList, waitIdle, tapShortcut
} = require('../helpers/article_shortcut_search');
const ptt = require('../helpers/ptt');

const bodyText = page => page.locator('body').innerText();

// The first article row at the top of the reading viewport.
const topLine = page => page.evaluate(() => {
  const view = window.__app.view;
  const row = document.querySelector(`#mainContainer [type="bbsrow"][srow="${Math.floor(view.currentLineIndex())}"]`);
  return row ? row.textContent.trim().slice(0, 16) : null;
});

async function readToMiddle(page) {
  await page.evaluate(() => {
    const display = window.__app.view.mainDisplay;
    display.scrollTop = Math.round((display.scrollHeight - display.clientHeight) / 2);
  });
  await expect.poll(() => topLine(page)).toMatch(/^Alpha line (0[5-9]|1\d)/);
  return topLine(page);
}

// A -> same author -> B -> same thread -> C -> same author -> D.
async function exploreThreeLevels(page) {
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await ptt.sendKey(page, 'Enter');
  await waitArticle(page, 'Beta');
  await tapShortcut(page, 'thread');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
  await ptt.sendKey(page, 'Enter');
  await waitArticle(page, 'Charlie');
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Re: [Talk] Beta topic', 'Delta topic'], lacks: ['Alpha topic', '□ [Talk] Beta topic'] });
  await ptt.sendKey(page, 'Enter');
  await waitArticle(page, 'Delta');
}

test('mixed author and thread exploration unwinds one step at a time to the first source position', async ({ page }) => {
  await bootNestedShortcutSearch(page);
  const position = await readToMiddle(page);
  await exploreThreeLevels(page);

  await nativeBack(page);
  await waitList(page, { has: ['Delta topic'], lacks: ['Alpha topic'] });
  await nativeBack(page);
  await waitArticle(page, 'Charlie');
  await nativeBack(page);
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic', 'Delta topic'] });
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
  expect((await gestureSent(page)).slice(sent)).toBe('\x1b[D');
});

test('a deleted nested source stops on its board list and keeps the earlier origins', async ({ page }) => {
  await bootNestedShortcutSearch(page);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'] });
  await ptt.sendKey(page, 'Enter');
  await waitArticle(page, 'Beta');
  await tapShortcut(page, 'thread');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
  await page.evaluate(() => window.__shortcutServer.state.deleted.add('1gIeu-3B'));

  await nativeBack(page);
  await expect.poll(() => bodyText(page), { timeout: 15000 }).toContain('The source article could not be verified or was deleted');
  await waitList(page, { has: ['Alpha topic', 'Re: [Talk] Beta topic'] });
  await expect(page.locator('#mainContainer')).toContainText('文章列表');

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
  // Native Back leaves the unrelated results; no source article is reopened.
  await expect.poll(async () => (await gestureSent(page)).slice(sent)).toBe('\x1b[D');
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  expect(await visibleText(page)).not.toContain('Alpha line 04:');
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

// The reader's default: the easy-reading list (cards) owns every list screen,
// including search results and rebuilt results. Result articles open by tap.
test.describe('with the easy-reading list', () => {
  const tapCard = async (page, title) => {
    await expect(page.locator('#mainContainer .listBodyView')).toBeVisible();
    await page.locator('#mainContainer .listCard', { hasText: title }).locator('.listCardBody').tap();
  };

  test('single-level author and thread searches return to the source position', async ({ page }) => {
    await bootNestedShortcutSearch(page, { easyList: true });
    const position = await readToMiddle(page);
    await tapShortcut(page, 'author');
    await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
    await expect(page.locator('#mainContainer .listBodyView')).toBeVisible();
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
    await bootNestedShortcutSearch(page, { easyList: true });
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
    await expect(page.locator('#mainContainer .listBodyView')).toBeVisible();
    await nativeBack(page);
    await waitArticle(page, 'Beta');
    await nativeBack(page);
    await waitList(page, { has: ['Alpha topic', '□ [Talk] Beta topic'], lacks: ['Re: [Talk] Beta topic'] });
    await nativeBack(page);
    await waitArticle(page, 'Alpha');
    await expect.poll(() => topLine(page)).toBe(position);
  });
});
