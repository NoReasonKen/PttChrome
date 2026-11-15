// A pause screen after Back is never painted, on the desktop too (#189). PTT
// may answer Back from an easy-reading article with a pause before the list:
// the article stays on screen, PTT's message shows as a status hint, one key
// dismisses the pause, and the list follows only through list easy reading.
// Every painted frame from Back to the list is sampled. The controlled PTT
// board is helpers/article_shortcut_search.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitArticle, waitList } = require('../helpers/article_shortcut_search');
const { waitScreenSettled } = require('../helpers/replay');
const { installPaintedFrameProbe } = require('../helpers/layout');

const BOARD = { has: ['Alpha topic', 'Beta topic'] };
const MESSAGE = '此文章已被刪除';

async function watchFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(() => {
    window.__frames = [];
    const visible = (el) => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const sample = () => {
      const app = window.__app;
      const content = document.getElementById('mainContainer');
      const text = visible(content) ? content.textContent || '' : '';
      const hint = document.querySelector('.ListHint');
      window.__frames.push({
        pause: text.includes('按任意鍵繼續'),
        cards: visible(content?.querySelector('.listBodyView')),
        article: / line 04:/.test(text),
        hint: hint && getComputedStyle(hint).opacity !== '0' ? hint.textContent : null,
        holding: !!app.backPause?.holding,
      });
    };
    window.__stopFrames = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  });
}

async function stopFrames(page) {
  await page.waitForFunction((n) => window.__frames.length >= n,
    await page.evaluate(() => window.__frames.length + 8));
  return page.evaluate(() => { window.__stopFrames(); return window.__frames; });
}

test('Back answered with a pause keeps the article, hints the message and shows the list by easy reading, every frame', async ({ page }) => {
  await bootNestedShortcutSearch(page, { startAtMain: true });
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await page.evaluate(() => {
    const server = window.__shortcutServer;
    server.state.surface = 'list';
    window.__app.onData(server.frame(true));
  });
  await waitList(page, BOARD);
  await ptt.sendKey(page, 'Enter');
  await waitScreenSettled(page, { 1: 'Alpha topic' });
  await waitArticle(page, 'Alpha');
  await page.evaluate((message) => {
    window.__shortcutServer.state.backPause = { kind: 'pause', message };
  }, MESSAGE);
  await watchFrames(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__frames.some((f) => f.cards))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__app.backPause.phase)).toBe('idle');
  const frames = await stopFrames(page);
  expect(frames.some((f) => f.holding)).toBe(true);
  expect(frames.filter((f) => f.pause)).toEqual([]);
  // Until the list, the article stays.
  const firstList = frames.findIndex((f) => f.cards);
  expect(frames.slice(0, firstList).filter((f) => !f.article)).toEqual([]);
  expect(frames.some((f) => f.hint === MESSAGE)).toBe(true);
  const spaces = await page.evaluate(() => window.__gestureSent.filter((bytes) => bytes.replace(/\f/g, '') === ' ').length);
  expect(spaces).toBe(1);
});
