const { test, expect } = require('@playwright/test');
const { gestureSent } = require('../helpers/article_gestures');
const {
  bootNestedShortcutSearch, nestedSessionAfterLogin, nativeBack, visibleText, waitArticle, waitList, readToMiddle, topLine, tapShortcut
} = require('../helpers/article_shortcut_search');
const { waitConnected } = require('../helpers/replay');
const ptt = require('../helpers/ptt');

// Search return history through interruption (docs/article-swipe-drawer-spec.md): the
// complete app with real touch, a controlled PTT board, a real socket close
// and reconnect, and a real page reload with the state the app stored.

const RESTORED = 'Search return history restored';
const INACTIVE = 'Search return history was not restored';
const bodyText = page => page.locator('body').innerText();

async function tapCard(page, title) {
  await expect(page.locator('#mainContainer .listBodyView')).toBeVisible();
  await page.locator('#mainContainer .listCard', { hasText: title }).locator('.listCardBody').tap();
}

// The connection drops; the reader taps Reconnect and logs in again.
async function disconnectAndReconnect(page, session = {}) {
  await page.evaluate(() => window.__stubWS.close());
  await page.locator('#reactAlert button', { hasText: 'Reconnect' }).tap();
  await waitConnected(page);
  await nestedSessionAfterLogin(page, session);
}

async function reloadAndLogin(page, session = {}) {
  await page.reload();
  await waitConnected(page);
  await nestedSessionAfterLogin(page, session);
}

// After a reload the browser's Back traverses history entries the previous
// page left behind, which the back guard does not own; use the keyboard Back.
const keyboardBack = page => ptt.sendKey(page, 'ArrowLeft');

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
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
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
