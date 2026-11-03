// An article shortcut search keeps the page stack (#49): the source article
// stays alive under its results, so each Back on the way out reveals the page
// below at once. Search backtracking still reopens the source by its code,
// and the real page takes over at the revealed position. The controlled PTT
// board is helpers/article_shortcut_search.js; the app, touch input and Back
// are real.
const { test, expect } = require('@playwright/test');
const {
  bootNestedShortcutSearch, nativeBack, waitArticle, waitList, readToMiddle, topLine, tapShortcut, tapCard
} = require('../helpers/article_shortcut_search');
const ptt = require('../helpers/ptt');
const { MAIN, holdBackReply, heldBack, recordHints, recordedHints } = require('../helpers/stack_routes');
const { installPaintedFrameProbe } = require('../helpers/layout');
const { beginArticleTouch, revealArticleDrawer } = require('../helpers/article_gestures');

const ARTICLE_LAYER = '[data-stack-layer="article"]';
const LIST_LAYER = '[data-stack-layer="articleList"]:not([data-stack-parked])';
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
  return !document.querySelector('[data-stack-layer]:not([data-stack-parked]), [data-article-exit-underlay]') && app.commandQueue.idle &&
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
  // Search backtracking answers Back with its own keys: the stack layers on
  // screen as each Back's first key is sent.
  await page.evaluate(() => {
    const send = window.__stubWSSent;
    window.__sends = [];
    window.__stubWSSent = data => {
      window.__sends.push([...document.querySelectorAll('[data-stack-layer]:not([data-stack-parked])')].map(el => el.dataset.stackLayer).join());
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

// A long Alpha opened from the board's list and read past its first PTT page
// (#83). Returns the row at the top of the view.
async function longSourceFromList(page) {
  await bootNestedShortcutSearch(page, { easyList: true, alphaLines: 80 });
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, FULL_LIST);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await expect.poll(async () => {
    await ptt.sendKey(page, 'PageDown');
    return page.evaluate(() => window.__app.view.currentLineIndex());
  }).toBeGreaterThan(40);
  await settled(page);
  return rowAtTop(page, MAIN);
}

// What the top of the reading area shows: the article row there, if an
// article shows, and whether PTT's native screen shows.
const readingArea = page => page.evaluate(() => {
  window.__readingArea = () => {
    const bar = document.getElementById('mobileAppBar').getBoundingClientRect();
    const hit = document.elementFromPoint(window.innerWidth / 2, bar.bottom + 30);
    return {
      srow: hit?.closest('.screenChunk [srow]')?.getAttribute('srow') ?? null,
      native: !!hit?.closest('#mainContainer') && !hit.closest('.screenChunk, .listBodyView')
    };
  };
  return window.__readingArea();
});

// The reading area of every painted frame from now on.
async function sampleReadingArea(page) {
  await readingArea(page);
  await installPaintedFrameProbe(page);
  await page.evaluate(() => {
    window.__frames = [];
    const sample = () => {
      window.__frames.push(window.__readingArea());
      if (window.__frames.length >= 600) window.__paintedFrame.remove(sample);
    };
    window.__paintedFrame.add(sample);
  });
}
const sampledFrames = page => page.evaluate(() => window.__frames);

test('starting a shortcut search keeps the article on screen until its results show', async ({ page }) => {
  await longSourceFromList(page);
  await sampleReadingArea(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  const frames = await sampledFrames(page);
  expect(frames.filter(f => f.native).length).toBe(0);
});

test('Back from the results shows a source read past its first page at its reading position throughout', async ({ page }) => {
  const row = await longSourceFromList(page);
  const reading = (await readingArea(page)).srow;
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  await sampleReadingArea(page);
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await settled(page);
  expect(await rowAtTop(page, MAIN)).toEqual(row);
  const frames = await sampledFrames(page);
  const shown = frames.findIndex(f => f.srow != null);
  expect(shown).toBeGreaterThanOrEqual(0);
  expect([...new Set(frames.slice(shown).map(f => f.srow))]).toEqual([reading]);
});

// The accumulated article as the reader sees it: its row count and its last
// row's text.
const shownArticle = page => page.evaluate(() => {
  const app = window.__app;
  const lines = app.buf.pageLines;
  return { rows: lines.length, last: app.buf.getRowText(lines.length - 1, 0, app.buf.cols, lines).trim() };
});

test('Back from the results keeps the source as it was left when PTT\'s copy gained comments (#121)', async ({ page }) => {
  const row = await longSourceFromList(page);
  await expect.poll(() => page.evaluate(() => window.__app.easyReading.easyReadingReachedPageEnd)).toBe(true);
  const before = await shownArticle(page);
  // The article PTT will reopen; it gains rows at its end while the reader is
  // in the results.
  await page.evaluate(() => { window.__alpha = window.__shortcutServer.state.open; });
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await page.evaluate(() => { window.__alpha.lines = 110; });
  await settled(page);
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await settled(page);
  // PTT did reopen the longer copy, to its end.
  await expect.poll(() => page.evaluate(() => window.__shortcutServer.state.line)).toBeGreaterThan(80);
  expect(await shownArticle(page)).toEqual(before);
  expect(await rowAtTop(page, MAIN)).toEqual(row);
  // Nothing changes once PTT has reopened it.
  await page.waitForTimeout(500); // sleep-ok: proves the absence of a later change; nothing to wait for
  expect(await shownArticle(page)).toEqual(before);
  expect(await rowAtTop(page, MAIN)).toEqual(row);
});

test('a source touched while it is revealed swipes again once it takes over', async ({ page }) => {
  await longSourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  await nativeBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  // A finger on the layer holds the swap until after the last screen settles.
  const box = await page.locator(ARTICLE_LAYER).boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.waitForFunction(at => !!document.elementFromPoint(at.x, at.y)?.closest('[data-stack-layer]'), at);
  const contact = await beginArticleTouch(page, at);
  await page.waitForFunction(() => {
    const app = window.__app;
    return app.buf.pageState === 3 && app.commandQueue.idle && !app.buf._settleTimer && app.easyReading.easyReadingReachedPageEnd;
  });
  await page.waitForTimeout(300); // sleep-ok: holds the finger past any settle after the last page; nothing to wait for
  await contact.release();
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  await expect(page.locator(MAIN)).toHaveClass(/articleHorizontalGestures/);
  await revealArticleDrawer(page);
});

// The comment bar, folded into the toolbar's push button.
const pushBtn = page => page.locator('[data-key="X"]');
const commentInput = page => page.locator('#commentBar [name="commentBarText"]');
const withCommentBar = page => ptt.applyPrefs(page, { enableLongPush: true, enableCommentBar: true, mobileCommentBarFold: true });
const hinted = (page, text) => recordedHints(page).then(hints => hints.some(hint => hint.includes(text)));
const pendingShown = page => page.evaluate(() => !!window.__app.view._listLoadingOwners?.has('stackPending'));

// Each comment that reaches PTT starts with a preflight; it is only counted,
// with whether an article layer was still shown at the time.
const countPreflights = page => page.evaluate(() => {
  window.__preflights = [];
  window.__app.longPush.startPreflight = () => {
    window.__preflights.push({ layer: !!document.querySelector('[data-stack-layer="article"]') });
    return false;
  };
});
const preflights = page => page.evaluate(() => window.__preflights);

// Alpha revealed from the author results, its reopen held by PTT. A deleted
// Alpha cannot be reopened.
async function revealHeldSource(page, { deleted = false } = {}) {
  await sourceFromList(page);
  await withCommentBar(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  if (deleted) await page.evaluate(() => window.__shortcutServer.state.deleted.add('1gIeu-3A'));
  await recordHints(page);
  await countPreflights(page);
  await settled(page);
  const release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  return release;
}

async function commentOnLayer(page, text) {
  await pushBtn(page).tap();
  await expect(commentInput(page)).toBeFocused();
  await commentInput(page).fill(text);
  await commentInput(page).press('Enter');
}

test('a deleted source stays shown with today\'s notice, refuses a comment, and Back shows its board list (#121)', async ({ page }) => {
  await sourceFromList(page);
  await withCommentBar(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await page.evaluate(() => window.__shortcutServer.state.deleted.add('1gIeu-3A'));
  await recordHints(page);
  await countPreflights(page);
  await settled(page);
  const release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await release();
  await expect.poll(() => hinted(page, 'The source article could not be verified or was deleted'), { timeout: 10000 }).toBe(true);
  // PTT stopped on the board list; the article stays shown over it.
  await page.waitForFunction(() => {
    const app = window.__app;
    return app.buf.pageState === 2 && !app.articleGestures.stack.handingOff && app.commandQueue.idle;
  });
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  expect(await hinted(page, 'Returning to the list timed out')).toBe(false);
  // A comment is refused with a notice, from the toolbar and from the bar.
  await pushBtn(page).tap();
  await expect.poll(() => hinted(page, 'Could not verify the original article; the comment was not sent')).toBe(true);
  expect(await page.evaluate(() => window.__app.openQuickPush({ text: 'hello' }))).toBe(false);
  expect(await preflights(page)).toEqual([]);
  // Back leaves the article for the list PTT already shows, sending nothing.
  await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
  await page.evaluate(() => {
    window.__sent = [];
    const send = window.__stubWSSent;
    window.__stubWSSent = data => { window.__sent.push(data); return send(data); };
  });
  await nativeBack(page);
  await expect(page.locator('[data-stack-layer]')).toHaveCount(0);
  await waitList(page, { has: ['Beta topic', 'Delta topic'] });
  await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__sent.join(''))).not.toContain('\x1b[D');
});

test('a comment made before PTT reopens the source waits, then goes out once the source takes over (#121)', async ({ page }) => {
  const release = await revealHeldSource(page);
  await commentOnLayer(page, 'first');
  await expect.poll(() => pendingShown(page)).toBe(true);
  // The last comment wins.
  await commentOnLayer(page, 'second');
  expect(await page.evaluate(() => window.__app.articleGestures.stack.handoff.action != null)).toBe(true);
  expect(await preflights(page)).toEqual([]);
  await release();
  await waitArticle(page, 'Alpha');
  await expect.poll(() => preflights(page)).toEqual([{ layer: false }]);
  expect(await pendingShown(page)).toBe(false);
  // The comment sent is the last one, kept as the draft until it is sent.
  expect(await page.evaluate(() => localStorage.getItem('pttchrome.longPush.draft.v1'))).toBe('second');
});

test('a comment made before PTT reopens a deleted source is refused with a notice (#121)', async ({ page }) => {
  const release = await revealHeldSource(page, { deleted: true });
  await commentOnLayer(page, 'hello');
  await expect.poll(() => pendingShown(page)).toBe(true);
  await release();
  await expect.poll(() => hinted(page, 'Could not verify the original article; the comment was not sent'), { timeout: 10000 }).toBe(true);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  expect(await pendingShown(page)).toBe(false);
  expect(await preflights(page)).toEqual([]);
});
