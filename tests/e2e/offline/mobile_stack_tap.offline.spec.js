// A tap on the revealed article list while it waits for PTT (#30) is
// remembered by the article's identity and opened on the refreshed list.
const { test, expect } = require('@playwright/test');
const { waitRectStable } = require('../helpers/layout');
const { beginArticleTouch } = require('../helpers/article_gestures');
const ptt = require('../helpers/ptt');
const { loadCassette, bootScenario, waitFed } = require('../helpers/replay');
const { MAIN, holdBackReply, heldBack } = require('../helpers/stack_routes');

const reopen = loadCassette('scn-stack-article-reopen');
const LAYER = '[data-stack-layer]';
const UNDERLAY = '[data-article-exit-underlay]';

const listActive = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 2 && app.listSession.state === 'active' && app.commandQueue.idle && !app.buf._settleTimer;
});

const articleRead = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.easyReading.easyReadingReachedPageEnd && app.commandQueue.idle && !app.buf._settleTimer;
});

// Open the recorded article from the list, and return its card's identity.
async function openRecordedArticle(page) {
  await bootScenario(page, ptt, reopen, { articleGestures: true });
  await ptt.applyPrefs(page, { enableEasyReadingList: true });
  await listActive(page);
  const card = await page.evaluate(() => {
    const ls = window.__app.listSession;
    const idx = window.__app.buf.listLineNums.indexOf(ls._selectedNum);
    const row = document.querySelector(`.main [data-row="${ls.headerRows() + ls._sequence().indexOf(idx)}"]`)?.closest('.listCard');
    return row && { author: row.dataset.listAuthor, title: row.dataset.listTitle };
  });
  expect(card).toBeTruthy();
  await ptt.sendKey(page, 'Enter');
  await articleRead(page);
  return card;
}

// Leave by swipe with PTT's list reply held back until `release()`.
async function leaveWithHeldReply(page) {
  const release = await holdBackReply(page);
  const main = await waitRectStable(page, MAIN);
  const contact = await beginArticleTouch(page, { x: 20, y: main.top + 100 });
  await contact.move({ x: page.viewportSize().width - 20, y: main.top + 100 });
  await contact.release();
  await heldBack(page);
  // The release's own click stays suppressed briefly; a reader taps later.
  await page.waitForTimeout(450); // sleep-ok: past the release's click suppression
  return release;
}

const layerCard = (page, { author, title }) =>
  page.locator(`${LAYER} .listCard[data-list-author="${author}"][data-list-title="${title}"] .listCardBody`).first();

test('a tap during the handoff opens the same article after the swap', async ({ page }) => {
  const card = await openRecordedArticle(page);
  const reply = await leaveWithHeldReply(page);
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  await layerCard(page, card).tap();
  // Nothing is sent while the list is only revealed.
  expect(await page.evaluate(n => window.__replay.sent.slice(n), sentBefore)).toEqual([]);
  await reply();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await articleRead(page);
  await waitFed(page, reopen.steps.length - 1);
});

test('a tapped article that moved on the refreshed list is found by identity and opened', async ({ page }) => {
  const card = await openRecordedArticle(page);
  const reply = await leaveWithHeldReply(page);
  // Stand-in for a list where earlier articles were deleted: on the revealed
  // list the article sits on another card than on the refreshed one.
  const moved = await page.evaluate(({ author, title }) => {
    const cards = [...document.querySelectorAll('[data-stack-layer] .listCard')];
    const own = cards.find(c => c.dataset.listAuthor === author && c.dataset.listTitle === title);
    const other = cards.find(c => c !== own && c.querySelector('.listCardBody') && c.getBoundingClientRect().height);
    own.dataset.listTitle = 'another article';
    other.dataset.listAuthor = author;
    other.dataset.listTitle = title;
    return cards.indexOf(own) !== cards.indexOf(other);
  }, card);
  expect(moved).toBe(true);
  await layerCard(page, card).tap();
  await reply();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await articleRead(page);
  await waitFed(page, reopen.steps.length - 1);
});

test('a tapped article missing from the refreshed list gives a notice, keeps the list and sends no open', async ({ page }) => {
  const card = await openRecordedArticle(page);
  const reply = await leaveWithHeldReply(page);
  // Held by element: the locator matches by the title that is about to change.
  const target = await layerCard(page, card).elementHandle();
  // Stand-in for an article deleted while the list was being refreshed.
  await target.evaluate(body => { body.closest('.listCard').dataset.listTitle = 'deleted meanwhile'; });
  await target.tap();
  await reply();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.ListHint')).toBeVisible();
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  await page.waitForTimeout(1000); // sleep-ok: proves no open is sent afterwards
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(2);
  expect(await page.evaluate(n => window.__replay.sent.slice(n), sentBefore)).toEqual([]);
});

test('keys and toolbar actions other than Back are blocked until the swap', async ({ page }) => {
  await openRecordedArticle(page);
  // Leave by ← on the keypad, which stays open over the revealed list.
  await page.locator('#mobileToolbar [data-key="__keys"]').tap();
  const reply = await holdBackReply(page);
  await page.locator('.mobileKeypadKey[data-key="ArrowLeft"]').tap();
  await heldBack(page);
  await expect(page.locator(LAYER)).toBeVisible();
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  await page.keyboard.press('End');
  await page.keyboard.press('j');
  for (const key of ['ArrowUp', 'PageDown', 'Enter'])
    await page.locator(`.mobileKeypadKey[data-key="${key}"]`).tap();
  expect(await page.evaluate(n => window.__replay.sent.slice(n), sentBefore)).toEqual([]);
  for (const key of ['__end', '__keys', '__more'])
    await expect(page.locator(`#mobileToolbar [data-key="${key}"]`)).toBeDisabled();
  await reply();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await listActive(page);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(2);
  await expect(page.locator('#mobileToolbar [data-key="__more"]')).toBeEnabled();
});

test('system Back during the handoff neither leaves the site nor reaches PTT', async ({ page }) => {
  await openRecordedArticle(page);
  // Survives only while the page stays this document, on this site.
  await page.evaluate(() => {
    window.__sameDocument = true;
    window.__hints = [];
    const flash = window.__app.view.flashListHint.bind(window.__app.view);
    window.__app.view.flashListHint = (text, ...rest) => { window.__hints.push(text); return flash(text, ...rest); };
  });
  const reply = await leaveWithHeldReply(page);
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  for (let i = 0; i < 2; ++i) {
    await page.goBack();
    expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  }
  expect(await page.evaluate(n => window.__replay.sent.slice(n), sentBefore)).toEqual([]);
  // A Back that counted toward leaving the site would have said so.
  expect(await page.evaluate(() => window.__hints)).toEqual([]);
  await reply();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await listActive(page);
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test('the release that ends the swipe over an article opens nothing', async ({ page }) => {
  await openRecordedArticle(page);
  await page.evaluate(() => {
    const send = window.__stubWSSent;
    window.__stubWSSent = (data) => {
      if (data.indexOf('\x1b[D') < 0) return send(data);
      setTimeout(() => send(data), 700);
    };
  });
  const main = await waitRectStable(page, MAIN);
  // The swipe ends in the middle of the list, over an article card.
  const y = main.top + main.height / 2;
  const contact = await beginArticleTouch(page, { x: 20, y });
  await contact.move({ x: page.viewportSize().width / 2, y });
  await contact.move({ x: page.viewportSize().width - 20, y });
  await contact.release();
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await listActive(page);
  const sentBefore = await page.evaluate(() => window.__replay.sent.length);
  await page.waitForTimeout(1000); // sleep-ok: proves no open follows the swap
  expect(await page.evaluate(n => window.__replay.sent.slice(n), sentBefore)).toEqual([]);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(2);
});
