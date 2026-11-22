// Jumping to an article by its code (AID) from an easy-reading article on the
// phone (#281): the article's More sheet has the entrance (跳至文章代碼), in the
// same bottom sheet as the article list's (#253). The article found stacks over
// the one it was opened from, sliding in from the right as an opened page does:
// Back, or the 返回 pill under the App Bar, reveals that article at once, at
// its reading position, while the app brings PTT back to it by its code; a
// reader who scrolls it meanwhile stays where they scrolled to. Cancel sends
// nothing, an unknown code leaves the reader on the article, and a mail has no
// entrance and refuses `#`. Runs only in the offline-mobile project; the
// controlled PTT board is helpers/article_shortcut_search.js.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const {
  bootNestedShortcutSearch, nativeBack, waitArticle, waitList, waitIdle, readToMiddle, topLine, tapCard, visibleText
} = require('../helpers/article_shortcut_search');
const { MAIN, recordHints, recordedHints } = require('../helpers/stack_routes');
const { bootMailbox, mailListActive, mailSurface } = require('../helpers/mail_box');
const { installPaintedFrameProbe } = require('../helpers/layout');
const { beginArticleTouch } = require('../helpers/article_gestures');

const SHEET = '[data-sheet="aidJump"]';
const INPUT = 'input[name="aidCode"]';
const ARTICLE_LAYER = '[data-stack-layer="article"]';
// The article layer once it is the page shown, usable while PTT catches up.
const REVEALED = '[data-stack-layer="article"]:not([data-stack-parked]):not([inert])';
const PILL = '#aidBackButton';
const UNSUPPORTED_KEY = '好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）';
const UNSUPPORTED_PASTE = '好讀模式目前不支援在文章貼上文字';

// The board's list, then Alpha opened from it and read to its middle.
async function articleFromList(page) {
  await bootNestedShortcutSearch(page);
  // The app guards system Back only once the reader has acted.
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, { has: ['Alpha topic', 'Delta topic'] });
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  const position = await readToMiddle(page);
  await recordHints(page);
  return { position, row: await rowAtTop(page, MAIN), reading: await readingText(page), top: await topRowText(page) };
}

// The row painted topmost at the real screen's top (sampleFrames' `top`).
const topRowText = page => page.evaluate(MAIN => {
  const r = document.querySelector(MAIN).getBoundingClientRect();
  const row = document.elementsFromPoint(r.left + r.width / 2, r.top + 8)
    .map(el => el.closest && el.closest('[type="bbsrow"]')).find(Boolean);
  return row ? row.textContent.trim().slice(0, 24) : null;
}, MAIN);

// The article row at the top of `root`'s view and its offset from that top.
const rowAtTop = (page, root) => page.evaluate(root => {
  const view = document.querySelector(root);
  const top = view.getBoundingClientRect().top;
  const row = [...view.querySelectorAll('[type="bbsrow"][srow]')].find(r => r.getBoundingClientRect().bottom > top + 1);
  if (!row) return null;
  return { srow: row.getAttribute('srow'), offset: Math.round(row.getBoundingClientRect().top - top) };
}, root);

// The real page has taken over and settled.
const settled = page => page.waitForFunction(() => {
  const app = window.__app;
  return !document.querySelector('[data-stack-layer]:not([data-stack-parked]), [data-article-exit-underlay]') && app.commandQueue.idle &&
    !app.buf._settleTimer && (app.buf.pageState !== 2 || app.listSession.state === 'active');
});

const sent = (page) => page.evaluate(() => window.__gestureSent.join(''));
const hinted = (page, text) => recordedHints(page).then((hints) => hints.some((h) => h.includes(text)));
const opened = (page) => page.evaluate(() => window.__shortcutServer.state.open.body);

async function openSheet(page) {
  await page.locator('#mobileToolbar [data-key="__more"]').tap();
  await page.locator('[data-key="__aidJump"]').tap();
  await expect(page.locator(SHEET)).toBeVisible();
}

async function jump(page, code) {
  await openSheet(page);
  await page.locator(INPUT).fill(code);
  await page.locator(INPUT).press('Enter');
  await expect(page.locator(SHEET)).toHaveCount(0);
}

// Delta, opened by its code from Alpha read to its middle, and settled.
async function jumpedToDelta(page) {
  const origin = await articleFromList(page);
  await jump(page, '1gIeu-3D');
  await waitArticle(page, 'Delta');
  await settled(page);
  return origin;
}

// Every painted frame from now on: how far the real screen is from where it
// rests, whether an article layer shows, the article row at the top of the
// reading area (the layer's while it shows, else the real screen's), and the
// row painted topmost at the real screen's top (`top`, a cover's while one
// is up), as mobile_article_operations.offline.spec.js reads it.
async function sampleFrames(page) {
  await installPaintedFrameProbe(page);
  await page.evaluate(MAIN => {
    window.__frames = [];
    const rest = Math.round(document.querySelector(MAIN).getBoundingClientRect().left);
    const visible = el => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const topRowText = main => {
      const r = main.getBoundingClientRect();
      const row = document.elementsFromPoint(r.left + r.width / 2, r.top + 8)
        .map(el => el.closest && el.closest('[type="bbsrow"]')).find(Boolean);
      return row ? row.textContent.trim().slice(0, 24) : null;
    };
    const sample = () => {
      const main = document.querySelector(MAIN);
      const bar = document.getElementById('mobileAppBar').getBoundingClientRect();
      const hit = document.elementFromPoint(window.innerWidth / 2, bar.bottom + 30);
      window.__frames.push({
        left: Math.round(main.getBoundingClientRect().left) - rest,
        layer: [...document.querySelectorAll('[data-stack-layer="article"]')].some(visible),
        text: hit?.closest('[type="bbsrow"][srow]')?.textContent.trim().slice(0, 16) ?? null,
        top: topRowText(main)
      });
      if (window.__frames.length >= 900) window.__paintedFrame.remove(sample);
    };
    window.__paintedFrame.add(sample);
  }, MAIN);
}
const sampledFrames = page => page.evaluate(() => window.__frames);

// Each of `frames` shows the article left with the same row at the top as
// before the jump: one painted row, Alpha's.
function expectStill(frames, { top }) {
  expect(top).toMatch(/Alpha/);
  expect(frames.length).toBeGreaterThan(0);
  const tops = frames.map(f => f.top).filter((t, i, all) => i === 0 || t !== all[i - 1]);
  expect(tops, JSON.stringify(tops)).toEqual([top]);
}

// The article row at the top of the reading area now.
const readingText = page => page.evaluate(() => {
  const bar = document.getElementById('mobileAppBar').getBoundingClientRect();
  const hit = document.elementFromPoint(window.innerWidth / 2, bar.bottom + 30);
  return hit?.closest('[type="bbsrow"][srow]')?.textContent.trim().slice(0, 16) ?? null;
});

// Record what shows at each key sent to PTT from now on.
const recordSends = page => page.evaluate(() => {
  const send = window.__stubWSSent;
  window.__sends = [];
  window.__stubWSSent = data => {
    window.__sends.push([...document.querySelectorAll('[data-stack-layer]:not([data-stack-parked])')].map(el => el.dataset.stackLayer).join());
    return send(data);
  };
});

// Hold every key sent to PTT that `held` matches, until the returned
// `release()` sends them in order and lets later ones through.
async function holdSends(page, held) {
  await page.evaluate(held => {
    const send = window.__stubWSSent;
    const match = new RegExp(held);
    window.__heldSends = [];
    window.__stubWSSent = data => {
      if (!match.test(data)) return send(data);
      window.__heldSends.push(() => send(data));
    };
    window.__releaseSends = () => {
      window.__stubWSSent = send;
      window.__heldSends.splice(0).forEach(sendHeld => sendHeld());
    };
  }, held.source);
  return () => page.evaluate(() => window.__releaseSends());
}

// Back by `how` from Delta: Alpha shows at once from its live layer, before
// PTT has been sent anything, and on every frame from then on; PTT is brought
// back to it by its code, and it lands at its reading position.
async function backShowsOrigin(page, { position, row, reading }, how) {
  await recordSends(page);
  await sampleFrames(page);
  await how();
  await expect.poll(() => page.evaluate(() => window.__sends.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__sends[0])).toBe('article');
  await expect.poll(() => sent(page)).toMatch(/#1gIeu-3A\r/);
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0, { timeout: 10000 });
  await waitArticle(page, 'Alpha');
  await settled(page);
  expect(await opened(page)).toBe('Alpha');
  expect(await rowAtTop(page, MAIN)).toEqual(row);
  expect(await topLine(page)).toBe(position);
  const frames = await sampledFrames(page);
  const shown = frames.findIndex(f => f.text?.startsWith('Alpha'));
  expect(shown).toBeGreaterThanOrEqual(0);
  // No frame shows Delta, PTT's list or a blank area once Alpha shows.
  expect(frames.slice(shown).filter(f => !f.text?.startsWith('Alpha'))).toEqual([]);
  expect([...new Set(frames.slice(shown).map(f => f.text))]).toEqual([reading]);
}

test.describe('手機：在文章裡用文章代碼跳文 (#281)', () => {
  test('the More sheet opens the input; the article found slides in from the right over the article left', async ({ page }) => {
    const origin = await articleFromList(page);
    const width = page.viewportSize().width;
    const before = (await sent(page)).length;
    await openSheet(page);
    expect((await sent(page)).length).toBe(before);
    await page.locator(INPUT).fill('1gIeu-3D');
    await sampleFrames(page);
    await page.locator(INPUT).press('Enter');
    await expect(page.locator(SHEET)).toHaveCount(0);
    await expect.poll(async () => (await sent(page)).slice(before)).toMatch(/sTest\r[^]*#1gIeu-3D\r/);
    await waitArticle(page, 'Delta');
    await settled(page);
    expect(await opened(page)).toBe('Delta');
    // As an article opened from the list does (#36): the real screen comes in
    // from the right, over the article left, and never goes back.
    const frames = await sampledFrames(page);
    const start = frames.findIndex(f => f.left > 3);
    expect(start).toBeGreaterThanOrEqual(0);
    // Until it does, the article left stays still: leaving it for the board's
    // list repaints it, which no frame shows. One row is at the top of the
    // reading area on every frame.
    expectStill(frames.slice(0, start), origin);
    const moving = frames.slice(start);
    expect(moving[0].left).toBeGreaterThan(width / 2);
    expect(moving.filter((f, i) => i > 0 && f.left > moving[i - 1].left + 3)).toEqual([]);
    expect(moving.filter(f => f.left > 3 && !f.layer)).toEqual([]);
    expect(frames.at(-1).left).toBeLessThanOrEqual(3);
  });

  test('Back reveals the article left at once and on every frame, and it lands at its reading position', async ({ page }) => {
    const origin = await jumpedToDelta(page);
    await backShowsOrigin(page, origin, () => nativeBack(page));
  });

  test('the 返回 pill under the App Bar goes back the same way as Back', async ({ page }) => {
    const origin = await jumpedToDelta(page);
    await expect(page.locator(PILL)).toBeVisible();
    await backShowsOrigin(page, origin, () => page.locator(PILL).tap());
  });

  test('a reader who scrolls the revealed article before it lands is not pulled back to the old position', async ({ page }) => {
    const { row } = await jumpedToDelta(page);
    // PTT answers the way back only once the reader's finger is down.
    const release = await holdSends(page, /#1gIeu-3A\r/);
    await nativeBack(page);
    await expect.poll(() => page.evaluate(() => window.__heldSends.length)).toBeGreaterThan(0);
    await expect(page.locator(REVEALED)).toBeVisible();
    expect(await rowAtTop(page, REVEALED)).toEqual(row);
    // The reader drags the article down by a quarter of its height, which
    // scrolls it back toward its top, and holds still before lifting the
    // finger, so that no fling follows. The article lands meanwhile.
    const box = await page.locator(REVEALED).boundingBox();
    const x = box.x + box.width / 2;
    const from = box.y + box.height * 0.4;
    const to = from + box.height / 4;
    const contact = await beginArticleTouch(page, { x, y: from });
    await release();
    for (let step = 1; step <= 10; step++) await contact.move({ x, y: from + (to - from) * step / 10 });
    const scrolled = await rowAtTop(page, REVEALED);
    expect(scrolled).not.toEqual(row);
    await contact.release();
    await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0, { timeout: 10000 });
    await waitArticle(page, 'Alpha');
    await settled(page);
    expect(await rowAtTop(page, MAIN)).toEqual(scrolled);
    // A moment later still: nothing restores the position from before the jump.
    await page.waitForTimeout(1500); // sleep-ok: a late restore would move the article within this time
    await settled(page);
    expect(await rowAtTop(page, MAIN)).toEqual(scrolled);
  });

  test('a pasted code over the article runs the same jump', async ({ page }) => {
    await articleFromList(page);
    await page.evaluate(() => window.__app.onPasteDone('#1gIeu-3D'));
    await expect.poll(() => sent(page)).toContain('#1gIeu-3D\r');
    await waitArticle(page, 'Delta');
    expect(await hinted(page, UNSUPPORTED_PASTE)).toBe(false);
  });

  test('Cancel closes the sheet, sends nothing and stays on the article', async ({ page }) => {
    await articleFromList(page);
    const before = (await sent(page)).length;
    await openSheet(page);
    await page.locator(INPUT).fill('1gIeu-3D');
    await page.locator(`${SHEET} button`, { hasText: /取消|Cancel/ }).tap();
    await expect(page.locator(SHEET)).toHaveCount(0);
    await waitIdle(page);
    expect((await sent(page)).length).toBe(before);
    expect(await visibleText(page)).toContain('Alpha line');
    expect(await page.evaluate(() => window.__app.buf.startedEasyReading)).toBe(true);
  });

  test('a code the board does not have says so and leaves the reader on the article, which never moves', async ({ page }) => {
    const origin = await articleFromList(page);
    await sampleFrames(page);
    await jump(page, '1gIeu-9Z');
    await expect.poll(() => hinted(page, '1gIeu-9Z')).toBe(true);
    await waitArticle(page, 'Alpha');
    await settled(page);
    await expect.poll(() => page.evaluate(() => window.__app.articleHold.holding)).toBe(false);
    expect(await opened(page)).toBe('Alpha');
    expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(false);
    // PTT leaves the article and opens it again; the reader sees it stay put.
    expectStill(await sampledFrames(page), origin);
    expect(await rowAtTop(page, MAIN)).toEqual(origin.row);
  });

  test('over a mail More has no entrance, and # and a pasted code are refused with the hint', async ({ page }) => {
    await bootMailbox(page);
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    await ptt.sendKey(page, 'Enter');
    await page.waitForFunction(() => {
      const app = window.__app;
      return app.buf.pageState === 3 && app.view.useEasyReadingMode && app.commandQueue.idle &&
        !app.buf.timerUpdate && !app.buf._settleTimer;
    });
    const before = await page.evaluate(() => window.__mailSent.length);
    await ptt.sendKey(page, '#');
    await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
    await expect(page.locator(SHEET)).toHaveCount(0);
    await page.evaluate(() => window.__app.onPasteDone('#1gIeu-3D'));
    await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_PASTE);
    expect(await page.evaluate(() => window.__mailSent.length)).toBe(before);
    expect(await mailSurface(page)).toBe('mail');
    await page.locator('#mobileToolbar [data-key="__more"]').tap();
    await expect(page.locator('[data-key="__select"]')).toBeVisible();
    await expect(page.locator('[data-key="__aidJump"]')).toHaveCount(0);
  });
});
