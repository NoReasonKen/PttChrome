const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');
const { waitRectStable } = require('../helpers/layout');
const { bootGestureArticle, revealArticleDrawer, PANEL } = require('../helpers/article_gestures');

async function color(page, selector, property) {
  return page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);
}

for (const scheme of ['dark', 'light']) {
  test(`mobile chrome keeps its existing palette in the ${scheme} scheme`, async ({ page }, info) => {
    await page.addInitScript(scheme => localStorage.setItem('mantine-color-scheme-value', scheme), scheme);
    await bootOffline(page, ptt);
    await drawMainMenu(page);
    await expect(page.locator('.mobileAppBar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', scheme);
    expect(await color(page, '.mobileAppBar', 'backgroundColor')).toBe('rgba(20, 20, 24, 0.96)');
    expect(await color(page, '.mobileAppBar', 'color')).toBe('rgb(238, 238, 238)');
    expect(await color(page, '.mobileToolbar', 'backgroundColor')).toBe('rgba(20, 20, 24, 0.96)');
    expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#141418');
    const manifest = await page.request.get('/manifest.webmanifest');
    expect((await manifest.json()).theme_color).toBe('#141418');

    await page.locator('[data-key="__keys"]').tap();
    await waitRectStable(page, '.mobileKeypadGrid');
    expect(await color(page, '.mobileKeypadGrid', 'backgroundColor')).toBe('rgba(20, 20, 24, 0.94)');
    expect(await color(page, '.mobileKeypadKey', 'backgroundColor')).toBe('rgb(43, 43, 48)');
    await page.screenshot({ path: info.outputPath(`keypad-${scheme}.png`), animations: 'disabled' });
    await page.locator('[data-key="__keys"]').tap();
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-sheet="more"]')).toBeVisible();
    await waitRectStable(page, '[data-sheet="more"]');
    expect(await color(page, '.mobileSheet', 'backgroundColor')).toBe('rgb(29, 29, 34)');
    expect(await color(page, '.mobileSheet', 'color')).toBe('rgb(238, 238, 238)');
    await page.screenshot({ path: info.outputPath(`sheet-${scheme}.png`), animations: 'disabled' });
  });

  test(`article shortcut drawer keeps its translucent palette in the ${scheme} scheme`, async ({ page }, info) => {
    await page.addInitScript(scheme => localStorage.setItem('mantine-color-scheme-value', scheme), scheme);
    await bootGestureArticle(page);
    await revealArticleDrawer(page);
    expect(await color(page, PANEL, 'backgroundColor')).toBe('rgba(20, 20, 24, 0.5)');
    expect(await color(page, PANEL, 'color')).toBe('rgb(241, 241, 243)');
    expect(await color(page, `${PANEL} button`, 'textDecorationColor')).toBe('rgb(102, 217, 239)');
    await page.screenshot({ path: info.outputPath(`drawer-${scheme}.png`), animations: 'disabled' });
  });
}
