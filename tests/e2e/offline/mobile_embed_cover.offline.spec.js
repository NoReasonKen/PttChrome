// Embed cover (#89): a cross-origin player swallows every touch, so an
// article swipe could never start on an embedded video. Until the reader taps
// it, the embed is a cover PttChrome owns; the tap swaps in the player.
const { test, expect } = require('@playwright/test');
const { waitRectStable } = require('../helpers/layout');
const { VIEWER } = require('../helpers/image_viewer');
const { DRAWER, bootGestureArticle, beginArticleTouch, gestureSent } = require('../helpers/article_gestures');

const COVER = '#mainContainer .embedCover';
const PLAYER = '#mainContainer iframe';

async function bootCoverArticle(page) {
  await bootGestureArticle(page, { interveningLink: 'https://youtu.be/dQw4w9WgXcQ' });
  await page.locator(COVER).evaluate(el => el.scrollIntoView({ block: 'center' }));
  return waitRectStable(page, COVER);
}

test('an unplayed YouTube embed shows only its cover, and a left swipe on it opens the drawer', async ({ page }, testInfo) => {
  const cover = await bootCoverArticle(page);
  await expect(page.locator(PLAYER)).toHaveCount(0);
  await expect(page.locator(`${COVER} img`)).toHaveAttribute('src', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  await expect(page.locator(COVER)).toContainText('YouTube');
  await page.screenshot({ path: testInfo.outputPath('embed-cover.png') });
  const width = page.viewportSize().width;
  const from = { x: Math.min(cover.left + cover.width - 4, width - 24), y: cover.top + cover.height / 2 };
  const contact = await beginArticleTouch(page, from);
  await contact.move({ x: Math.max(8, from.x - width * 0.6), y: from.y });
  await contact.release();
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
  await expect(page.locator(PLAYER)).toHaveCount(0);
});

test('a right swipe starting on the cover leaves the article', async ({ page }) => {
  const cover = await bootCoverArticle(page);
  const y = cover.top + cover.height / 2;
  const contact = await beginArticleTouch(page, { x: Math.max(20, cover.left + 4), y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.release();
  await expect.poll(() => gestureSent(page)).toBe('\x1b[D');
});

test('a tap on the cover swaps in the autoplaying player in the same box, without an article tap action', async ({ page }) => {
  const cover = await bootCoverArticle(page);
  // Near the cover's left edge, where an article tap would otherwise leave the article.
  await page.touchscreen.tap(cover.left + 6, cover.top + cover.height / 2);
  await expect(page.locator(COVER)).toHaveCount(0);
  await expect(page.locator(PLAYER)).toHaveAttribute('src', 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1');
  const player = await waitRectStable(page, PLAYER);
  expect(player.top).toBeCloseTo(cover.top, 0);
  expect(player.height).toBeCloseTo(cover.height, 0);
  await expect(page.locator(VIEWER)).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
});
