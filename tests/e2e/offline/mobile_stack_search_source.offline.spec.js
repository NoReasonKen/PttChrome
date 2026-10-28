// An article shortcut search keeps the page stack (#49): the source article
// stays alive under its results, so each Back on the way out reveals the page
// below at once. Search return history still reopens the source by its code,
// and the real page takes over at the revealed position. The controlled PTT
// board is helpers/article_shortcut_search.js; the app, touch input and Back
// are real.
const { test, expect } = require('@playwright/test');
const {
  bootNestedShortcutSearch, nativeBack, waitArticle, waitList, readToMiddle, topLine, tapShortcut, tapCard
} = require('../helpers/article_shortcut_search');
const ptt = require('../helpers/ptt');
const { MAIN, holdBackReply, heldBack, recordHints, recordedHints } = require('../helpers/stack_routes');

const ARTICLE_LAYER = '[data-stack-layer="article"]';
const LIST_LAYER = '[data-stack-layer="articleList"]';
const FULL_LIST = { has: ['Alpha topic', 'Delta topic'] };
const AUTHOR_RESULTS = { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] };

// The board's list, then Alpha opened from it and read to its middle.
async function sourceFromList(page) {
  await bootNestedShortcutSearch(page, { easyList: true });
  // The app guards system Back only once the reader has acted.
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, FULL_LIST);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  const position = await readToMiddle(page);
  return { position, row: await rowAtTop(page, MAIN) };
}

// The article row at the top of `root`'s view and its offset from that top.
const rowAtTop = (page, root) => page.evaluate(root => {
  const view = document.querySelector(root);
  const top = view.getBoundingClientRect().top;
  const row = [...view.querySelectorAll('[type="bbsrow"][srow]')].find(r => r.getBoundingClientRect().bottom > top + 1);
  return { srow: row.getAttribute('srow'), offset: Math.round(row.getBoundingClientRect().top - top) };
}, root);

// The real page has taken over and settled. Text alone cannot tell: a layer
// shows the same text, and Back on a list still loading its cards goes back
// the way it does today, without a reveal.
const settled = page => page.waitForFunction(() => {
  const app = window.__app;
  return !document.querySelector('[data-stack-layer], [data-article-exit-underlay]') && app.commandQueue.idle &&
    !app.buf._settleTimer && (app.buf.pageState !== 2 || app.listSession.state === 'active');
});

// A card's offset from the top of its list view.
const cardOffset = (page, root, title) => page.evaluate(([root, title]) => {
  const view = document.querySelector(root);
  const card = [...view.querySelectorAll('.listCard')].find(c => c.textContent.includes(title));
  return card.getBoundingClientRect().top - view.getBoundingClientRect().top;
}, [root, title]);

test('Back from the results reveals the source article at its reading position, and Back from it reveals its list', async ({ page }) => {
  const { position, row } = await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await nativeBack(page);
  await waitList(page, AUTHOR_RESULTS);

  await settled(page);
  let release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  expect(await rowAtTop(page, ARTICLE_LAYER)).toEqual(row);
  await release();
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitArticle(page, 'Alpha');
  expect(await rowAtTop(page, MAIN)).toEqual(row);
  expect(await topLine(page)).toBe(position);

  await settled(page);
  release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  await expect(page.locator(LIST_LAYER)).toBeVisible();
  const before = await cardOffset(page, LIST_LAYER, 'Alpha topic');
  await release();
  await expect(page.locator(LIST_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitList(page, FULL_LIST);
  expect(Math.abs(await cardOffset(page, `${MAIN} .listBodyView`, 'Alpha topic') - before)).toBeLessThanOrEqual(1);
});

test('a nested search unwinds one level per Back, each revealing the page below', async ({ page }) => {
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await tapCard(page, '[Talk] Beta topic');
  await waitArticle(page, 'Beta');
  await tapShortcut(page, 'thread');
  await waitList(page, { has: ['Re: [Talk] Beta topic'], lacks: ['Alpha topic'] });
  // Search return history answers Back with its own keys: the stack layers on
  // screen as each Back's first key is sent.
  await page.evaluate(() => {
    const send = window.__stubWSSent;
    window.__sends = [];
    window.__stubWSSent = data => {
      window.__sends.push([...document.querySelectorAll('[data-stack-layer]')].map(el => el.dataset.stackLayer).join());
      return send(data);
    };
  });
  const sends = () => page.evaluate(() => window.__sends);
  const firsts = [];
  const back = async () => {
    await settled(page);
    const n = (await sends()).length;
    await nativeBack(page);
    await expect.poll(async () => (await sends()).length).toBeGreaterThan(n);
    firsts.push((await sends())[n]);
  };

  await back();
  await waitArticle(page, 'Beta');
  await back();
  await waitList(page, AUTHOR_RESULTS);
  await back();
  await waitArticle(page, 'Alpha');
  await back();
  await waitList(page, FULL_LIST);
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0, { timeout: 10000 });
  expect(firsts).toEqual(['article', 'articleList', 'article', 'articleList']);
});

test('a deleted source stops on its board list with today\'s notice, leaving no layer', async ({ page }) => {
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await page.evaluate(() => window.__shortcutServer.state.deleted.add('1gIeu-3A'));
  await recordHints(page);
  await settled(page);
  const release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await release();
  const hinted = text => recordedHints(page).then(hints => hints.some(hint => hint.includes(text)));
  await expect.poll(() => hinted('The source article could not be verified or was deleted'), { timeout: 10000 }).toBe(true);
  await waitList(page, { has: ['Beta topic', 'Delta topic'] });
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0);
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  // A handoff that waited out its bound would say so.
  expect(await hinted('Returning to the list timed out')).toBe(false);
});
