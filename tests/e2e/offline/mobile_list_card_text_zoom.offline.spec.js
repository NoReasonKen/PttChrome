// A system font size other than the default scales the text a WebView renders,
// not the cell height the app lays the list out with. Each card must still be
// exactly LIST_CARD_ROWS cells tall: the tap maths, the scroll position and the
// prefetch shift all count cards in cells, so a card a few pixels short opened
// an article several cards above the one tapped, more the further down the list.
const { test, expect } = require('@playwright/test');
const { bootArticleList } = require('../helpers/stack_routes');
const { waitRectStable } = require('../helpers/layout');

const MAIN = '.main:not([data-stack-layer])';

// What a WebView's text zoom does: the text is drawn at another size than the
// app set, while the row height (a px line-height) stays.
const zoomText = (page, factor) =>
  page.evaluate((f) => {
    const style = document.createElement('style');
    style.textContent = `${'.main'} { font-size: ${window.__app.view.chh * f}px !important; }`;
    document.head.appendChild(style);
  }, factor);

for (const factor of [0.85, 1.3]) {
  test(`a tapped card opens its own article under text zoom ${factor}`, async ({ page }) => {
    await bootArticleList(page);
    await zoomText(page, factor);
    const body = page.locator(`${MAIN} .listBodyView`);
    await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForFunction(() => window.__app.commandQueue.idle && !window.__app.buf._settleTimer);

    const cell = await page.evaluate(() => window.__app.view.chh);
    const heights = await page.locator(`${MAIN} .listBodyView > span.listCard`).evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeCloseTo(cell * 3, 0);

    // The last card fully in view: the furthest from the list's start.
    const num = await page.evaluate((sel) => {
      const view = document.querySelector(sel).getBoundingClientRect();
      const cards = Array.from(document.querySelectorAll(`${sel} > span.listCard`));
      const card = cards.reverse().find((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom <= view.bottom && /\d{6}/.test(c.textContent);
      });
      card.setAttribute('data-zoom-target', '');
      return card.textContent.match(/\d{6}/)[0];
    }, `${MAIN} .listBodyView`);
    const target = `${MAIN} [data-zoom-target] .listCardBody`;
    await waitRectStable(page, target);
    const box = await page.locator(target).boundingBox();
    const before = await page.evaluate(() => window.__replay.sent.length);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => page.evaluate((n) => window.__replay.sent.slice(n).find((d) => /^\d+\r/.test(d)) || null, before))
      .toMatch(new RegExp(`^${num}\\r`));
  });
}
