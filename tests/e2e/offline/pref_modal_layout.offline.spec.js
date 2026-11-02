// 設定頁（桌機兩欄版）的版面：左欄固定 160px，裡面的字不可以被切掉。
// 英文的「Restore defaults」曾經在按鈕裡被截成「Restore defau」（Mantine Button 的 label
// 是 nowrap＋overflow hidden）。只有完整頁面（Mantine 全域樣式＋PrefModal.css）量得到。
const { test, expect } = require('@playwright/test');
const { installReplay, waitConnected, feedRaw } = require('../helpers/replay');
const { nextFrames } = require('../helpers/real_input');
const { waitRectStable } = require('../helpers/layout');

const label = (page, key) => page.evaluate((k) => window.__i18n(k), key);

async function openSettings(page) {
  await installReplay(page);
  await page.goto('/');
  await waitConnected(page);
  await feedRaw(page, '\x1b[2J\x1b[H  PREF LAYOUT TEST LINE  ');
  await page.locator('#BBSWindow').click({ button: 'right', position: { x: 40, y: 20 } });
  await page
    .locator('.DropdownMenu')
    .first()
    .getByText(await label(page, 'cmenu_settings'), { exact: true })
    .click();
  await expect(page.locator('.PrefModal')).toBeVisible();
}

test('左欄的分頁與「還原預設值」字都完整顯示', async ({ page }) => {
  await openSettings(page);
  const reset = page.locator('.PrefModal__Grid__Col--left__Reset');
  await expect(reset).toBeVisible();
  const clipped = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '.PrefModal__Grid__Col--left .mantine-Tabs-tabLabel, .PrefModal__Grid__Col--left__Reset .mantine-Button-label'
      )
    )
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent)
  );
  expect(clipped).toEqual([]);
});

for (const narrow of [true, false]) {
  test(`settings categories start at the top on ${narrow ? 'mobile' : 'desktop'}`, async ({ page }) => {
    await page.setViewportSize({ width: narrow ? 390 : 1280, height: 650 });
    await openSettings(page);
    const column = page.locator('.PrefModal__Grid__Col--right');
    const chooseCategory = async (value, labelKey) => {
      if (narrow) {
        const back = page.locator('[data-pref-category-back]');
        if (await back.isVisible()) await back.click();
        await page.locator(`[data-pref-category="${value}"]`).click();
      } else {
        await page.getByRole('tab', { name: await label(page, labelKey), exact: true }).click();
      }
      await nextFrames(page);
      await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBe(0);
    };
    const scrollDown = async () => {
      await waitRectStable(page, '.PrefModal__Grid__Col--right', { fullRect: true });
      const box = await column.boundingBox();
      await page.mouse.move(box.x + box.width - 25, box.y + box.height / 2);
      await page.mouse.wheel(0, 400);
      await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    };

    await chooseCategory('general', 'options_general');
    await scrollDown();
    await chooseCategory('enhance', 'options_enhance');
    await scrollDown();
    await chooseCategory('general', 'options_general');
    await page.screenshot({ path: test.info().outputPath(`settings-top-${narrow ? 'mobile' : 'desktop'}.png`) });
  });
}
