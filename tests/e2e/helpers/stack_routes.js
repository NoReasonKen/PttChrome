// Shared steps for replaying the stacked-page routes (scn-stack-*.json).
const { expect } = require('@playwright/test');

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

module.exports = { fedBefore, openNextArticle };
