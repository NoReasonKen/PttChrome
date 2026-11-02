const { test, expect } = require('@playwright/test');
const { bootGestureArticle, beginArticleTouch, PANEL } = require('../helpers/article_gestures');
const { waitRectStable } = require('../helpers/layout');
const { MAIN, ARTICLE_CARD, bootArticleListAtCard, waitArticleOpened, listActive } = require('../helpers/stack_routes');
const ptt = require('../helpers/ptt');

for (const operation of ['drawer', 'article', 'returned article list']) {
  test(`${operation} follows the first small horizontal movements without an initial jump`, async ({ page }) => {
    if (operation === 'returned article list') {
      await bootArticleListAtCard(page);
      await page.locator(ARTICLE_CARD).first().tap();
      await waitArticleOpened(page);
      await ptt.sendKey(page, 'ArrowLeft');
      await listActive(page);
      await expect(page.locator('[data-stack-layer]')).toHaveCount(0);
    } else await bootGestureArticle(page);
    const main = await waitRectStable(page, MAIN);
    const width = page.viewportSize().width;
    const direction = operation === 'drawer' ? -1 : 1;
    const start = { x: width / 2, y: main.top + 50 };
    const contact = await beginArticleTouch(page, start);
    const samples = [];
    for (const distance of [4, 12]) {
      await contact.move({ x: start.x + direction * distance, y: start.y });
      const actual = await page.evaluate(({ operation, panel, width, left }) => {
        const node = document.querySelector(operation === 'drawer' ? panel : '.main:not([data-stack-layer])');
        if (!node) return 0;
        const rect = node.getBoundingClientRect();
        return operation === 'drawer' ? width - rect.left : rect.left - left;
      }, { operation, panel: PANEL, width, left: main.left });
      samples.push({ finger: distance, surface: Math.round(actual * 100) / 100 });
    }
    await contact.release({ cancel: true });
    expect(samples).toEqual(samples.map(({ finger }) => ({ finger, surface: finger })));
  });
}
