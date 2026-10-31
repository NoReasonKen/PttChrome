const { test, expect } = require('@playwright/test');
const { MAIN, ARTICLE_CARD, bootArticleListAtCard, listActive } = require('../helpers/stack_routes');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { waitRectStable } = require('../helpers/layout');
const ptt = require('../helpers/ptt');

// Chromium may highlight the cursor-defining ancestor rather than the tapped
// card. Check the actual surface's computed style; Android paint still needs
// device acceptance, since headless Chromium may omit the native animation.
for (const edgePaging of [true, false]) {
  test(`native tap feedback stays disabled across an article return (edge paging ${edgePaging})`, async ({ page }, info) => {
    await bootArticleListAtCard(page);
    await ptt.applyPrefs(page, { mouseEdgePaging: edgePaging });
    const surface = page.locator('#BBSWindow');
    await expect(surface).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');

    const box = await waitRectStable(page, ARTICLE_CARD);
    const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    const contact = await beginArticleTouch(page, point);
    // sleep-ok: hold beyond the reported short-press highlight delay.
    await page.waitForTimeout(450);
    await expect(surface).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: info.outputPath('held-list.png') });
    await contact.release({ cancel: true });

    await page.locator(ARTICLE_CARD).first().tap();
    await page.waitForFunction(() => window.__app.buf.pageState === 3);
    await waitRectStable(page, MAIN);
    await expect(surface).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('ArrowLeft');
    await listActive(page);
    await expect(page.locator('[data-article-exit-underlay]')).toHaveCount(0);
    await expect(page.locator(ARTICLE_CARD).first()).toBeVisible();
    await expect(surface).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
  });
}
