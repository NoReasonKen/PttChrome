// Shared steps for replaying the stacked-page routes (scn-stack-*.json).
const { expect } = require('@playwright/test');
const { installPaintedFrameProbe, waitRectStable } = require('./layout');
const ptt = require('./ptt');
const { bootOffline, bootScenario, loadCassette, replayListCassette } = require('./replay');

// Steps fed once the route has settled before the `n`th `on` step: the jump
// right before that step syncs PTT's cursor to the selection, and the app sends
// it only with the next key.
const fedBefore = (cassette, on, n) => {
  let seen = 0;
  const at = cassette.steps.findIndex(step => step.on === on && ++seen === n);
  if (at < 0) throw new Error(`no ${n}th ${on} step`);
  return cassette.steps[at - 1].on === 'jump' ? at - 1 : at;
};

// The next-article card's own route to the next article (s<board>, its number,
// open). Replay answers each send at once, so the list page an open passes
// through never settles and the card cannot place the article; the route is
// taken directly with the number the recording opened.
async function openNextArticle(page, cassette) {
  const first = await page.evaluate(() => window.__app.easyReading._articleKey);
  const route = cassette.steps.findIndex(step => step.on === 'raw' && /^s\w+\r/.test(atobText(step.send)));
  const num = cassette.steps.slice(route).find(step => step.on === 'jump').num;
  expect(await page.evaluate(([board, n]) => window.__app.aidNavigation.startNum(board, n, () => {}), ['C_Chat', num])).toBeTruthy();
  await page.waitForFunction(key => window.__app.aidNavigation.active === false && window.__app.easyReading._articleKey !== key, first);
}

const atobText = b64 => Buffer.from(b64, 'base64').toString('latin1');

// The real screen; a revealed stacked page is a second copy beside it.
const MAIN = '.main:not([data-stack-layer])';

// An easy-reading article list of C_Chat, idle, with a card per article
// (cchat-list-nav.json).
async function bootArticleList(page) {
  const nav = loadCassette('cchat-list-nav');
  await bootOffline(page, ptt, { articleGestures: true });
  await ptt.applyPrefs(page, { enableEasyReading: true, enableEasyReadingList: false, useMouseBrowsing: true, mouseLeftClick: true });
  await replayListCassette(page, nav);
  await page.waitForFunction(() => window.__app.buf.pageState === 2);
  await ptt.applyPrefs(page, { enableEasyReadingList: true, easyReadingListPrefetchCount: 200 });
  await page.waitForFunction(() => window.__app.listSession.state === 'active' &&
    window.__app.commandQueue.idle && window.__app.buf.listLines.length > 50);
}

const homeBoard = loadCassette('scn-stack-home-board');
const boardList = loadCassette('scn-stack-boardlist-board');

const listActive = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 2 && app.listSession.state === 'active' && app.commandQueue.idle && !app.buf._settleTimer;
});

const dashboardVisible = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.homeDashboard.state.visible === true && app.commandQueue.idle && !app.buf._settleTimer;
});

// Enough favorites for the dashboard to scroll; C_Chat is the recorded board.
const FAVORITES = [{ name: 'C_Chat', desc: 'recorded' }].concat(
  Array.from({ length: 40 }, (_, i) => ({ name: 'Fav' + i, desc: 'favorite ' + i })));

// The recorded dashboard, shown with FAVORITES.
async function bootDashboard(page, cassette = homeBoard) {
  await bootScenario(page, ptt, cassette);
  await page.evaluate((boards) => {
    const home = window.__app.homeDashboard;
    home._state.fetchedAt = Date.now();
    home._set({ boards });
  }, FAVORITES);
  await ptt.applyPrefs(page, cassette.meta.prefs);
  await page.evaluate(() => window.__app.onData('\x1b[H'));
  await dashboardVisible(page);
}

// The board search the dashboard (or the search key) sent reached C_Chat.
async function boardOpened(page) {
  await page.waitForFunction(() => window.__app.buf.isPassScreenNow() || window.__app.buf.pageState === 2);
  if (await page.evaluate(() => window.__app.buf.isPassScreenNow())) await ptt.sendKey(page, 'Space');
  await listActive(page);
}

const boardListEngaged = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.listRenderOwner === 'board-list' && app.boardListSession.state === 'active' &&
    app.commandQueue.idle && !app.buf._settleTimer;
});

// A board list engaged in smooth scrolling, the recorded board selected
// (scn-stack-boardlist-board.json).
async function bootBoardList(page) {
  await bootScenario(page, ptt, boardList);
  await ptt.applyPrefs(page, { enableEasyReadingList: true, enableBoardListSmoothScroll: true });
  await boardListEngaged(page);
}

// The list card of an article in cchat-list-nav.json.
const ARTICLE_CARD = `${MAIN} .listCard[data-list-author="kylin936"] .listCardBody`;

// The article list, with ARTICLE_CARD scrolled into view and at rest.
async function bootArticleListAtCard(page) {
  await bootArticleList(page);
  await page.locator(ARTICLE_CARD).first().scrollIntoViewIfNeeded();
  await waitRectStable(page, ARTICLE_CARD);
}

// PTT's replies from now on wait until a page opened meanwhile has painted at
// rest, then arrive with a network's latency. A long fixed delay instead races
// the open's own step timeout on a slow runner (#50).
const holdRepliesUntilEntryRests = page => page.evaluate(() => {
  const send = window.__stubWSSent;
  const reply = data => setTimeout(() => send(data), 100);
  const held = [];
  let rested = false;
  window.__stubWSSent = data => rested ? reply(data) : held.push(data);
  const release = () => {
    rested = true;
    held.splice(0).forEach(reply);
  };
  const wait = () => {
    if (!window.__app.articleGestures.entry?.arrived) return requestAnimationFrame(wait);
    // One more frame, so the frame at rest is painted first.
    requestAnimationFrame(release);
  };
  requestAnimationFrame(wait);
});

// Every notice the app flashes from now on, in order.
const recordHints = page => page.evaluate(() => {
  window.__hints = [];
  const flash = window.__app.view.flashListHint.bind(window.__app.view);
  window.__app.view.flashListHint = (text, ...rest) => { window.__hints.push(text); return flash(text, ...rest); };
});
const recordedHints = page => page.evaluate(() => window.__hints);

// PTT never answers from now on.
const dropReplies = page => page.evaluate(() => {
  window.__stubWSSent = () => {};
});

// Hold PTT's reply to the next leave (←) until the returned `release()`.
async function holdBackReply(page) {
  await page.evaluate(() => {
    const send = window.__stubWSSent;
    window.__heldBack = null;
    window.__stubWSSent = (data) => {
      if (data.indexOf('\x1b[D') < 0 || window.__heldBack) return send(data);
      window.__heldBack = () => send(data);
    };
  });
  return () => page.evaluate(() => window.__heldBack());
}

// The leave was sent and its reply is being held.
const heldBack = page => expect.poll(() => page.evaluate(() => !!window.__heldBack)).toBe(true);

// Hold PTT's reply to every leave (←) until released, oldest first. Each held
// leave records which stack layers were on screen when it was sent.
const holdLeaves = page => page.evaluate(() => {
  const send = window.__stubWSSent;
  window.__heldLeaves = [];
  window.__leaves = [];
  window.__stubWSSent = data => {
    if (data.indexOf('\x1b[D') < 0) return send(data);
    window.__leaves.push([...document.querySelectorAll('[data-stack-layer]')].map(el => el.dataset.stackLayer));
    window.__heldLeaves.push(() => send(data));
  };
});
const heldLeaves = page => page.evaluate(() => window.__heldLeaves.length);
const releaseLeave = page => page.evaluate(() => window.__heldLeaves.shift()());
// The stack layers on screen as each leave was sent.
const sentLeaves = page => page.evaluate(() => window.__leaves);

const articleRead = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.easyReading.easyReadingReachedPageEnd && app.commandQueue.idle && !app.buf._settleTimer;
});

// The list also has articleHorizontalGestures. Wait for actual article entry
// and settled rendering before returning; loading the entire article is separate.
async function waitArticleOpened(page, { timeout = 15000 } = {}) {
  const deadline = performance.now() + timeout;
  await page.waitForFunction(() => {
    const app = window.__app;
    return app.buf.pageState === 3 && app.view.useEasyReadingMode &&
      app.commandQueue.idle && !app.buf.timerUpdate && !app.buf._settleTimer;
  }, null, { timeout });
  return waitRectStable(page, MAIN, { fullRect: true, timeout: Math.max(1, deadline - performance.now()) });
}

// Every painted frame from now on: is the old article on screen? Sampled just
// before paint (helpers/layout.js#installPaintedFrameProbe).
async function sampleFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(() => {
    window.__frames = [];
    const sample = () => {
      const main = document.querySelector('.main:not([data-stack-layer])');
      const underlay = document.querySelector('[data-article-exit-underlay]');
      const listShown = window.__app.buf.pageState === 2 && !!main.querySelector('.listBodyView');
      window.__frames.push({ left: Math.round(main.getBoundingClientRect().left), underlay: !!underlay, listShown });
      const done = window.__frames.length >= 600 || (!underlay && listShown && window.__frames.length >= 5);
      if (done) window.__paintedFrame.remove(sample);
    };
    window.__paintedFrame.add(sample);
  });
}

// The sampled frames where the old article comes back: it slides back over the
// revealed layer, or neither it nor the presented real list is on screen.
const framesBringingBackArticle = frames =>
  frames.filter((f, i) => f.underlay ? i > 0 && f.left < frames[i - 1].left - 1 : !f.listShown);

// Note whether any page is revealed from now on.
const watchReveals = page => page.evaluate(() => {
  window.__revealed = false;
  new MutationObserver(() => {
    if (document.querySelector('[data-stack-layer], [data-article-exit-underlay]')) window.__revealed = true;
  }).observe(document.body, { childList: true, subtree: true });
});
const revealedSinceWatch = page => page.evaluate(() => window.__revealed);

module.exports = {
  MAIN, ARTICLE_CARD, homeBoard, boardList, bootArticleList, bootArticleListAtCard, holdRepliesUntilEntryRests, dropReplies, recordHints, recordedHints, listActive, dashboardVisible, bootDashboard, boardOpened, boardListEngaged, bootBoardList,
  fedBefore, openNextArticle, holdBackReply, heldBack, holdLeaves, heldLeaves, releaseLeave, sentLeaves, articleRead, waitArticleOpened,
  sampleFrames, framesBringingBackArticle, watchReveals, revealedSinceWatch
};
