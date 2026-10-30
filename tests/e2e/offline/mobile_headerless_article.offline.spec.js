// An article whose author removed its header rows (#77) takes its identity
// from the list row it was opened from: the App Bar shows that row's title,
// board and author, and the page stack treats it as any other article.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { beginArticleTouch, revealArticleDrawer } = require('../helpers/article_gestures');
const { waitRectStable } = require('../helpers/layout');
const { THREAD, FAR_BOARD, bootThreadBoard, listActive, watchScreen, stopWatching, sent, server } = require('../helpers/thread_jump');

const HEADERLESS = FAR_BOARD.map(article => article.num === 600 ? { ...article, headerless: true } : article);
const MAIN = '.main:not([data-stack-layer])';
const bar = page => page.locator('#mobileAppBar').evaluate(el => ({
  title: el.querySelector('.mobileAppBarTitle')?.textContent || '',
  subtitle: el.querySelector('.mobileAppBarSubtitle')?.textContent || '',
  byline: el.querySelector('.mobileAppBarByline')?.textContent || ''
}));
// The App Bar's own title (PTT in English, 批踢踢 in Chinese).
const DEFAULT_TITLE = /^(?:PTT|批踢踢)$/;

const CAROL = { title: 'Re: [Talk] Far topic', subtitle: 'Test', byline: 'carol' };

async function openFromList(page, author, text) {
  await listActive(page);
  await page.locator(`${MAIN} .listCard[data-list-author="${author}"]`).filter({ hasText: text }).tap();
  await expect.poll(() => page.evaluate(() => window.__app.buf.pageState === 3 && window.__app.commandQueue.idle)).toBe(true);
}

async function backToList(page) {
  await ptt.sendKey(page, 'ArrowLeft');
  await listActive(page);
}

test('an article without a header opened from the easy-reading list shows its list row in the App Bar', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, fromList: true, thread: HEADERLESS });
  await expect.poll(() => bar(page)).toEqual(CAROL);
});

test('Back from an article without a header reveals the list it was opened from', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, fromList: true, thread: HEADERLESS });
  await expect.poll(() => bar(page)).toEqual(CAROL);
  const main = await waitRectStable(page, '.main');
  const contact = await beginArticleTouch(page, { x: 20, y: main.top + 100 });
  await contact.move({ x: page.viewportSize().width - 20, y: main.top + 100 });
  await expect(page.locator('[data-article-exit-underlay]')).toHaveAttribute('data-preview', 'layer');
  await contact.release();
  await listActive(page);
  await expect.poll(() => bar(page)).toMatchObject({ title: 'Test' });
});

test('an article without a header and the next article never show each other\'s identity', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, fromList: true, thread: HEADERLESS });
  await expect.poll(() => bar(page)).toEqual(CAROL);
  await backToList(page);
  await openFromList(page, 'filler', 'Filler 601');
  await expect.poll(() => bar(page)).toEqual({ title: '[Talk] Filler 601', subtitle: 'Test', byline: 'filler (filler)' });
  await backToList(page);
  await openFromList(page, 'carol', 'Far topic');
  await expect.poll(() => bar(page)).toEqual(CAROL);
});

const DAN = { title: 'Re: [Talk] Far topic', subtitle: 'Test', byline: 'dan' };
const withDan = thread => [...thread, { num: 610, author: 'dan', title: 'Re: ' + THREAD, date: '10/21', headerless: true }];

async function nextInThread(page) {
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="]"]').tap();
  await expect(page.locator('.main').first()).toContainText('Body of article 610 by dan');
}

const settledOn = async (page, num) => {
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.headerlessReopen.active)).toBe(true);
  expect(await server(page)).toMatchObject({ surface: 'article', open: num, filter: null });
};

// PTT moves to the next article in the thread without showing a list: the
// first article's row is not the second one's identity, which comes from a
// return to the list out of sight.
test('a next-in-thread move from one article without a header to another shows the second one\'s row', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, fromList: true, thread: withDan(HEADERLESS) });
  await expect.poll(() => bar(page)).toEqual(CAROL);
  await nextInThread(page);
  await expect.poll(() => bar(page)).toEqual(DAN);
  await settledOn(page, 610);
});

// The reader sees the landed article throughout: never the list on the way.
test('an article without a header reached by a key PTT answers directly takes its row out of sight', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, thread: withDan(FAR_BOARD) });
  await watchScreen(page);
  await nextInThread(page);
  await expect.poll(() => bar(page)).toEqual(DAN);
  await settledOn(page, 610);
  const seen = await stopWatching(page);
  for (const entry of seen) {
    expect(entry.screen.includes('Body of article 600 by') || entry.screen.includes('Body of article 610 by'), JSON.stringify(seen)).toBe(true);
    expect(entry.cards, JSON.stringify(seen)).toBe(false);
  }
  expect(await sent(page)).toEqual([']\f', '\x1b[D\f', '\r\f']);
});

test('an article without a header opened from the native list takes its row out of sight', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, nativeList: true, thread: HEADERLESS });
  await expect.poll(() => bar(page)).toEqual(CAROL);
  await settledOn(page, 600);
});

// A far same-thread jump lands through the full list (#65): the target's row.
test('a far same-thread jump that lands on an article without a header shows its list row', async ({ page }) => {
  const thread = FAR_BOARD.map(article => article.num === 1150 ? { ...article, headerless: true } : article);
  await bootThreadBoard(page, { open: 600, thread });
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="]"]').tap();
  await expect(page.locator('.main').first()).toContainText('Body of article 1150 by dave');
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.threadJump.active)).toBe(true);
  await expect.poll(() => bar(page)).toEqual({ title: 'Re: [Talk] Far topic', subtitle: 'Test', byline: 'dave' });
});

// Nothing before it was on a board (a notice after login, for example).
test('an article without a header with no board before it keeps the default title', async ({ page }) => {
  await bootThreadBoard(page, { open: 600, thread: HEADERLESS });
  await expect(page.locator('.main').first()).toContainText('Body of article 600 by carol');
  await expect.poll(() => bar(page)).toEqual({ title: expect.stringMatching(DEFAULT_TITLE), subtitle: '', byline: '' });
});
