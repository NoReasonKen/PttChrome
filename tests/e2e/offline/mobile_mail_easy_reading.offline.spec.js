// Easy-reading mail (#196): the home dashboard's mail entrance leads to the
// mail list shown by list easy reading, a mail opens in the easy-reading
// reader, and leaving goes back the same way. With easy reading on, PttChrome
// presents every screen on this route, so the native grid guard
// (helpers/native_grid_guard.js, failing on offline-mobile) must see no frame
// of PTT's grid.
//
// The mailbox is the controlled PTT of helpers/mail_box.js: no recording of
// the mail list or an open mail exists, so its screens are laid out from the
// pttbbs source (mail.c, read.c, menu.c), with invented senders and subjects.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { beginArticleTouch } = require('../helpers/article_gestures');
const { bootMailbox, mailListActive, mailSurface, MAILS } = require('../helpers/mail_box');
const { touchDrag, rightClickElement } = require('../helpers/real_input');
const { waitRectStable } = require('../helpers/layout');

const UNSUPPORTED_REFRESH = '好讀模式目前不支援重新整理信箱（關閉好讀模式可使用 PTT 原生操作）';
const UNSUPPORTED_KEY = '好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）';
const guardHits = (page) => page.evaluate(() => window.__nativeGridGuard.hits);
const dashboard = (page) => page.locator('#homeDashboard');
const main = (page) => page.locator('.main:not([data-stack-layer])');
// The mail cards: a short list is padded to a screen with blank filler cards.
const cards = (page) => main(page).locator('.listCard').filter({ has: page.locator('.listCardNum', { hasText: /\d/ }) });
// A mail is open in article easy reading and everything has settled.
const mailRead = (page) => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.view.useEasyReadingMode && app.commandQueue.idle &&
    !app.buf.timerUpdate && !app.buf._settleTimer;
});

test.describe('easy-reading mail', () => {
  test('the home dashboard always has a mail entrance, even without new mail', async ({ page }) => {
    await bootMailbox(page, { mails: MAILS.map((m) => ({ ...m, mark: ' ' })) });
    expect(await page.evaluate(() => window.__app.homeDashboard.state.newMail)).toBe(false);
    await expect(page.locator('[data-home-mail]')).toBeVisible();
  });

  test('the mail entrance opens the mail list through list easy reading, and ← goes back home', async ({ page }) => {
    await bootMailbox(page);
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    expect(await mailSurface(page)).toBe('list');
    expect(await page.evaluate(() => window.__app.listSession.isMailList())).toBe(true);
    // One card per mail, the sender and the subject in their own fields.
    await expect(cards(page)).toHaveCount(MAILS.length);
    const newest = cards(page).last();
    await expect(newest.locator('.listCardAuthor')).toHaveText('erin');
    await expect(newest.locator('.listCardTitleText')).toHaveText('◇ 借書的事情');
    await expect(newest.locator('.listCardDate')).toHaveText('11/12');
    await expect(newest).toHaveAttribute('data-list-mark', 'unread');
    expect(await guardHits(page)).toEqual([]);

    await ptt.sendKey(page, 'ArrowLeft');
    await expect(dashboard(page)).toBeVisible();
    expect(await mailSurface(page)).toBe('menu');
    await expect(page.locator('[data-home-mail]')).toBeVisible();
    expect(await guardHits(page)).toEqual([]);
  });

  // The mail list's header bar ends in a capacity tag on a colour of its own,
  // as on real PTT: it is still the list's header, and the held page gives
  // way to the list as soon as PTT answers, not after the hold's bound.
  test('a two-mail mailbox is presented as soon as PTT answers', async ({ page }) => {
    await bootMailbox(page, { mails: MAILS.slice(-2) });
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await page.locator('[data-home-mail]').tap();
    await page.waitForFunction(() => {
      const app = window.__app;
      return !app.boardSearchHold && app.buf.listRenderMode === 'buffer' && app.listSession.isMailList();
    }, null, { timeout: 2000 });
    await mailListActive(page);
    await expect(cards(page)).toHaveCount(2);
    expect(await guardHits(page)).toEqual([]);
  });

  test('an empty mailbox stays home with a hint, and PTT\'s notice is never painted', async ({ page }) => {
    await bootMailbox(page, { mails: [] });
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await page.locator('[data-home-mail]').tap();
    await expect(page.locator('.ListHint')).toHaveText('信箱裡沒有信');
    await expect(dashboard(page)).toBeVisible();
    expect(await mailSurface(page)).toBe('menu');
    expect(await guardHits(page)).toEqual([]);
  });

  test('a long mailbox fills in as the list scrolls up', async ({ page }) => {
    await bootMailbox(page, { count: 60 });
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    await ptt.sendKey(page, 'Home');
    await mailListActive(page);
    await expect(cards(page).first().locator('.listCardNum')).toHaveText('1');
    expect(await guardHits(page)).toEqual([]);
  });

  test('the mail list under the legacy caption 鴻雁往返 is presented the same way', async ({ page }) => {
    await bootMailbox(page, { legacy: true });
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    await expect(cards(page)).toHaveCount(MAILS.length);
    expect(await guardHits(page)).toEqual([]);
  });

  test('Enter reads the selected mail in easy reading, and ← goes back to the list', async ({ page }) => {
    await bootMailbox(page);
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await ptt.sendKey(page, 'Enter');
    await mailRead(page);
    expect(await mailSurface(page)).toBe('mail');
    expect(await page.evaluate(() => window.__mailServer.state.open.from)).toBe('erin');
    await expect(main(page)).toContainText('Mail body from erin.');
    expect(await guardHits(page)).toEqual([]);

    await ptt.sendKey(page, 'ArrowLeft');
    await mailListActive(page);
    expect(await mailSurface(page)).toBe('list');
    await expect(cards(page)).toHaveCount(MAILS.length);
    // PTT repaints the list with the mail read.
    await expect(cards(page).last()).not.toHaveAttribute('data-list-mark', 'unread');
    expect(await guardHits(page)).toEqual([]);
  });

  test('over an open mail the reply and same-thread keys are refused, and nothing is sent', async ({ page }) => {
    await bootMailbox(page);
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    await ptt.sendKey(page, 'Enter');
    await mailRead(page);
    const before = await page.evaluate(() => window.__mailSent.length);
    for (const key of ['y', 'r', '=', ']']) {
      await ptt.sendKey(page, key);
      await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
    }
    expect(await page.evaluate(() => window.__mailSent.length)).toBe(before);
    expect(await mailSurface(page)).toBe('mail');
    await expect(main(page)).toContainText('Mail body from erin.');
  });

  // Easy reading presents reading mail, not answering or managing it.
  test('reply, delete and search keys on the mail list are refused, and nothing is sent', async ({ page }) => {
    await bootMailbox(page);
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    const before = await page.evaluate(() => window.__mailSent.length);
    for (const key of ['y', 'd', '/', 's', 'x']) {
      await ptt.sendKey(page, key);
      await expect(page.locator('.ListHint')).toHaveText(UNSUPPORTED_KEY);
      await expect(page.locator('.ListHint')).toHaveAttribute('data-level', 'error');
    }
    expect(await page.evaluate(() => window.__mailSent.length)).toBe(before);
    expect(await page.locator('input[name="searchKeyword"]').count()).toBe(0);
    expect(await mailSurface(page)).toBe('list');
  });

  // #252: the article list's entrances do not apply to a mailbox, whose title
  // row still names the board last visited. None of them sends anything to
  // PTT, and the reader is told.
  const sentCount = (page) => page.evaluate(() => window.__mailSent.length);
  const hint = (page) => page.locator('.ListHint');
  // F5 is taken by easy reading (the browser would reload and disconnect).
  const pressF5 = async (page) => {
    await page.evaluate(() => {
      window.__f5Prevented = null;
      // Read after the dispatch, whichever listener of the page ran first.
      document.addEventListener('keydown', (e) => {
        if (e.key === 'F5') setTimeout(() => { window.__f5Prevented = e.defaultPrevented; });
      }, { once: true, capture: true });
    });
    await ptt.sendKey(page, 'F5');
    await page.waitForFunction(() => window.__f5Prevented !== null);
    return page.evaluate(() => window.__f5Prevented);
  };

  test('F5 on the mail list is refused with the hint: nothing is sent and the page is not reloaded', async ({ page }) => {
    await openMailList(page);
    const before = await sentCount(page);
    expect(await pressF5(page)).toBe(true);
    await expect(hint(page)).toHaveText(UNSUPPORTED_REFRESH);
    await expect(hint(page)).toHaveAttribute('data-level', 'error');
    expect(await sentCount(page)).toBe(before);
    expect(await mailSurface(page)).toBe('list');
  });

  test('F5 over an open mail is refused with the hint, not handed to the browser', async ({ page }) => {
    await openNewestMail(page);
    const before = await sentCount(page);
    expect(await pressF5(page)).toBe(true);
    await expect(hint(page)).toHaveText(UNSUPPORTED_REFRESH);
    expect(await sentCount(page)).toBe(before);
    expect(await mailSurface(page)).toBe('mail');
  });

  test('pull-to-refresh on the mail list is refused with the hint and sends nothing', async ({ page }) => {
    await openMailList(page);
    const r = await waitRectStable(page, '#mainContainer');
    const x = r.left + r.width / 2;
    const y = r.top + 40;
    const before = await sentCount(page);
    await touchDrag(page, { x, y }, { x, y: y + 260 });
    await expect(hint(page)).toHaveText(UNSUPPORTED_REFRESH);
    expect(await sentCount(page)).toBe(before);
    expect(await mailSurface(page)).toBe('list');
  });

  test('the toolbar offers no refresh, post, jump to unread or mark all read on the mail list', async ({ page }) => {
    await openMailList(page);
    await expect(page.locator('[data-key="__refresh"]')).toBeDisabled();
    await expect(page.locator('[data-key="__post"]')).toHaveCount(0);
    await expect(page.locator('[data-key="__end"]')).toBeEnabled();
    await page.locator('[data-key="__more"]').tap();
    await expect(page.locator('[data-key="__help"]')).toBeVisible();
    await expect(page.locator('[data-key="__unreadJump"]')).toHaveCount(0);
    await expect(page.locator('[data-key="__markAllRead"]')).toHaveCount(0);
  });

  test('the F7 hotkey (jump to first unread) is refused with the hint and sends nothing', async ({ page }) => {
    await openMailList(page);
    const before = await sentCount(page);
    await ptt.sendKey(page, 'F7');
    await expect(hint(page)).toHaveText(UNSUPPORTED_KEY);
    expect(await sentCount(page)).toBe(before);
  });

  test('a mail card\'s context menu has no mark-read entry', async ({ page }) => {
    await openMailList(page);
    const before = await sentCount(page);
    const label = await page.evaluate(() => window.__i18n('cmenu_markReadUnread'));
    await rightClickElement(page, '.main:not([data-stack-layer]) .listCard[data-list-mark] .listCardBody');
    const menu = page.locator('[data-sheet="context"]').first();
    await expect(menu.locator('[data-cmenu]').first()).toBeVisible();
    await expect(menu.locator('[data-cmenu]').filter({ hasText: label })).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await sentCount(page)).toBe(before);
  });

  test('the App Bar names the mail list, not the board last visited', async ({ page }) => {
    await openMailList(page);
    await expect(page.locator('#mobileAppBar [data-key="__title"]')).toHaveText('郵件選單');
  });

  test('tapping a mail card reads that mail', async ({ page }) => {
    await bootMailbox(page);
    await page.locator('[data-home-mail]').tap();
    await mailListActive(page);
    await page.evaluate(() => window.__nativeGridGuard.reset());
    await cards(page).nth(2).tap();
    await mailRead(page);
    expect(await page.evaluate(() => window.__mailServer.state.open.from)).toBe('carol');
    await expect(main(page)).toContainText('Mail body from carol.');
    expect(await guardHits(page)).toEqual([]);
  });
});

// The page stack (docs/article-swipe-drawer-spec.md): the mail list slides in
// over the dashboard and keeps it alive below, and a mail does the same over
// the mail list. Back and the edge swipe reveal the page below at once, never
// the dark fallback, while PTT's answer to the leave is held.
const HOME_LAYER = '[data-stack-layer="home"]';
const LIST_LAYER = '[data-stack-layer="articleList"]:not([data-stack-parked])';
const UNDERLAY = '[data-article-exit-underlay]';
const newestCard = (root) => root.locator('.listCard').filter({ has: root.page().locator('.listCardAuthor', { hasText: 'erin' }) });

// Hold PTT's reply to every leave (←) until released, oldest first.
const holdLeaves = (page) => page.evaluate(() => {
  const send = window.__stubWSSent;
  window.__heldLeaves = [];
  window.__stubWSSent = (data) => {
    if (data.indexOf('\x1b[D') < 0) return send(data);
    window.__heldLeaves.push(() => send(data));
  };
});
const heldLeaves = (page) => page.evaluate(() => window.__heldLeaves.length);
const releaseLeave = (page) => page.evaluate(() => window.__heldLeaves.shift()());

// An edge swipe right across the screen, released: the page goes back. Before
// the release the page below shows beside it: returns the underlay's preview
// kind then ('layer' for a live layer, 'fallback' for the dark backdrop).
async function swipeBack(page) {
  const box = await main(page).boundingBox();
  const y = box.y + box.height / 2;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: 36, y });
  await contact.move({ x: 160, y });
  await expect(page.locator(UNDERLAY)).toHaveCount(1);
  const preview = await page.locator(UNDERLAY).getAttribute('data-preview');
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.release();
  return preview;
}

async function openMailList(page, opts) {
  await bootMailbox(page, opts);
  await page.evaluate(() => window.__nativeGridGuard.reset());
  await page.locator('[data-home-mail]').tap();
  await mailListActive(page);
}

async function openNewestMail(page) {
  await openMailList(page);
  await ptt.sendKey(page, 'Enter');
  await mailRead(page);
}

test.describe('easy-reading mail in the page stack', () => {
  test('the mail list slides in over the dashboard, which ← reveals at once', async ({ page }) => {
    await openMailList(page);
    await holdLeaves(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(HOME_LAYER)).toBeVisible();
    await expect(page.locator(`${HOME_LAYER} [data-home-mail]`)).toBeVisible();
    await releaseLeave(page);
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator(UNDERLAY)).toHaveCount(0);
    expect(await mailSurface(page)).toBe('menu');
    expect(await guardHits(page)).toEqual([]);
  });

  test('an edge swipe on the mail list reveals the dashboard, not the dark fallback, and goes home', async ({ page }) => {
    await openMailList(page);
    await holdLeaves(page);
    expect(await swipeBack(page)).toBe('layer');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(HOME_LAYER)).toBeVisible();
    await releaseLeave(page);
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
    expect(await mailSurface(page)).toBe('menu');
    expect(await guardHits(page)).toEqual([]);
  });

  test('a mail slides in over the mail list, which ← reveals at once with the mail read', async ({ page }) => {
    await openNewestMail(page);
    await holdLeaves(page);
    await ptt.sendKey(page, 'ArrowLeft');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    const layer = page.locator(LIST_LAYER);
    await expect(layer).toBeVisible();
    await expect(newestCard(layer)).toHaveCount(1);
    await expect(newestCard(layer)).not.toHaveAttribute('data-list-mark', 'unread');
    await releaseLeave(page);
    await mailListActive(page);
    await expect(layer).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator(UNDERLAY)).toHaveCount(0);
    expect(await mailSurface(page)).toBe('list');
    await expect(newestCard(main(page))).not.toHaveAttribute('data-list-mark', 'unread');
    expect(await guardHits(page)).toEqual([]);
  });

  test('an edge swipe on a mail reveals the mail list, and then the dashboard below it', async ({ page }) => {
    await openNewestMail(page);
    await holdLeaves(page);
    expect(await swipeBack(page)).toBe('layer');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(LIST_LAYER)).toBeVisible();
    await releaseLeave(page);
    await mailListActive(page);
    await expect(page.locator(LIST_LAYER)).toHaveCount(0, { timeout: 10000 });
    expect(await swipeBack(page)).toBe('layer');
    await expect.poll(() => heldLeaves(page)).toBe(1);
    await expect(page.locator(HOME_LAYER)).toBeVisible();
    await releaseLeave(page);
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator(HOME_LAYER)).toHaveCount(0, { timeout: 10000 });
    expect(await guardHits(page)).toEqual([]);
  });

  test('an empty mailbox keeps no copy of the dashboard', async ({ page }) => {
    await bootMailbox(page, { mails: [] });
    await page.locator('[data-home-mail]').tap();
    await expect(page.locator('.ListHint')).toHaveText('信箱裡沒有信');
    await expect(dashboard(page)).toBeVisible();
    expect(await page.evaluate(() => window.__app.articleGestures.stack.pending)).toBe(null);
    await expect(page.locator(HOME_LAYER)).toHaveCount(0);
    await expect(page.locator(UNDERLAY)).toHaveCount(0);
  });
});
