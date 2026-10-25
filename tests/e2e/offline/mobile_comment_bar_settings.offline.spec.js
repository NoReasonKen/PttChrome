const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline, findCassette, replayCassette } = require('../helpers/replay');
const { waitPreviewsSettled } = require('../helpers/layout');

test('mobile settings enable the comment bar and allow switching from folded to persistent', async ({ page }) => {
  await bootOffline(page, ptt, { commentBarFold: true });
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await replayCassette(page, findCassette('article'), { easyReading: true });
  await waitPreviewsSettled(page);
  await expect(page.locator('body')).toHaveClass(/mobile-layout/);
  // Saving settings asks PTT for a full redraw. Answer with the current pager
  // frame, which a one-shot cassette does not replay a second time by itself.
  await page.evaluate(async () => {
    const { u2b } = await import('/src/js/string_util.js');
    const app = window.__app;
    const buf = app.buf;
    let redraw = '\x1b[H\x1b[2J';
    for (let row = 0; row < buf.rows; row++) {
      redraw += '\x1b[' + (row + 1) + ';1H' + u2b(buf.getRowText(row, 0, buf.cols));
    }
    redraw += '\x1b[' + buf.rows + ';' + buf.cols + 'H';
    const previous = window.__stubWSSent;
    window.__stubWSSent = (data) => {
      previous?.(data);
      if (data === '\x0c') setTimeout(() => app.onData(redraw), 0);
    };
  });

  const modal = page.locator('.PrefModal');
  const bar = page.locator('#commentBar');
  const openSettings = async () => {
    await page.locator('[data-key="__more"]').tap();
    await page.locator('[data-key="__settings"]').tap();
    await expect(modal).toBeVisible();
    await modal.locator('[data-pref-category="general"]').tap();
  };

  await openSettings();
  await expect(modal.locator('input[name="enableCommentBar"]')).not.toBeChecked();
  await modal.locator('label[for="pref-check-enableCommentBar"]').tap();
  await expect(modal.locator('input[name="enableCommentBar"]')).toBeChecked();
  await expect(modal.locator('input[name="mobileCommentBarFold"]')).toBeChecked();
  await modal.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(modal).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__app.commentBar.state.available)).toBe(true);
  await expect(bar).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('comment-bar-folded.png') });

  await page.locator('[data-key="X"]').tap();
  await expect(bar).toBeVisible();
  await expect(bar.locator('[name="commentBarText"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);

  await openSettings();
  await modal.locator('label[for="pref-check-mobileCommentBarFold"]').tap();
  await modal.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(modal).toBeHidden();
  await expect(bar).toBeVisible();
  await expect(bar).toBeInViewport();
  expect(await ptt.getPref(page, 'mobileCommentBarFold')).toBe(false);
  await page.screenshot({ path: test.info().outputPath('comment-bar-persistent.png') });
});
