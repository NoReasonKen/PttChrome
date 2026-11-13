const { test, expect } = require('@playwright/test');
const { bootNestedShortcutSearch, tapShortcut, waitList, waitArticle } = require('../helpers/article_shortcut_search');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { nextFrames } = require('../helpers/real_input');
const { recordSearchTaps, attachSearchTapFailure } = require('../helpers/search_tap_diagnostics');

test.afterEach(async ({ page }, info) => attachSearchTapFailure(page, info));

const TARGET = '.main:not([data-stack-layer]) .listCard[data-list-title*="Beta topic"] .listCardBody';

// Hold the real background response so discovering the top can straddle a
// browser touch. Neither reserve dimensions nor session geometry are mocked.
async function holdUpwardFill(page) {
  await page.evaluate(() => {
    const app = window.__app;
    const receive = app.onData;
    const held = [];
    app.onData = function (data) {
      if (app.commandQueue.inFlightKind === 'prefetch-up') held.push(data);
      else receive.call(this, data);
    };
    window.__heldListFill = {
      held,
      release() {
        app.onData = receive;
        for (const data of held.splice(0)) receive.call(app, data);
      }
    };
  });
}

async function releaseUpwardFill(page) {
  await page.evaluate(() => window.__heldListFill.release());
  await page.waitForFunction(() => {
    const app = window.__app;
    const screen = app.view.componentScreen;
    return app.listSession._edgeUp && !screen._listReserveTimer && !screen._listScrollBusy();
  });
  await nextFrames(page, 2);
}

for (const releaseAt of ['before contact', 'during contact']) {
  test(`a result tap opens its article when the top is discovered ${releaseAt}`, async ({ page }, info) => {
    await recordSearchTaps(page, () => bootNestedShortcutSearch(page));
    await holdUpwardFill(page);
    await tapShortcut(page, 'author');
    await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
    await page.waitForFunction(() => window.__heldListFill.held.length > 0);
    if (releaseAt === 'before contact') await releaseUpwardFill(page);

    const card = page.locator(TARGET);
    // The browser's native centering can expose reserve above the first row,
    // including during Playwright's preparation of the original result tap.
    await card.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await nextFrames(page, 2);
    if (releaseAt === 'during contact') {
      expect(await page.evaluate(() => window.__app.view.componentScreen.getListScrollTop())).toBeLessThan(0);
    }
    await info.attach('result-before-contact', { body: await page.screenshot(), contentType: 'image/png' });
    const point = await card.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { x: (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2,
        y: rect.top + rect.height / 2 };
    });
    const contact = await beginArticleTouch(page, point);
    if (releaseAt === 'during contact') await releaseUpwardFill(page);
    const after = await card.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    expect(Math.abs(after - point.y)).toBeLessThan(0.5);
    await contact.release({ pause: false });
    await waitArticle(page, 'Beta');
  });
}
