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
const { MAIN, holdBackReply, heldBack, recordHints, recordedHints, dashboardVisible } = require('../helpers/stack_routes');
const { waitScreenSettled } = require('../helpers/replay');
const { installPaintedFrameProbe } = require('../helpers/layout');
const { beginArticleTouch, revealArticleDrawer } = require('../helpers/article_gestures');

const ARTICLE_LAYER = '[data-stack-layer="article"]';
const LIST_LAYER = '[data-stack-layer="articleList"]:not([data-stack-parked])';
const FULL_LIST = { has: ['Alpha topic', 'Delta topic'] };
const AUTHOR_RESULTS = { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] };

// The board's list, then Alpha opened from it and read to its middle.
async function sourceFromList(page, options = {}) {
  await bootNestedShortcutSearch(page, { easyList: true, ...options });
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
  if (!row) return null;
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

// Tearing a layer down never unmounts its React roots (its inline previews)
// while React renders, as from the home dashboard registering itself.
const REACT_ERRORS = /synchronously unmount a root|React was already rendering/;
let reactErrors = [];
test.beforeEach(({ page }) => {
  reactErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && REACT_ERRORS.test(msg.text())) reactErrors.push(msg.text());
  });
});
test.afterEach(() => {
  expect(reactErrors).toEqual([]);
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
// (#83). Returns the row at the top of the view. `comments`: Alpha ends with
// its sign-off and comments up to that line (`withComments`).
async function longSourceFromList(page, { comments = 0 } = {}) {
  await bootNestedShortcutSearch(page, { easyList: true, alphaLines: 80 });
  // The article PTT opens and later reopens as Alpha.
  await page.evaluate(() => { window.__alpha = window.__shortcutServer.state.open; });
  if (comments) await withComments(page, comments);
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

// Every painted frame from now on: how far the real screen is from where it
// rests, whether it shows a list, and whether an article shows beside it.
async function sampleSlide(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(MAIN => {
    window.__frames = [];
    const rest = Math.round(document.querySelector(MAIN).getBoundingClientRect().left);
    const visible = el => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const sample = () => {
      const main = document.querySelector(MAIN);
      window.__frames.push({
        left: Math.round(main.getBoundingClientRect().left) - rest,
        list: visible(main.querySelector('.listBodyView')),
        article: [...document.querySelectorAll('[data-stack-layer="article"]')].some(visible)
      });
      if (window.__frames.length >= 600) window.__paintedFrame.remove(sample);
    };
    window.__paintedFrame.add(sample);
  }, MAIN);
}

test('the results of a shortcut search slide in from the right over the source article', async ({ page }) => {
  await sourceFromList(page);
  const width = page.viewportSize().width;
  await sampleSlide(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  const frames = await sampledFrames(page);
  const start = frames.findIndex(f => f.left > 3);
  expect(start).toBeGreaterThanOrEqual(0);
  const moving = frames.slice(start);
  expect(moving[0].left).toBeGreaterThan(width / 2);
  expect(moving.filter((f, i) => i > 0 && f.left > moving[i - 1].left + 3)).toEqual([]);
  expect(moving.filter(f => f.left > 3 && !(f.list && f.article))).toEqual([]);
  expect(frames.at(-1).left).toBeLessThanOrEqual(3);
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

// Alpha's line 77 signs it off; each later line up to `last` is a comment.
const SIGN_OFF = 77;
const commentText = n => `comment number ${n}`;
const withComments = (page, last) => page.evaluate(({ last, signOff }) => {
  const alpha = window.__alpha;
  alpha.lines = last;
  alpha.text = { ...alpha.text, [signOff]: '※ 發信站: 批踢踢實業坊(ptt.cc), 來自: 192.0.2.1 (臺灣)' };
  for (let n = signOff + 1; n <= last; n++) {
    alpha.text[n] = `推 user${n}: ${`comment number ${n}`.padEnd(50)} 09/01 12:${String(n % 60).padStart(2, '0')}`;
  }
}, { last, signOff: SIGN_OFF });

// A source read to its end, its comments up to line 80, then the author
// results. `whileAway` changes what PTT will reopen.
async function readSourceThenSearch(page, whileAway) {
  const row = await longSourceFromList(page, { comments: 80 });
  await expect.poll(() => page.evaluate(() => window.__app.easyReading.easyReadingReachedPageEnd)).toBe(true);
  const before = await shownArticle(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await whileAway();
  await recordHints(page);
  await settled(page);
  return { row, before };
}

// PTT's pager shows the last page of the article as it now is.
const atReopenedEnd = () => window.__shortcutServer.state.line === window.__alpha.lines - 22;

// PTT has reopened the article to its end and is idle.
const reopenedToEnd = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.commandQueue.idle && !app.buf._settleTimer &&
    app.easyReading.easyReadingReachedPageEnd && window.__shortcutServer.state.line === window.__alpha.lines - 22;
});

const marker = page => page.locator(`${MAIN} .newCommentsStart`);
const UPDATED = 'The article has been updated';

test('Back from the results appends the comments PTT\'s copy gained behind the new-comments marker, at the same position (#126)', async ({ page }) => {
  const { row, before } = await readSourceThenSearch(page, () => withComments(page, 83));
  expect(before.last).toContain(commentText(80));
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await settled(page);
  await expect.poll(() => shownArticle(page)).toEqual({ rows: before.rows + 3, last: expect.stringContaining(commentText(83)) });
  expect(await rowAtTop(page, MAIN)).toEqual(row);
  // The marker separates the appended comments from those already shown.
  await expect(marker(page)).toHaveCount(1);
  await expect(marker(page)).toContainText(commentText(81));
  expect(await recordedHints(page)).not.toContain(UPDATED);
});

test('comments wait to be appended while a finger is on the revealed source (#126)', async ({ page }) => {
  const { row, before } = await readSourceThenSearch(page, () => withComments(page, 83));
  await nativeBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  const box = await page.locator(ARTICLE_LAYER).boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.waitForFunction(at => !!document.elementFromPoint(at.x, at.y)?.closest('[data-stack-layer]'), at);
  const contact = await beginArticleTouch(page, at);
  await reopenedToEnd(page);
  await page.waitForTimeout(300); // sleep-ok: holds the finger past any settle after the last page; nothing to wait for
  // Still the article as it was left.
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await expect(page.locator(ARTICLE_LAYER)).not.toContainText(commentText(81));
  await contact.release();
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  await expect.poll(() => shownArticle(page)).toEqual({ rows: before.rows + 3, last: expect.stringContaining(commentText(83)) });
  expect(await rowAtTop(page, MAIN)).toEqual(row);
  await expect(marker(page)).toContainText(commentText(81));
});

test('an article edited while the reader was away stays as it was left, with a notice (#126)', async ({ page }) => {
  const { row, before } = await readSourceThenSearch(page, async () => {
    await withComments(page, 83);
    await page.evaluate(() => { window.__alpha.text[10] = 'Alpha line 09: rewritten by its author'; });
  });
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await settled(page);
  // The notice is the last one shown, once.
  await expect.poll(async () => (await recordedHints(page)).at(-1)).toBe(UPDATED);
  expect((await recordedHints(page)).filter(hint => hint === UPDATED)).toHaveLength(1);
  // PTT did reopen the edited copy, to its end.
  expect(await page.evaluate(atReopenedEnd)).toBe(true);
  expect(await shownArticle(page)).toEqual(before);
  expect(await rowAtTop(page, MAIN)).toEqual(row);
  await expect(marker(page)).toHaveCount(0);
});

test('the next page PTT sends for an article kept over its edited copy rebuilds it from that copy (#126)', async ({ page }) => {
  const { before } = await readSourceThenSearch(page, async () => {
    await withComments(page, 83);
    await page.evaluate(() => { window.__alpha.text[10] = 'Alpha line 09: rewritten by its author'; });
  });
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await settled(page);
  expect(await shownArticle(page)).toEqual(before);
  // A comment arrives and PTT redraws its last page, as after the reader's own.
  await withComments(page, 84);
  await page.evaluate(() => window.__stubWSSent('\x1b[4~'));
  await expect.poll(() => shownArticle(page)).toEqual({ rows: before.rows + 4, last: expect.stringContaining(commentText(84)) });
  const texts = await page.evaluate(() => {
    const app = window.__app;
    const lines = app.buf.pageLines;
    return lines.map((_, i) => app.buf.getRowText(i, 0, app.buf.cols, lines).trim());
  });
  expect(texts).toContain('Alpha line 09: rewritten by its author');
  // Each comment once: nothing of the kept rows is spliced against PTT's copy.
  for (const n of [80, 81, 84]) expect(texts.filter(text => text.includes(commentText(n)))).toHaveLength(1);
});

// A long Alpha opened from the board's list whose reading stopped partway, as
// a search started before easy reading reached its end leaves it: PTT
// answers no page past line `stop` until paging resumes. Returns the row at
// the top of the view and the line the reading stopped at.
async function partlyReadSource(page, { lines, stop }) {
  await bootNestedShortcutSearch(page, { easyList: true, alphaLines: lines });
  await page.evaluate(stop => {
    const state = window.__shortcutServer.state;
    window.__alpha = state.open;
    window.__pagingStops = true;
    const send = window.__stubWSSent;
    window.__stubWSSent = bytes => {
      if (window.__pagingStops && bytes === '\x1b[6~' && state.surface === 'article' && state.line >= stop) return;
      send(bytes);
    };
  }, stop);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, FULL_LIST);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await expect.poll(() => page.evaluate(() => window.__app.view._accEndRow)).toBe(stop + 22);
  await expect.poll(async () => {
    await ptt.sendKey(page, 'PageDown');
    return page.evaluate(() => window.__app.view.currentLineIndex());
  }).toBeGreaterThan(40);
  await settled(page);
  expect(await page.evaluate(() => window.__app.easyReading.easyReadingReachedPageEnd)).toBe(false);
  return { row: await rowAtTop(page, MAIN), stopped: stop + 22 };
}

// Back from the author results of a partly read Alpha, with paging resumed;
// `whileAway` changes what PTT will reopen. Returns what was sent from Back on.
async function backToPartlyRead(page, whileAway = () => {}) {
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  await whileAway();
  await recordHints(page);
  await page.evaluate(() => {
    window.__pagingStops = false;
    window.__sentFrom = window.__gestureSent.length;
  });
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await settled(page);
  return page.evaluate(() => window.__gestureSent.slice(window.__sentFrom));
}

// The numbers of Alpha's body lines the real article shows, in order.
const bodyLineNumbers = page => page.evaluate(() => {
  const app = window.__app;
  const lines = app.buf.pageLines;
  return lines.map((_, i) => /^Alpha line (\d+):/.exec(app.buf.getRowText(i, 0, app.buf.cols, lines).trim())?.[1])
    .filter(Boolean).map(Number);
});
const ALL_BODY_LINES = lines => Array.from({ length: lines - 4 }, (_, i) => i + 4);

test('Back from the results to a partly read source keeps it and pages PTT on from where the reading stopped (#121)', async ({ page }) => {
  const lines = 200;
  const { row, stopped } = await partlyReadSource(page, { lines, stop: 70 });
  const sent = await backToPartlyRead(page);
  // PTT's pager was sought to the line the reading stopped at, not paged
  // there from the top.
  expect(sent).toContain(`:${stopped}\r`);
  expect(sent.filter(bytes => bytes === '\x1b[6~').length).toBeLessThan(Math.ceil((lines - 23) / 23));
  await expect.poll(() => bodyLineNumbers(page)).toEqual(ALL_BODY_LINES(lines));
  expect(await rowAtTop(page, MAIN)).toEqual(row);
  expect(await recordedHints(page)).not.toContain(UPDATED);
});

test('a partly read source whose start was edited while the reader was away gives way to PTT\'s copy, with a notice (#121)', async ({ page }) => {
  const lines = 200;
  await partlyReadSource(page, { lines, stop: 70 });
  const sent = await backToPartlyRead(page, () => page.evaluate(() => {
    window.__alpha.text = { ...window.__alpha.text, 10: 'Alpha line 09: rewritten by its author' };
  }));
  await expect.poll(async () => (await recordedHints(page)).at(-1)).toBe(UPDATED);
  expect(sent.some(bytes => bytes.startsWith(':'))).toBe(false);
  await expect.poll(() => bodyLineNumbers(page)).toEqual(ALL_BODY_LINES(lines));
  const texts = await page.evaluate(() => {
    const app = window.__app;
    const lines = app.buf.pageLines;
    return lines.map((_, i) => app.buf.getRowText(i, 0, app.buf.cols, lines).trim());
  });
  expect(texts).toContain('Alpha line 09: rewritten by its author');
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

// Alpha `lines` long, opened from the board's list and scrolled to its end
// as a reader does. Its long page is split into chunks that the browser lays
// out only near the view; the scrolling has laid out each one. Returns the row
// at the top of the view.
async function sourceScrolledToItsEnd(page, lines) {
  await bootNestedShortcutSearch(page, { easyList: true, alphaLines: 80 });
  // PTT's copy is this long when the list opens it.
  await page.evaluate(lines => { window.__shortcutServer.state.open.lines = lines; }, lines);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, FULL_LIST);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await expect.poll(async () => {
    await ptt.sendKey(page, 'PageDown');
    return page.evaluate(() => window.__app.easyReading.easyReadingReachedPageEnd);
  }, { timeout: 30000 }).toBe(true);
  await settled(page);
  await expect.poll(() => page.evaluate(async main => {
    const view = document.querySelector(main);
    view.scrollTop += view.clientHeight;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return view.scrollTop + view.clientHeight >= view.scrollHeight - 2;
  }, MAIN), { timeout: 30000 }).toBe(true);
  await settled(page);
  return rowAtTop(page, MAIN);
}

test('half a swipe back from the results shows a long source scrolled to its end at its reading position', async ({ page }) => {
  const row = await sourceScrolledToItsEnd(page, 320);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  const box = await page.locator(MAIN).boundingBox();
  const y = box.y + box.height / 2;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 140, y });
  await expect(page.locator('[data-article-exit-underlay]')).toHaveAttribute('data-preview', 'layer');
  await expect.poll(() => rowAtTop(page, ARTICLE_LAYER)).toEqual(row);
  await contact.move({ x: box.width - 20, y });
  await contact.release();
  await waitArticle(page, 'Alpha');
  await settled(page);
  expect(await rowAtTop(page, MAIN)).toEqual(row);
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

// A second Back before PTT reopens the source already left it (#125): when
// the source turns out deleted, PTT's board list takes over the list shown,
// and the source is not shown again over it.
test('a deleted source left by a later Back gives way to PTT\'s board list (#121, #125)', async ({ page }) => {
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await page.evaluate(() => window.__shortcutServer.state.deleted.add('1gIeu-3A'));
  await settled(page);
  const release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await nativeBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  // How the handoff ends: the source found deleted, with a later Back made.
  await page.evaluate(() => {
    const stack = window.__app.articleGestures.stack;
    const end = stack._end.bind(stack);
    window.__ends = [];
    stack._end = how => { window.__ends.push(how); return end(how); };
  });
  await release();
  await expect.poll(() => page.evaluate(() => window.__ends)).toEqual(['unexpected']);
  await page.waitForFunction(() => {
    const app = window.__app;
    return app.buf.pageState === 2 && !app.articleGestures.stack.handingOff && app.commandQueue.idle;
  }, null, { timeout: 10000 });
  await waitList(page, { has: ['Beta topic', 'Delta topic'] });
  await expect(page.locator('[data-stack-layer]:not([data-stack-parked])')).toHaveCount(0);
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  expect(await page.evaluate(() => window.__app.articleGestures.stack.gone)).toBeNull();
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

// Loaded inline image previews under `root`: shown, not their placeholders.
const loadedPreviews = (page, root) => page.evaluate(root => [...document.querySelectorAll(`${root} img.easyReadingImg`)]
  .filter(img => !img.classList.contains('inlinePreviewGhost') && img.complete && img.naturalWidth > 0 &&
    img.getBoundingClientRect().height > 0).length, root);

test('the source revealed by Back from the results shows the image previews the reader saw', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, images: true });
  await expect.poll(() => loadedPreviews(page, MAIN)).toBe(1);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  const release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await expect.poll(() => loadedPreviews(page, ARTICLE_LAYER)).toBe(1);
  await release();
  await waitArticle(page, 'Alpha');
});

test('Back from the results to the source never tells the reader the connection was restored', async ({ page }) => {
  await sourceFromList(page);
  for (let round = 0; round < 2; round++) {
    await tapShortcut(page, 'author');
    await waitList(page, AUTHOR_RESULTS);
    await settled(page);
    await recordHints(page);
    await nativeBack(page);
    await waitArticle(page, 'Alpha');
    await settled(page);
    // Reopening the source is search backtracking, not a reconnect.
    expect((await recordedHints(page)).filter(hint => /斷線|reconnect/i.test(hint))).toEqual([]);
  }
});

// Hold every key sent to PTT that `held` matches, from now until the returned
// `release()` sends them in order and lets later ones through.
async function holdSends(page, held) {
  await page.evaluate(held => {
    const send = window.__stubWSSent;
    const match = new RegExp(held);
    window.__heldSends = [];
    window.__stubWSSent = data => {
      if (!match.test(data)) return send(data);
      window.__heldSends.push(() => send(data));
    };
    window.__releaseSends = () => {
      window.__stubWSSent = send;
      window.__heldSends.splice(0).forEach(sendHeld => sendHeld());
    };
  }, held.source);
  return () => page.evaluate(() => window.__releaseSends());
}

// A swipe right across the revealed source, from its left edge.
async function swipeRightOver(page, root) {
  const box = await page.locator(root).boundingBox();
  const y = box.y + box.height / 2;
  const contact = await beginArticleTouch(page, { x: box.x + 20, y });
  await contact.move({ x: box.x + 140, y });
  await contact.move({ x: box.x + box.width - 20, y });
  await contact.release();
}

test('a swipe on the source revealed by Back from the results reveals its list at once, before PTT has answered', async ({ page }) => {
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  const release = await holdSends(page, /./);
  await nativeBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__heldSends.length)).toBeGreaterThan(0);
  await swipeRightOver(page, ARTICLE_LAYER);
  await expect(page.locator(LIST_LAYER)).toBeVisible();
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  const before = await cardOffset(page, LIST_LAYER, 'Alpha topic');
  // PTT follows: it reopens the source, then leaves it for the list.
  await release();
  await expect(page.locator(LIST_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitList(page, FULL_LIST);
  await settled(page);
  expect(Math.abs(await cardOffset(page, `${MAIN} .listBodyView`, 'Alpha topic') - before)).toBeLessThanOrEqual(1);
});

// A page that leaves keeps no scroll of its own (#119): the revealed source
// being swiped away cannot scroll natively, so no fling outlives it for the
// next tap to stop instead of clicking. Snapped back, it scrolls again.
test('the revealed source cannot scroll while it is swiped away, and scrolls again once it snaps back', async ({ page }) => {
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  await holdSends(page, /./);
  await nativeBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__heldSends.length)).toBeGreaterThan(0);
  const overflow = () => page.locator(ARTICLE_LAYER).evaluate(el => getComputedStyle(el).overflowY);
  const scrolling = await overflow();
  expect(scrolling).not.toBe('hidden');
  const box = await page.locator(ARTICLE_LAYER).boundingBox();
  const y = box.y + box.height / 2;
  const contact = await beginArticleTouch(page, { x: box.x + 20, y });
  await contact.move({ x: box.x + 140, y });
  expect(await overflow()).toBe('hidden');
  await contact.move({ x: box.x + 30, y });
  await contact.release();
  await expect.poll(overflow).toBe(scrolling);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
});

test('a swipe on the source revealed by Back from the results reveals its list at once while PTT\'s copy still pages to the reading position', async ({ page }) => {
  await longSourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  // PTT reopens the source, but pages it on only once released.
  const release = await holdSends(page, /\x1b\[6~|^:/);
  await nativeBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__heldSends.length)).toBeGreaterThan(0);
  // PTT shows the source again; the layer stays until PTT's copy reaches it.
  await page.waitForFunction(() => window.__app.articleGestures.stack.handoff?.presentedAt != null);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await swipeRightOver(page, ARTICLE_LAYER);
  await expect(page.locator(LIST_LAYER)).toBeVisible();
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  await release();
  await expect(page.locator(LIST_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitList(page, FULL_LIST);
});

// The source revealed by Back from the results, every key to PTT held from
// the Back on, so PTT has not reopened it yet.
async function revealSourceHeld(page) {
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  const release = await holdSends(page, /./);
  await nativeBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__heldSends.length)).toBeGreaterThan(0);
  return release;
}

test('a swipe on the revealed source goes on while PTT reopens the source under the finger', async ({ page }) => {
  const release = await revealSourceHeld(page);
  const box = await page.locator(ARTICLE_LAYER).boundingBox();
  const y = box.y + box.height / 2;
  const contact = await beginArticleTouch(page, { x: box.x + 20, y });
  await contact.move({ x: box.x + 140, y });
  // PTT answers mid-swipe: its screens arrive while the finger is down.
  await release();
  await page.waitForFunction(() => window.__app.articleGestures.stack.handoff?.presentedAt != null);
  await contact.move({ x: box.x + box.width - 20, y });
  await contact.release();
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  await waitList(page, FULL_LIST);
});

test('the keypad\'s ← on the revealed source reveals its list at once, before PTT has answered', async ({ page }) => {
  const release = await revealSourceHeld(page);
  await page.locator('#mobileToolbar [data-key="__keys"]').tap();
  await page.locator('#mobileKeypad [data-key="ArrowLeft"]').tap();
  await expect(page.locator(LIST_LAYER)).toBeVisible();
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  await release();
  await expect(page.locator(LIST_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitList(page, FULL_LIST);
});

// A swipe left across the revealed source, from its right edge.
async function swipeLeftOver(page, root) {
  const box = await page.locator(root).boundingBox();
  const y = box.y + Math.min(100, box.height / 2);
  const contact = await beginArticleTouch(page, { x: box.x + box.width - 24, y });
  await contact.move({ x: box.x + box.width - 140, y });
  await contact.move({ x: box.x + 12, y });
  await contact.release();
}

// Counts the shortcut searches started from now on.
const countSearchStarts = page => page.evaluate(() => {
  const search = window.__app.articleShortcutSearch;
  const start = search.start.bind(search);
  window.__searchStarts = 0;
  search.start = kind => {
    window.__searchStarts++;
    return start(kind);
  };
});
const searchStarts = page => page.evaluate(() => window.__searchStarts);

test('a left swipe on the revealed source opens its drawer at once, and a search from it runs once the source takes over', async ({ page }) => {
  const release = await revealSourceHeld(page);
  await countSearchStarts(page);
  await swipeLeftOver(page, ARTICLE_LAYER);
  await expect(page.locator('[data-article-drawer]')).toHaveAttribute('data-state', 'open');
  await page.locator('[data-article-shortcut="author"]').tap();
  await expect(page.locator('[data-article-drawer]')).toHaveCount(0);
  await expect.poll(() => pendingShown(page)).toBe(true);
  expect(await searchStarts(page)).toBe(0);
  await release();
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  expect(await searchStarts(page)).toBe(1);
  expect(await pendingShown(page)).toBe(false);
});

test('the toolbar of the revealed source opens its panels at once, and a key from it reaches the source once it takes over', async ({ page }) => {
  const release = await revealSourceHeld(page);
  await page.evaluate(() => {
    const reading = window.__app.easyReading;
    const stick = reading._stickBottom.bind(reading);
    window.__ends = [];
    reading._stickBottom = () => {
      window.__ends.push(!!window.__app.articleGestures.stack.handingOff);
      return stick();
    };
  });
  const toolbar = key => page.locator(`#mobileToolbar [data-key="${key}"]`);
  await toolbar('__more').tap();
  await expect(page.locator('[data-sheet="more"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-sheet="more"]')).toHaveCount(0);
  await toolbar('__keys').tap();
  await expect(page.locator('#mobileKeypad')).toBeVisible();
  await toolbar('__keys').tap();
  await toolbar('__end').tap();
  await expect.poll(() => pendingShown(page)).toBe(true);
  expect(await page.evaluate(() => window.__ends)).toEqual([]);
  await release();
  await waitArticle(page, 'Alpha');
  await settled(page);
  await expect.poll(() => page.evaluate(() => window.__ends)).toEqual([false]);
  expect(await pendingShown(page)).toBe(false);
});

// Every byte PTT receives from now on, in order.
const recordReceived = page => page.evaluate(() => {
  const send = window.__stubWSSent;
  window.__received = [];
  window.__stubWSSent = data => {
    window.__received.push(data);
    return send(data);
  };
});
const received = page => page.evaluate(() => window.__received.join(''));

test('the search dialog opens at once on a revealed list, and its search goes out once, after the list takes over', async ({ page }) => {
  await sourceFromList(page);
  await recordReceived(page);
  const release = await holdSends(page, /./);
  await nativeBack(page);
  await expect(page.locator(LIST_LAYER)).toBeVisible();
  await page.locator('#mobileToolbar [data-key="__search"]').tap();
  const input = page.locator('input[name="searchKeyword"]');
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.__app.articleGestures.stack.handingOff)).toBe(true);
  await input.fill('Beta');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect.poll(() => pendingShown(page)).toBe(true);
  // Nothing of the search reaches PTT before the list takes over.
  expect(await page.evaluate(() => window.__received.join(''))).not.toContain('Beta');
  await release();
  await waitList(page, { has: ['Beta topic'], lacks: ['Alpha topic', 'Delta topic'] });
  await settled(page);
  expect((await received(page)).split('Beta').length - 1).toBe(1);
});

test('Share on the revealed source shares its link at once, within the tap, without asking PTT', async ({ page }) => {
  const release = await revealSourceHeld(page);
  await recordReceived(page);
  await page.evaluate(() => {
    window.__shared = [];
    navigator.share = data => {
      window.__shared.push({ url: data.url, title: data.title, active: navigator.userActivation.isActive });
      return Promise.resolve();
    };
  });
  await page.locator('#mobileToolbar [data-key="__more"]').tap();
  await page.locator('[data-key="__share"]').tap();
  const shared = await page.evaluate(() => window.__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].url).toContain('#Test/M.1783270974.A.0CA');
  expect(shared[0].active).toBe(true);
  expect(await pendingShown(page)).toBe(false);
  await release();
  await waitArticle(page, 'Alpha');
  await settled(page);
  // No article info box asked of PTT, and no second share.
  expect(await received(page)).not.toContain('Q');
  expect(await page.evaluate(() => window.__shared.length)).toBe(1);
});

// Home dashboard → board Test → Alpha read to its middle, each page alive
// under the next.
async function alphaFromDashboard(page) {
  await bootNestedShortcutSearch(page, { easyList: true, loggedIn: true, homeMenu: true, ptList: true });
  await ptt.applyPrefs(page, { enableHomeDashboard: true });
  // Favorites already fetched: the dashboard fetches nothing from this board.
  await page.evaluate(() => {
    const home = window.__app.homeDashboard;
    home._state.fetchedAt = Date.now();
    home._set({ boards: [{ name: 'Test', desc: 'controlled' }] });
  });
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, FULL_LIST);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitScreenSettled(page, { 0: '主功能表' });
  await dashboardVisible(page);
  await page.locator('#homeDashboard [data-home-board="Test"]').tap();
  await waitList(page, FULL_LIST);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await readToMiddle(page);
}

for (const [how, again] of [
  ['Back', page => nativeBack(page)],
  ['swipe', page => swipeRightOver(page, LIST_LAYER)]
]) {
  test(`a ${how} made while a swipe on the revealed source still settles reveals the page below its list`, async ({ page }) => {
    await alphaFromDashboard(page);
    await tapShortcut(page, 'author');
    await waitList(page, AUTHOR_RESULTS);
    await settled(page);
    const release = await holdSends(page, /./);
    await nativeBack(page);
    await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__heldSends.length)).toBeGreaterThan(0);
    await swipeRightOver(page, ARTICLE_LAYER);
    await expect(page.locator(LIST_LAYER)).toBeVisible();
    // The swipe's slide has not ended yet.
    expect(await page.evaluate(() => !!window.__app.articleGestures.layerExit)).toBe(true);
    await again(page);
    await expect(page.locator('[data-stack-layer="home"]')).toBeVisible();
    await expect(page.locator(LIST_LAYER)).toHaveCount(0);
    await release();
    await expect(page.locator('#homeDashboard')).toBeVisible({ timeout: 10000 });
  });
}

test('search backtracking back to the source article shows it without a notice', async ({ page }) => {
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  await recordHints(page);
  await nativeBack(page);
  await waitArticle(page, 'Alpha');
  await settled(page);
  await page.waitForTimeout(500); // sleep-ok: a notice after the takeover would show by now
  expect(await recordedHints(page)).toEqual([]);
});

// PTT's last answer on the results can still be settling when Back's board
// jump goes out: local repaints of the reveal hold its settle back past the
// send. That settle shows the results, not the board the jump asked for.
test('Back from the results reopens the source though the results still settle after the board jump went out', async ({ page }) => {
  await sourceFromList(page, { ptList: true });
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  await page.evaluate(() => {
    const app = window.__app;
    const queue = app.commandQueue;
    const enqueue = queue.enqueue.bind(queue);
    const send = window.__stubWSSent;
    window.__heldSends = null;
    queue.enqueue = cmd => {
      if (cmd.kind === 'aid-board-jump' && !window.__heldSends) {
        // A late cursor park of the results arrives just before the jump...
        app.onData('\x1b[4;1H');
        // ...and PTT answers the jump only after that settle.
        window.__heldSends = [];
        window.__stubWSSent = data => window.__heldSends.push(data);
        window.__releaseSends = () => {
          window.__stubWSSent = send;
          window.__heldSends.splice(0).forEach(send);
        };
      }
      return enqueue(cmd);
    };
  });
  await nativeBack(page);
  await expect(page.locator(ARTICLE_LAYER)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__heldSends?.length || 0)).toBeGreaterThan(0);
  // The late answer's settle has fired.
  await expect.poll(() => page.evaluate(() => !window.__app.buf._settleTimer && !window.__app.buf.timerUpdate)).toBe(true);
  const held = await page.evaluate(() => window.__heldSends);
  expect(held[0]).toMatch(/^sTest\r/);
  // No ← follows the board jump: the stale settle is no answer to it.
  expect(held.slice(1).filter(data => data.includes('\x1b[D'))).toEqual([]);
  await page.evaluate(() => window.__releaseSends());
  await waitArticle(page, 'Alpha');
  await settled(page);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(3);
});

test('a revealed source with inline previews goes when PTT shows the main menu instead', async ({ page }) => {
  await bootNestedShortcutSearch(page, { easyList: true, images: true, homeMenu: true, ptList: true });
  await ptt.applyPrefs(page, { enableHomeDashboard: true });
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, FULL_LIST);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  // PTT keeps what it is sent, and the reader sees the source's previews.
  await page.evaluate(() => { window.__stubWSSent = () => {}; });
  await nativeBack(page);
  await expect(page.locator(`${ARTICLE_LAYER} img`).first()).toBeVisible();
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'main';
    server.state.filter = null;
    window.__app.onData(server.frame(true));
  });
  await expect(page.locator('#homeDashboard')).toBeVisible();
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
});
