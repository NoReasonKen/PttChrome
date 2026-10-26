const { test, expect } = require('@playwright/test');
const { gestureSent } = require('../helpers/article_gestures');
const {
  bootNestedShortcutSearch, nestedSessionAfterLogin, nativeBack, visibleText, waitArticle, waitList, readToMiddle, topLine, tapShortcut,
  tapCard, disconnectAndReconnect
} = require('../helpers/article_shortcut_search');
const { waitConnected } = require('../helpers/replay');
const { pauseClockNow } = require('../helpers/clock');
const ptt = require('../helpers/ptt');

// Search return history through interruption (docs/article-swipe-drawer-spec.md): the
// complete app with real touch, a controlled PTT board, a real socket close
// and reconnect, and a real page reload with the state the app stored.

const RESTORED = 'Search return history restored';
const INACTIVE = 'Search return history was not restored';
const RESUME_FAILED = 'The previous search results could not be restored';
const bodyText = page => page.locator('body').innerText();

async function reloadAndLogin(page, session = {}) {
  await page.reload();
  await waitConnected(page);
  await nestedSessionAfterLogin(page, session);
}

// After a reload the browser's Back traverses history entries the previous
// page left behind, which the back guard does not own; use the keyboard Back.
const keyboardBack = page => ptt.sendKey(page, 'ArrowLeft');

test('ordinary article recovery without searches restores a known article and reading position', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true });
  // Set up a verified article identity through the actual navigation owner;
  // unlike shortcut tests, no search or search-return route is involved.
  await page.evaluate(() => window.__app.aidNavigation.startResume({
    kind: 'article', board: 'Test', aid: '1gIeu-3A'
  }));
  await waitArticle(page, 'Alpha');
  const position = await readToMiddle(page);
  await disconnectAndReconnect(page);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
});

test('ordinary list recovery without searches restores its board and selection', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true });
  await keyboardBack(page);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await ptt.sendKey(page, 'Home');
  await expect.poll(() => page.evaluate(() => window.__app.listSession.readingPosition()?.cursorNum)).toBe(101);
  await disconnectAndReconnect(page);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await expect.poll(() => page.evaluate(() => window.__app.listSession.readingPosition()?.cursorNum)).toBe(101);
});

test('ordinary article recovery without a known identity falls back to its board without searches', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true });
  await keyboardBack(page);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await disconnectAndReconnect(page);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  expect(await gestureSent(page)).toContain('sTest\r');
});

test('ordinary article recovery on reopening shows the countdown and restores the known article', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, resumeLastPlace: true });
  await page.evaluate(() => window.__app.aidNavigation.startResume({
    kind: 'article', board: 'Test', aid: '1gIeu-3A'
  }));
  await waitArticle(page, 'Alpha');
  const position = await readToMiddle(page);
  await reloadAndLogin(page);
  await expect(page.locator('#resumeLastPlace')).toBeVisible();
  await expect(page.locator('#resumeLastPlace')).toContainText('Test');
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
});

test('ordinary list recovery on reopening shows the countdown and restores the board', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, resumeLastPlace: true });
  await keyboardBack(page);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await reloadAndLogin(page);
  await expect(page.locator('#resumeLastPlace')).toBeVisible();
  await expect(page.locator('#resumeLastPlace')).toContainText('Test');
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
});

for (const kind of ['author', 'thread']) {
  test(`reopening from ${kind} shortcut results reconstructs them without Back`, async ({ page }) => {
    await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, resumeLastPlace: true });
    const position = await readToMiddle(page);
    await tapShortcut(page, kind);
    await waitList(page, { has: ['Alpha topic'], lacks: ['Delta topic'] });

    await reloadAndLogin(page);
    await waitList(page, { has: ['Alpha topic'], lacks: ['Delta topic'] });
    if (kind === 'author') await page.screenshot({ path: test.info().outputPath('restored-author-results.png') });
    await expect.poll(() => bodyText(page)).toContain(RESTORED);
    await keyboardBack(page);
    await waitArticle(page, 'Alpha');
    await expect.poll(() => topLine(page)).toBe(position);
  });
}

for (const legacyCaptions of [false, true]) {
  test(`reopening ordinary title and author results reapplies every filter without Back (legacy: ${legacyCaptions})`, async ({ page }) => {
    await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, resumeLastPlace: true, legacyCaptions });
    await keyboardBack(page);
    await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
    for (const [key, value] of [['/', 'Beta'], ['a', 'bob']]) {
      await ptt.sendKey(page, key);
      const input = page.locator('input[name="searchKeyword"]');
      await input.fill(value);
      await input.press('Enter');
      await expect.poll(() => page.evaluate(() => !window.__app.searchInFlight)).toBe(true);
    }
    await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['alice', 'Alpha topic', 'Delta topic'] });

    await reloadAndLogin(page, { legacyCaptions });
    await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['alice', 'Alpha topic', 'Delta topic'] });
    // Ordinary results have no source article to restore.
    await keyboardBack(page);
    await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  });
}

test('disconnecting from shortcut results reconstructs them before reactivating Back', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true });
  const position = await readToMiddle(page);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await disconnectAndReconnect(page);
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
});

test('ordinary recommendation search resumes without using old result numbers', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, resumeLastPlace: true });
  await keyboardBack(page);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await ptt.sendKey(page, 'Z');
  const input = page.locator('input[name="searchKeyword"]');
  await input.fill('25');
  await input.press('Enter');
  await waitList(page, { has: ['Re: [Talk] Beta topic', 'Delta topic'], lacks: ['alice', 'Alpha topic'] });
  await reloadAndLogin(page);
  await waitList(page, { has: ['Re: [Talk] Beta topic', 'Delta topic'], lacks: ['alice', 'Alpha topic'] });
});

test('reopening nested thread results preserves the parent results and source position', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, resumeLastPlace: true });
  const position = await readToMiddle(page);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await tapShortcut(page, 'thread');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
  await reloadAndLogin(page);
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
  await keyboardBack(page);
  await waitArticle(page, 'Beta');
  await keyboardBack(page);
  await waitList(page, { has: ['Alpha topic', '□ [Talk] Beta topic'], lacks: ['Re: [Talk] Beta topic'] });
  await keyboardBack(page);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
});

for (const kind of ['author', 'thread']) {
  test(`unavailable ${kind} recovery stops without activating stale history or retrying`, async ({ page }) => {
    await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, resumeLastPlace: true });
    await tapShortcut(page, kind);
    await waitList(page, { has: ['Alpha topic'], lacks: ['Delta topic'] });
    await reloadAndLogin(page, { deleted: kind === 'author' ? ['1gIeu-3A', '1gIeu-3B'] : ['1gIeu-3A'] });
    await expect.poll(() => bodyText(page)).toContain(RESUME_FAILED);
    await waitList(page, { has: ['Delta topic'], lacks: ['Alpha topic'] });
    const sent = await gestureSent(page);
    expect(sent.match(kind === 'author' ? /alice\r/g : /#1gIeu-3A\r/g)).toHaveLength(1);
    if (kind === 'thread') expect(sent).not.toContain('S');
    await keyboardBack(page);
    await expect.poll(() => visibleText(page)).toContain('主功能表');
  });
}

// A -> same author -> B -> same thread -> B's results -> Back reopens B by AID.
async function reopenNestedSource(page) {
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await tapShortcut(page, 'thread');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
  await nativeBack(page);
  await waitArticle(page, 'Beta');
}

test('disconnection in a result article keeps the route through login and returns to the source position', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true });
  const position = await readToMiddle(page);
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');

  // The result article has no free identity, so recovery returns to the full
  // board list; passing the main menu and board entry does not clear the route.
  await disconnectAndReconnect(page);
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await expect.poll(() => bodyText(page)).toContain(RESTORED);

  await nativeBack(page);
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
});

test('a reload in a reopened nested source restores it by AID and keeps unwinding', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, resumeLastPlace: true });
  const position = await readToMiddle(page);
  await reopenNestedSource(page);

  await reloadAndLogin(page);
  await expect(page.locator('#resumeLastPlace')).toBeVisible();
  await waitArticle(page, 'Beta');
  await expect.poll(() => bodyText(page)).toContain(RESTORED);

  await keyboardBack(page);
  await waitList(page, { has: ['Alpha topic', '□ [Talk] Beta topic'], lacks: ['Re: [Talk] Beta topic', 'Delta topic'] });
  await keyboardBack(page);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => topLine(page)).toBe(position);
});

test('a source deleted while disconnected stops on its board list and leaves the route inactive', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true });
  await reopenNestedSource(page);

  await disconnectAndReconnect(page, { deleted: ['1gIeu-3B'] });
  await expect.poll(() => bodyText(page), { timeout: 15000 }).toContain(INACTIVE);
  await waitList(page, { has: ['Alpha topic', 'Re: [Talk] Beta topic'] });

  // No retry and no route: Back is the ordinary list exit.
  const sent = (await gestureSent(page)).length;
  await nativeBack(page);
  await expect.poll(async () => (await gestureSent(page)).slice(sent)).toBe('\x1b[D');
  await expect.poll(() => visibleText(page)).toContain('主功能表');
  expect((await gestureSent(page)).slice(sent)).toBe('\x1b[D');
});

test('canceling the resume after a reload explains that the route stays inactive', async ({ page }) => {
  await bootNestedShortcutSearch(page, { loggedIn: true, resumeLastPlace: true });
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });

  // Hold the clock while the open-resume countdown is showing, so a loaded
  // machine cannot let it expire before the reader's tap.
  await page.clock.install();
  await page.reload();
  await waitConnected(page);
  await pauseClockNow(page);
  await nestedSessionAfterLogin(page);
  await page.clock.runFor(1000);
  await page.locator('#resumeLastPlace button').tap();
  await page.clock.resume();
  await expect.poll(() => bodyText(page)).toContain(INACTIVE);
  expect(await bodyText(page)).not.toContain(RESTORED);
  expect(await gestureSent(page)).not.toContain('sTest');
});

test('a user board switch clears the stored route before a reload', async ({ page }) => {
  await bootNestedShortcutSearch(page, { loggedIn: true, resumeLastPlace: true });
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  // The reader moves to another board.
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.board = 'Other';
    server.state.filter = null;
    window.__app.onData(server.frame());
  });
  await expect.poll(() => visibleText(page)).toContain('看板《Other》');

  await reloadAndLogin(page);
  await expect.poll(() => visibleText(page)).toContain('看板《Other》');
  await expect.poll(() => page.evaluate(() => !window.__app.aidNavigation.active)).toBe(true);
  const text = await bodyText(page);
  expect(text).not.toContain(RESTORED);
  expect(text).not.toContain(INACTIVE);
  const sent = (await gestureSent(page)).length;
  await keyboardBack(page);
  await expect.poll(() => visibleText(page)).toContain('主功能表');
  expect((await gestureSent(page)).slice(sent)).toBe('\x1b[D');
});
