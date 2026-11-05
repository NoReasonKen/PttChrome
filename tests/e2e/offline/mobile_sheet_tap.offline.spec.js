const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');

async function contactSettingsDuringEntrance(page, finish = true) {
  await bootOffline(page, ptt);
  await drawMainMenu(page);
  await page.addStyleTag({ content: '.mobileSheetContent { transition-duration: 5s !important; }' });
  await page.evaluate(() => {
    document.addEventListener('transitionrun', event => {
      if (window.__heldEntrance || event.propertyName !== 'transform' ||
          !event.target.matches('.mobileSheetContent')) return;
      const animation = event.target.getAnimations().find(a => a.transitionProperty === 'transform');
      if (!animation) return;
      animation.pause();
      animation.currentTime = animation.effect.getTiming().duration / 2;
      window.__heldEntrance = animation;
    }, { capture: true });
  });
  await page.locator('[data-key="__more"]').tap();
  await page.waitForFunction(() => !!window.__heldEntrance);
  await page.evaluate(() => {
    window.__itemClicks = [];
    document.querySelectorAll('[data-sheet="more"] button.mobileSheetItem').forEach(button => {
      button.addEventListener('click', event => window.__itemClicks.push({
        key: button.dataset.key, trusted: event.isTrusted, activated: navigator.userActivation.isActive,
      }));
    });
  });
  const rect = await page.locator('[data-key="__settings"]').boundingBox();
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  if (finish) await page.evaluate(() => window.__heldEntrance.finish());
  return { cdp, point };
}

test('a touch on Settings keeps its action when the entrance moves Log out under the finger', async ({ page }) => {
  const { cdp } = await contactSettingsDuringEntrance(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.PrefModal')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-key="__logoutAsk"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__itemClicks)).toEqual([
    { key: '__settings', trusted: false, activated: true },
  ]);
  await expect(page.locator('[data-sheet="more"]')).toHaveCount(0);
  await page.locator('.PrefModal').screenshot({
    path: test.info().outputPath('settings-after-early-touch.png'), animations: 'disabled',
  });
});

test('moving a Settings contact does not activate either menu action', async ({ page }) => {
  const { cdp, point } = await contactSettingsDuringEntrance(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: point.x + 35, y: point.y }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.PrefModal')).toHaveCount(0);
  await expect(page.locator('[data-key="__logoutAsk"]')).toHaveCount(0);
  await expect(page.locator('[data-sheet="more"]')).toBeVisible();
});

test('a cancelled contact does not disable protection for the next touch', async ({ page }) => {
  const { cdp, point } = await contactSettingsDuringEntrance(page, false);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.evaluate(() => window.__heldEntrance.finish());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.PrefModal')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-key="__logoutAsk"]')).toHaveCount(0);
});

test('two contacts cancel the action and leave the next single touch working', async ({ page }) => {
  const { cdp, point } = await contactSettingsDuringEntrance(page, false);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ ...point, id: 0 }, { x: point.x + 50, y: point.y, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => window.__itemClicks)).toEqual([]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.evaluate(() => window.__heldEntrance.finish());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.PrefModal')).toBeVisible();
  expect(await page.evaluate(() => window.__itemClicks.map(click => click.key))).toEqual(['__settings']);
});

for (const input of ['touch', 'mouse', 'Enter', 'Space']) {
  test(`stable Settings activation by ${input} stays native and happens once`, async ({ page }) => {
    await bootOffline(page, ptt);
    await drawMainMenu(page);
    await page.locator('[data-key="__more"]').tap();
    const settings = page.locator('[data-key="__settings"]');
    await expect(page.locator('.mobileSheetContent:has([data-sheet="more"])'))
      .toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await settings.evaluate(button => {
      window.__nativeClicks = [];
      button.addEventListener('click', event => window.__nativeClicks.push(event.isTrusted));
    });
    if (input === 'touch') await settings.tap();
    else if (input === 'mouse') await settings.click();
    else {
      await settings.focus();
      await page.keyboard.press(input);
    }
    await expect(page.locator('.PrefModal')).toBeVisible();
    expect(await page.evaluate(() => window.__nativeClicks)).toEqual([true]);
  });
}

test('scrolling the menu remains native and does not activate an item', async ({ page }) => {
  await bootOffline(page, ptt);
  await drawMainMenu(page);
  await page.addStyleTag({ content: '.mobileSheetScroll { max-height: 80px; }' });
  await page.locator('[data-key="__more"]').tap();
  await expect(page.locator('.mobileSheetContent:has([data-sheet="more"])'))
    .toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const viewport = page.locator('[data-sheet="more"] .mobileSheetScroll');
  const rect = await viewport.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height - 10 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  for (let dy = 10; dy <= 60; dy += 10) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - dy }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('.PrefModal')).toHaveCount(0);
  await expect(page.locator('[data-key="__logoutAsk"]')).toHaveCount(0);
});
