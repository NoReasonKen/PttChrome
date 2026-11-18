// The way into PTT's online user list in mobile easy reading (#199): the home
// dashboard's 線上使用者 button sends Ctrl+Z u, and the user cards slide in
// over the dashboard, which stays alive below them (the page stack,
// docs/article-swipe-drawer-spec.md). Back and the edge swipe reveal it at
// once. On the list easy reading keeps only its own keys: `f` switches
// between all users and friends in place, as the same page, and every key it
// does not present is refused with the "not supported" hint and never sent.
// Every screen on this route is presented, so the native grid guard
// (helpers/native_grid_guard.js) must see no frame of PTT's grid.
//
// The list is the controlled PTT of helpers/user_list.js with invented users.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { installPaintedFrameProbe } = require('../helpers/layout');
const { bootUserList, userListActive, userListSurface } = require('../helpers/user_list');

const UNSUPPORTED_KEY = '好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）';
const MAIN = '.main:not([data-stack-layer])';
const HOME_LAYER = '[data-stack-layer="home"]';
const UNDERLAY = '[data-article-exit-underlay]';
const ENTRY_UNDERLAY = '[data-stack-entry-underlay]';
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const dashboard = (page) => page.locator('#homeDashboard');
const main = (page) => page.locator(MAIN);
const sent = (page) => page.evaluate(() => window.__userListSent.length);
const view = (page) => page.evaluate(() => window.__app.listSession.userListView());
const cardIds = (page) => main(page).evaluate((el) => [...el.querySelectorAll('.listCard[data-user-id]')]
  .map((card) => card.getAttribute('data-user-id')));
// The pages of the page stack, bottom first.
const stackPages = (page) => page.evaluate(() =>
  window.__app.navigationStack.stack.pages.map((p) => p.kind + (p.board ? ':' + p.board : '')));

// Hold PTT's reply to every leave (←) until released, oldest first.
const holdLeaves = (page) => page.evaluate(() => {
  const send = window.__stubWSSent;
  window.__heldLeaves = [];
  window.__stubWSSent = (data) => {
    if (data.indexOf('\x1b[D') < 0) return send(data);
    window.__heldLeaves.push(() => send(data));
  };
});
const heldLeaves = (page) => page.evaluate(() => window.__heldLeaves.length);
const releaseLeave = (page) => page.evaluate(() => window.__heldLeaves.shift()());

// An edge swipe right across the screen, released: returns the underlay's
// preview kind before the release ('layer' for a live layer).
async function swipeBack(page) {
  const box = await main(page).boundingBox();
  const y = box.y + box.height / 2;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 36, y });
  await contact.move({ x: 160, y });
  await expect(page.locator(UNDERLAY)).toHaveCount(1);
  const preview = await page.locator(UNDERLAY).getAttribute('data-preview');
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.release();
  return preview;
}

// Every painted frame from now on until stopFrames: how far the real screen
// is from where it rests, and whether an entry slide's underlay is up.
async function sampleFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate((MAIN) => {
    window.__frames = [];
    const rest = Math.round(document.querySelector(MAIN).getBoundingClientRect().left);
    window.__sample = () => window.__frames.push({
      left: Math.round(document.querySelector(MAIN).getBoundingClientRect().left) - rest,
      entry: !!document.querySelector('[data-stack-entry-underlay]'),
    });
    window.__paintedFrame.add(window.__sample);
  }, MAIN);
}
const stopFrames = (page) => page.evaluate(() => {
  window.__paintedFrame.remove(window.__sample);
  return window.__frames;
});

async function openUserList(page, opts) {
  await bootUserList(page, opts);
  await page.evaluate(() => window.__nativeGridGuard.reset());
  await page.locator('[data-home-users]').tap();
  await userListActive(page);
  // The cards rest in place: the slide is over.
  await expect(page.locator(ENTRY_UNDERLAY)).toHaveCount(0);
}

test.describe('the online user list entrance', () => {
  test('線上使用者 sends Ctrl+Z u, and the user cards slide in over the dashboard', async ({ page }) => {
    await bootUserList(page, { count: 30 });
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await sampleFrames(page);
    const before = await sent(page);
    await page.locator('[data-home-users]').tap();
    await userListActive(page);
    await expect(page.locator(ENTRY_UNDERLAY)).toHaveCount(0);
    const frames = await stopFrames(page);
    expect(await page.evaluate((n) => window.__userListSent.slice(n).join(''), before)).toContain('\x1au');
    // The cards came in from the right over the dashboard's live layer.
    expect(frames.some((f) => f.entry && f.left > page.viewportSize().width / 2)).toBe(true);
    expect(await userListSurface(page)).toBe('list:all');
    await expect(dashboard(page)).toBeHidden();
    expect((await cardIds(page))[0]).toBe('user001');
    // The dashboard is the page below, named after the list it opened.
    expect(await stackPages(page)).toEqual(['home:【休閒聊天】', 'articleList:【休閒聊天】']);
    expect(await guardHits(page)).toEqual([]);
  });

  test('a guest, who has no user list, gets a hint and stays on the dashboard', async ({ page }) => {
    await bootUserList(page);
    await page.evaluate(() => { window.__userListServer.refuseUsers = true; });
    await page.locator('[data-home-users]').tap();
    await expect(page.locator('.ListHint')).toHaveText('開不了線上使用者名單');
    await expect(dashboard(page)).toBeVisible();
    expect(await userListSurface(page)).toBe('menu');
    expect(await page.evaluate(() => window.__app.articleGestures.stack.pending)).toBe(null);
    await expect(page.locator(HOME_LAYER)).toHaveCount(0);
    await expect(page.locator(ENTRY_UNDERLAY)).toHaveCount(0);
    expect(await guardHits(page)).toEqual([]);
  });

  test('← reveals the dashboard at once while PTT answers the leave', async ({ page }) => {
    await openUserList(page);
    await holdLeaves(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(HOME_LAYER)).toBeVisible();
    await expect(page.locator(`${HOME_LAYER} [data-home-users]`)).toBeVisible();
    await releaseLeave(page);
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator(UNDERLAY)).toHaveCount(0);
    expect(await userListSurface(page)).toBe('menu');
    expect(await guardHits(page)).toEqual([]);
  });

  test('e leaves the same way: the dashboard is revealed at once', async ({ page }) => {
    await openUserList(page);
    await holdLeaves(page);
    await ptt.sendKey(page, 'e');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(HOME_LAYER)).toBeVisible();
    await releaseLeave(page);
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
    expect(await userListSurface(page)).toBe('menu');
    expect(await guardHits(page)).toEqual([]);
  });

  test('an edge swipe reveals the dashboard, not the dark fallback, and goes home', async ({ page }) => {
    await openUserList(page);
    await holdLeaves(page);
    expect(await swipeBack(page)).toBe('layer');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(HOME_LAYER)).toBeVisible();
    await releaseLeave(page);
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
    expect(await userListSurface(page)).toBe('menu');
    expect(await guardHits(page)).toEqual([]);
  });
});

test.describe('keys on the online user list', () => {
  test('f shows friends in place, no slide and the same page, and f again all users', async ({ page }) => {
    await openUserList(page, { count: 30, friends: [3, 12] });
    const pages = await stackPages(page);
    await sampleFrames(page);
    await ptt.sendKey(page, 'f');
    await expect.poll(() => cardIds(page)).toEqual(['user003', 'user012']);
    await userListActive(page);
    expect(await userListSurface(page)).toBe('list:friends');
    expect(await view(page)).toBe('friends');
    let frames = await stopFrames(page);
    expect(frames.filter((f) => f.entry || f.left !== 0)).toEqual([]);
    // The same page: the dashboard is still the page below it.
    expect(await stackPages(page)).toEqual(pages);

    await sampleFrames(page);
    await ptt.sendKey(page, 'f');
    await expect.poll(() => cardIds(page).then((ids) => ids[0])).toBe('user001');
    await userListActive(page);
    expect(await view(page)).toBe('all');
    frames = await stopFrames(page);
    expect(frames.filter((f) => f.entry || f.left !== 0)).toEqual([]);
    expect(await stackPages(page)).toEqual(pages);
    expect(await guardHits(page)).toEqual([]);

    // Back from either view reveals the dashboard.
    await holdLeaves(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(HOME_LAYER)).toBeVisible();
    await releaseLeave(page);
    await expect(dashboard(page)).toBeVisible();
  });

  test('the More sheet names the view it switches to, and switches it', async ({ page }) => {
    await openUserList(page, { count: 30, friends: [3] });
    await page.locator('[data-key="__more"]').tap();
    const toggle = page.locator('[data-key="__userListToggle"]');
    // The test app runs in English (en_US: Friends only / Show all users).
    await expect(toggle).toHaveText('Friends only');
    await toggle.tap();
    await expect.poll(() => cardIds(page)).toEqual(['user003']);
    await userListActive(page);
    await page.locator('[data-key="__more"]').tap();
    await expect(toggle).toHaveText('Show all users');
    expect(await guardHits(page)).toEqual([]);
  });

  test('the view is kept for the next visit: PTT keeps it on the account', async ({ page }) => {
    await openUserList(page, { count: 30, friends: [3] });
    await ptt.sendKey(page, 'f');
    await expect.poll(() => cardIds(page)).toEqual(['user003']);
    await userListActive(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await expect(dashboard(page)).toBeVisible();
    await page.locator('[data-home-users]').tap();
    await userListActive(page);
    expect(await view(page)).toBe('friends');
    expect(await guardHits(page)).toEqual([]);
  });

  // Easy reading presents the list, not PTT's talk, mail, pager or sorting.
  test('keys easy reading does not present are refused, and nothing is sent', async ({ page }) => {
    await openUserList(page, { count: 30 });
    const before = await sent(page);
    for (const key of ['w', 't', 'm', 's', 'Tab', 'S', 'b', 'a', 'd', 'o', 'N', 'H', 'Control+z', 'Control+p']) {
      await ptt.sendKey(page, key);
      await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
      await expect(page.locator('.ListHint')).toHaveAttribute('data-level', 'error');
    }
    expect(await sent(page)).toBe(before);
    expect(await page.locator('input[name="searchKeyword"]').count()).toBe(0);
    expect(await userListSurface(page)).toBe('list:all');
    expect(await guardHits(page)).toEqual([]);
  });
});
