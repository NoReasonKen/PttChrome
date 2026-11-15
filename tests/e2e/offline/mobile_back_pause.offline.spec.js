// A pause screen after Back is never painted (#189). PTT may answer Back from
// an article with a pause (pressanykey, or a vmsg banner) before the list. The
// page Back revealed stays on screen, PTT's message shows as a status hint, one
// key dismisses the pause, and the list follows only through list easy
// reading. Every painted frame from Back to the list is sampled. The controlled
// PTT board is helpers/article_shortcut_search.js. Runs only in the
// offline-mobile project.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootNestedShortcutSearch, waitArticle, waitList, tapCard } = require('../helpers/article_shortcut_search');
const { MAIN, listActive } = require('../helpers/stack_routes');
const { installPaintedFrameProbe } = require('../helpers/layout');

const BOARD = { has: ['Alpha topic', 'Beta topic'] };
const MESSAGE = '此文章已被刪除';
const pressBack = page => ptt.sendKey(page, 'ArrowLeft');

// Samples every painted frame (helpers/layout.js installPaintedFrameProbe)
// until stopFrames.
async function watchFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(({ MAIN }) => {
    window.__frames = [];
    const visible = (el) => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const sample = () => {
      const app = window.__app;
      const main = document.querySelector(MAIN);
      const content = main?.querySelector('#mainContainer');
      const rect = main?.getBoundingClientRect();
      const left = Math.max(0, rect?.left || 0), right = Math.min(innerWidth, rect?.right || 0);
      const top = Math.max(0, rect?.top || 0, document.getElementById('mobileAppBar')?.getBoundingClientRect().bottom || 0);
      const bottom = Math.min(innerHeight, rect?.bottom || 0);
      // The terminal page itself reaches the eye (not a stack layer over it).
      const onTop = right > left && bottom > top && [0.25, 0.5, 0.75].some((fraction) => {
        const hit = document.elementFromPoint((left + right) / 2, top + (bottom - top) * fraction);
        return !!hit && main.contains(hit) && !hit.closest('#homeDashboard, [data-stack-layer]');
      });
      const shown = visible(content) && onTop;
      const text = shown ? content.textContent || '' : '';
      const hint = document.querySelector('.ListHint');
      window.__frames.push({
        surface: app.view.mobileSurface,
        shown,
        layer: visible(document.querySelector('[data-stack-layer]:not([data-stack-parked])')),
        pause: text.includes('按任意鍵繼續'),
        cards: shown && visible(content.querySelector('.listBodyView')),
        hint: hint && getComputedStyle(hint).opacity !== '0' ? hint.textContent : null,
        holding: !!app.backPause?.holding,
      });
    };
    window.__stopFrames = () => window.__paintedFrame.remove(sample);
    window.__paintedFrame.add(sample);
  }, { MAIN });
}

async function stopFrames(page) {
  await page.waitForFunction((n) => window.__frames.length >= n,
    await page.evaluate(() => window.__frames.length + 8));
  return page.evaluate(() => { window.__stopFrames(); return window.__frames; });
}

// A frame where PTT's own screen reaches the reader: the terminal grid or
// the pause's text on any surface.
const nativeFrames = (frames) => frames.filter((f) => f.shown && (f.surface === 'grid' || f.pause));

async function openAlphaFromList(page) {
  await bootNestedShortcutSearch(page);
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await pressBack(page);
  await waitList(page, BOARD);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
}

const sentSpaces = page => page.evaluate(() => window.__gestureSent.filter(bytes => bytes.replace(/\f/g, '') === ' ').length);

test.describe('手機：返回後的暫停畫面不畫出來 (#189)', () => {
  for (const kind of ['pause', 'vmsg']) {
    test(`Back answered with a ${kind} keeps the revealed list, hints the message and shows the list by easy reading, every frame`, async ({ page }) => {
      await openAlphaFromList(page);
      await page.evaluate(({ kind, message }) => {
        window.__shortcutServer.state.backPause = { kind, message };
      }, { kind, message: MESSAGE });
      await watchFrames(page);
      await pressBack(page);
      await waitList(page, BOARD);
      await listActive(page);
      const frames = await stopFrames(page);
      expect(frames.some((f) => f.holding)).toBe(true);
      expect(nativeFrames(frames)).toEqual([]);
      expect(frames.some((f) => f.hint === MESSAGE)).toBe(true);
      expect(frames.some((f) => f.cards)).toBe(true);
      // One key dismissed the pause.
      expect(await sentSpaces(page)).toBe(1);
      expect(await page.evaluate(() => window.__app.backPause.phase)).toBe('idle');
    });
  }

  test('a pause without a message is dismissed with no pause text anywhere', async ({ page }) => {
    await openAlphaFromList(page);
    await page.evaluate(() => { window.__shortcutServer.state.backPause = { kind: 'pause', message: '' }; });
    await watchFrames(page);
    await pressBack(page);
    await waitList(page, BOARD);
    await listActive(page);
    const frames = await stopFrames(page);
    expect(nativeFrames(frames)).toEqual([]);
    expect(frames.filter((f) => /按任意鍵|◆/.test(f.hint || ''))).toEqual([]);
    expect(await sentSpaces(page)).toBe(1);
  });
});
