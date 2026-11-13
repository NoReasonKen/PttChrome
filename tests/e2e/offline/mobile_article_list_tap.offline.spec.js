const { test, expect } = require('@playwright/test');
const { bootNestedShortcutSearch, tapShortcut, waitList, waitArticle } = require('../helpers/article_shortcut_search');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { nextFrames } = require('../helpers/real_input');
const { waitRectStable, OVERRIDING_SEL } = require('../helpers/layout');
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

for (const edge of ['top', 'bottom']) {
  test(`tapping the ${edge} padding of a result card opens that article`, async ({ page }, info) => {
    await recordSearchTaps(page, () => bootNestedShortcutSearch(page));
    await tapShortcut(page, 'author');
    await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
    const card = page.locator(TARGET).locator('..');
    await card.scrollIntoViewIfNeeded();
    await waitRectStable(page, TARGET);
    const point = await card.evaluate((node, edge) => {
      const rect = node.getBoundingClientRect();
      const first = node.querySelector('.listCardTitle').getBoundingClientRect();
      const last = node.querySelector('.listCardMeta').getBoundingClientRect();
      return {
        x: (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2,
        y: edge === 'top' ? (rect.top + first.top) / 2 : (last.bottom + rect.bottom) / 2
      };
    }, edge);
    expect(await page.evaluate(({ x, y, overriding }) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit?.closest('.listCard') && !hit.closest('.listCardLine') && !hit.closest(overriding);
    }, { ...point, overriding: OVERRIDING_SEL })).toBe(true);
    await info.attach(`card-${edge}-padding`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.touchscreen.tap(point.x, point.y);
    await waitArticle(page, 'Beta');
  });
}

test('tapping empty filler below short search results opens no article', async ({ page }) => {
  await recordSearchTaps(page, () => bootNestedShortcutSearch(page));
  await tapShortcut(page, 'author');
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
  const point = await page.evaluate(overriding => {
    const app = window.__app;
    const viewport = document.querySelector('.main:not([data-stack-layer]) .listBodyView');
    const bounds = viewport.getBoundingClientRect();
    const length = app.listSession._sequence().length;
    const header = app.listSession.headerRows();
    for (const card of viewport.querySelectorAll('.listCard')) {
      if (Number(card.getAttribute('srow')) - header < length) continue;
      const rect = card.getBoundingClientRect();
      const x = (rect.left + rect.right) / 2;
      const y = (rect.top + rect.bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (y > bounds.top && y < bounds.bottom && card.contains(hit) && !hit.closest(overriding)) {
        return { x, y };
      }
    }
    return null;
  }, OVERRIDING_SEL);
  expect(point).not.toBeNull();
  const before = await page.evaluate(() => ({
    selected: window.__app.listSession._selectedNum,
    sent: window.__gestureSent.length
  }));
  await page.touchscreen.tap(point.x, point.y);
  await nextFrames(page, 2);
  expect(await page.evaluate(() => ({
    selected: window.__app.listSession._selectedNum,
    sent: window.__gestureSent.length
  }))).toEqual(before);
  await waitList(page, { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] });
});
