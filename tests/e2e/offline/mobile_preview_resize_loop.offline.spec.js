// Preview slots and the ResizeObserver loop (#152). A slot remembers the
// height its preview was last shown at. When a shown preview reports a shorter
// height (a reopened YouTube card lays out before its title, for one), the
// slot's resize report lowers that floor. Lowering it inside the observer
// callback shortened the long-page chunk while Chrome was recording the chunk's
// remembered size (`contain-intrinsic-height: auto`), and Chrome reported
// "ResizeObserver loop completed with undelivered notifications".
const { test, expect } = require('@playwright/test');
const { waitPreviewsSettled, waitRectStable } = require('../helpers/layout');
const { OFFLINE_OEMBED } = require('../helpers/replay');
const { bootGestureArticle } = require('../helpers/article_gestures');

const CARD = '#mainContainer .embedCard';

test('a shown preview growing shorter than its remembered height raises no ResizeObserver loop', async ({ page }) => {
  await page.addInitScript(() => {
    window.__resizeLoops = 0;
    window.addEventListener('error', e => {
      if (/ResizeObserver loop/.test(e.message || '')) window.__resizeLoops++;
    });
  });
  await bootGestureArticle(page, { interveningLink: 'https://youtu.be/dQw4w9WgXcQ' });
  await waitPreviewsSettled(page);
  await expect(page.locator(CARD)).toContainText(OFFLINE_OEMBED.title);
  const full = await waitRectStable(page, CARD);
  // The card without its title, as it first lays out when reopened.
  await page.addStyleTag({ content: '.embedCardTitle { display: none; }' });
  const short = await waitRectStable(page, CARD);
  expect(short.height).toBeLessThan(full.height);
  // The slot follows its preview down: no floor is left below the card.
  const heights = await page.locator(CARD).evaluate(card => {
    const slot = card.closest('.inlinePreviewSlot');
    return { slot: slot.offsetHeight, content: slot.querySelector('.inlinePreviewContent').offsetHeight };
  });
  expect(heights.slot).toBe(heights.content);
  expect(await page.evaluate(() => window.__resizeLoops)).toBe(0);
});
