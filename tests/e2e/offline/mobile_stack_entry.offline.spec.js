// Opening an article or a board slides the new page in over the page it is
// opened from (#36). The new page shows the existing loading state until PTT
// answers, and a failed open slides it back out. PTT's replies are delayed, so
// every painted frame of the motion is observable.
const { test, expect } = require('@playwright/test');
const { installPaintedFrameProbe, waitRectStable } = require('../helpers/layout');
const ptt = require('../helpers/ptt');
const { MAIN, bootArticleList, bootDashboard, boardOpened, bootBoardList, listActive } = require('../helpers/stack_routes');

const CARD = `${MAIN} .listCard[data-list-author="kylin936"] .listCardBody`;
const REPLY_DELAY_MS = 700;
// The new page's screen settles a few px from where the old one rests.
const SETTLED = 3;

// Every reply from PTT from now on arrives `delay` ms late.
const delayReplies = (page, delay) => page.evaluate((delay) => {
  const send = window.__stubWSSent;
  window.__stubWSSent = data => setTimeout(() => send(data), delay);
}, delay);

// PTT never answers from now on.
const dropReplies = page => page.evaluate(() => {
  window.__stubWSSent = () => {};
});

// Every painted frame from now on: how far the real screen is from where it
// rests, what it shows, whether the page it is opened from shows beside it,
// and whether the loading state is on. Sampling ends once the motion is over
// and the real screen shows something.
async function sampleEntryFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate((SETTLED) => {
    window.__frames = [];
    window.__framesDone = false;
    const rest = Math.round(document.querySelector('.main:not([data-stack-layer])').getBoundingClientRect().left);
    const visible = el => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const shown = main => {
      const app = window.__app;
      if (![...main.children].some(visible)) return 'blank';
      if (app.buf.pageState === 3) return 'article';
      if (!visible(main.querySelector('.listBodyView'))) return 'other';
      return app.buf.listRenderOwner === 'board-list' ? 'boards' : 'articles';
    };
    const sample = () => {
      const main = document.querySelector('.main:not([data-stack-layer])');
      window.__frames.push({
        left: Math.round(main.getBoundingClientRect().left) - rest, shows: shown(main),
        lower: visible(document.querySelector('[data-stack-layer]')),
        home: visible(document.querySelector('#homeDashboard:not([data-stack-layer])')),
        loading: visible(document.querySelector('.ListLoadingHint'))
      });
      const at = window.__frames[window.__frames.length - 1];
      const over = at.shows !== 'blank' && at.left <= SETTLED && !document.querySelector('[data-stack-entry-underlay]') &&
        window.__frames.some(f => f.shows === 'blank');
      if (!over && window.__frames.length < 900) return;
      window.__paintedFrame.remove(sample);
      window.__framesDone = true;
    };
    window.__paintedFrame.add(sample);
  }, SETTLED);
}

// The frames once the motion is over.
async function sampledFrames(page) {
  await page.waitForFunction(() => window.__framesDone, null, { timeout: 10000 });
  return page.evaluate(() => window.__frames);
}

// The new page came in from the right over the page it is opened from and
// never moved back; it showed only the loading state, also at rest, until PTT
// answered with something other than `from`.
function expectSlidIn(frames, width, from) {
  const start = frames.findIndex(f => f.left > SETTLED);
  expect(start).toBeGreaterThanOrEqual(0);
  const moving = frames.slice(start);
  expect(moving[0].left).toBeGreaterThan(width / 2);
  expect(moving.filter((f, i) => i > 0 && f.left > moving[i - 1].left + SETTLED)).toEqual([]);
  expect(moving.filter(f => f.left > SETTLED && !f.lower)).toEqual([]);
  expect(moving.filter(f => f.shows === from || f.home)).toEqual([]);
  expect(moving.filter(f => f.shows === 'blank' && !f.loading)).toEqual([]);
  expect(moving.some(f => f.shows === 'blank' && f.left <= SETTLED)).toBe(true);
}

async function bootListAtCard(page) {
  await bootArticleList(page);
  await page.locator(CARD).first().scrollIntoViewIfNeeded();
  await waitRectStable(page, CARD);
}

test('opening an article slides it in over the list, loading until PTT answers', async ({ page }) => {
  await bootListAtCard(page);
  await delayReplies(page, REPLY_DELAY_MS);
  await sampleEntryFrames(page);
  await page.locator(CARD).first().tap();
  const frames = await sampledFrames(page);
  expect(frames.at(-1)).toMatchObject({ shows: 'article', lower: false });
  expectSlidIn(frames, page.viewportSize().width, 'articles');
});

test('an open PTT never answers slides back out over the list, with today\'s notice', async ({ page }) => {
  await bootListAtCard(page);
  await dropReplies(page);
  await sampleEntryFrames(page);
  await page.locator(CARD).first().tap();
  await expect(page.getByText('開啟文章失敗，已切至原生模式')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-stack-entry-underlay], [data-stack-layer]')).toHaveCount(0);
  const frames = await sampledFrames(page);
  const width = page.viewportSize().width;
  // In at rest, loading; then back out to the right over the list, and the
  // new page never shows anything but the loading state.
  const rest = frames.findIndex(f => f.shows === 'blank' && f.left <= SETTLED);
  expect(rest).toBeGreaterThanOrEqual(0);
  const out = frames.slice(rest).findIndex(f => f.left >= width - 5);
  expect(out).toBeGreaterThan(0);
  const back = frames.slice(rest, rest + out + 1);
  expect(back.filter((f, i) => i > 0 && f.left < back[i - 1].left)).toEqual([]);
  expect(back.filter(f => f.shows !== 'blank' || (f.left > SETTLED && !f.lower))).toEqual([]);
});

test('opening a board from the dashboard slides it in over the dashboard, showing the board\'s entry screen', async ({ page }) => {
  await bootDashboard(page);
  await delayReplies(page, REPLY_DELAY_MS);
  await sampleEntryFrames(page);
  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  const frames = await sampledFrames(page);
  // The recorded board shows its entry screen first.
  expect(frames.at(-1)).toMatchObject({ shows: 'other', lower: false });
  expect(await page.evaluate(() => window.__app.buf.isPassScreenNow())).toBe(true);
  expectSlidIn(frames, page.viewportSize().width, 'boards');
  await boardOpened(page);
});

test('opening a board from a board list slides its article list in over the board list', async ({ page }) => {
  await bootBoardList(page);
  await delayReplies(page, REPLY_DELAY_MS);
  await sampleEntryFrames(page);
  await ptt.sendKey(page, 'Enter');
  const frames = await sampledFrames(page);
  expect(frames.at(-1)).toMatchObject({ shows: 'articles', lower: false });
  expectSlidIn(frames, page.viewportSize().width, 'boards');
  await listActive(page);
});
