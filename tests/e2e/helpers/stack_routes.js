// Shared steps for replaying the stacked-page routes (scn-stack-*.json).
const { expect } = require('@playwright/test');
const { installPaintedFrameProbe } = require('./layout');

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

module.exports = { MAIN, fedBefore, openNextArticle, holdBackReply, heldBack, sampleFrames, framesBringingBackArticle };
