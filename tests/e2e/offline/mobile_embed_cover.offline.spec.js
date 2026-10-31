// Embed cover (#89): a cross-origin player swallows every touch, so an
// article swipe could never start on an embedded video. Until the reader taps
// it, the embed is a card PttChrome owns; the tap swaps the player into the
// card's media area.
const { test, expect } = require('@playwright/test');
const { waitRectStable } = require('../helpers/layout');
const { VIEWER } = require('../helpers/image_viewer');
const { OFFLINE_OEMBED } = require('../helpers/replay');
const { DRAWER, bootGestureArticle, beginArticleTouch, gestureSent } = require('../helpers/article_gestures');

const CARD = '#mainContainer .embedCard';
const COVER = `${CARD} .embedCover`;
const PLAYER = `${CARD} iframe`;

async function bootCoverArticle(page) {
  await bootGestureArticle(page, { interveningLink: 'https://youtu.be/dQw4w9WgXcQ' });
  await page.locator(CARD).evaluate(el => el.scrollIntoView({ block: 'center' }));
  // The title arrives after the card mounts and makes it taller.
  await expect(page.locator(CARD)).toContainText(OFFLINE_OEMBED.title);
  return waitRectStable(page, COVER);
}

test('an unplayed YouTube embed shows only its card, and a left swipe on it opens the drawer', async ({ page }, testInfo) => {
  const cover = await bootCoverArticle(page);
  await expect(page.locator(PLAYER)).toHaveCount(0);
  await expect(page.locator(`${COVER} img`)).toHaveAttribute('src', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg');
  await expect(page.locator(CARD)).toContainText(OFFLINE_OEMBED.author);
  await expect(page.locator(CARD)).toContainText('YouTube');
  expect(cover.width / cover.height).toBeCloseTo(16 / 9, 1);
  await page.screenshot({ path: testInfo.outputPath('embed-card.png') });
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

test('a tap on the cover swaps in the autoplaying player without moving the card or an article tap action', async ({ page }) => {
  const cover = await bootCoverArticle(page);
  const card = await waitRectStable(page, CARD);
  // Near the cover's left edge, where an article tap would otherwise leave the article.
  await page.touchscreen.tap(cover.left + 6, cover.top + cover.height / 2);
  await expect(page.locator(COVER)).toHaveCount(0);
  await expect(page.locator(PLAYER)).toHaveAttribute('src', 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1');
  const player = await waitRectStable(page, PLAYER);
  expect(player.top).toBeCloseTo(cover.top, 0);
  expect(player.height).toBeCloseTo(cover.height, 0);
  expect((await waitRectStable(page, CARD)).height).toBeCloseTo(card.height, 0);
  await expect(page.locator(CARD)).toContainText(OFFLINE_OEMBED.title);
  await expect(page.locator(VIEWER)).toHaveCount(0);
  expect(await gestureSent(page)).toBe('');
});
