// Real browser input against pages revealed during a delayed handoff.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootThreadBoard, listActive } = require('../helpers/thread_jump');
const { holdBackReply, heldBack } = require('../helpers/stack_routes');
const { bootGestureArticle, revealArticleDrawer } = require('../helpers/article_gestures');
const { bootNestedShortcutSearch, nativeBack, waitArticle, waitList, readToMiddle, tapShortcut, tapCard } = require('../helpers/article_shortcut_search');
const LAYER = '[data-stack-layer]:not([data-stack-parked])';
const ARTICLE_LAYER = '[data-stack-layer="article"]';
const FULL_LIST = { has: ['Alpha topic', 'Delta topic'] };
const AUTHOR_RESULTS = { has: ['Alpha topic', 'Beta topic'], lacks: ['Delta topic'] };
const startRecording = page => page.evaluate(async () => {
  const { startDebugRecording } = await import('/src/js/debug_record_control.js');
  startDebugRecording(window.__app);
});
const contactSamples = page => page.evaluate(() => window.__app.debugRecorder.events.filter(e => e.tag === 'contextMenu.contact').map(e => e.info));
const menuItem = (page, key) => page.locator(`[data-sheet="context"] [data-cmenu="${key}"]`);
const layerCard = (page, num) => page.locator(`${LAYER} .listCard`).filter({ has: page.locator('.listCardNum', { hasText: new RegExp(`^${num}$`) }) });
async function backWithHeldAnswer(page) {
  await bootThreadBoard(page, { open: 600, size: 620, fromList: true });
  const release = await holdBackReply(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await heldBack(page);
  await expect(page.locator(LAYER)).toBeVisible();
  return release;
}
async function sourceFromList(page) {
  await bootNestedShortcutSearch(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await waitList(page, FULL_LIST);
  await tapCard(page, '[Talk] Alpha topic');
  await waitArticle(page, 'Alpha');
  await readToMiddle(page);
}
const settled = page => page.waitForFunction(() => {
  const app = window.__app;
  return !document.querySelector('[data-stack-layer]:not([data-stack-parked]), [data-article-exit-underlay]') && app.commandQueue.idle &&
    !app.buf._settleTimer && (app.buf.pageState !== 2 || app.listSession.state === 'active');
});

test('real touch hold reaches the revealed list while the answer is delayed', async ({ page }) => {
  const { holdRevealed } = require('../helpers/revealed_long_press');
  const release = await backWithHeldAnswer(page);
  await startRecording(page);
  const events = await holdRevealed(page, layerCard(page, 598).locator('.listCardBody'), async () => {
    await release();
    await listActive(page);
  });
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'pointerdown', pointer: 'touch', trusted: true }),
    expect.objectContaining({ type: 'pointerup', pointer: 'touch', trusted: true }),
  ]));
  const menus = events.filter(e => e.type === 'contextmenu');
  if (menus.length) {
    expect(menus[0].trusted).toBe(true);
    await expect(page.locator('[data-sheet="context"]')).toBeVisible();
  }
  await expect(page.locator(LAYER)).toHaveCount(0);
  await expect.poll(() => contactSamples(page)).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'hold', target: 'revealed-list-card' }),
  ]));
});

test('browser context click on the revealed list stays open through handoff and is recorded', async ({ page }) => {
  const release = await backWithHeldAnswer(page);
  await page.evaluate(async () => {
    const { startDebugRecording } = await import('/src/js/debug_record_control.js');
    startDebugRecording(window.__app);
  });
  await layerCard(page, 598).locator('.listCardBody').click({ button: 'right' });
  await expect(menuItem(page, 'markReadUnread')).toBeVisible();
  await release();
  await listActive(page);
  await expect(menuItem(page, 'markReadUnread')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__app.debugRecorder.events.filter(e => e.tag?.startsWith('contextMenu.')).map(e => ({ tag: e.tag, ...e.info })))).toEqual(expect.arrayContaining([
    expect.objectContaining({ tag: 'contextMenu.dispatch', target: 'revealed-list-card', preventedFinal: true }),
    expect.objectContaining({ tag: 'contextMenu.process', disposition: 'menu' }),
    expect.objectContaining({ tag: 'contextMenu.open', reason: 'contextmenu' }),
  ]));
  await menuItem(page, 'markReadUnread').click();
  await expect.poll(() => page.evaluate(() => window.__app.debugRecorder.events.filter(e => e.tag === 'contextMenu.close').map(e => e.info))).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: 'action' }),
  ]));
});

test('real touch hold reaches the revealed source article while the answer is delayed', async ({ page }) => {
  const { holdRevealed } = require('../helpers/revealed_long_press');
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  const release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  const layer = page.locator(ARTICLE_LAYER);
  await expect(layer).toBeVisible();
  await startRecording(page);
  const events = await holdRevealed(page, layer, async () => {
    await release();
    await waitArticle(page, 'Alpha');
  });
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'pointerdown', pointer: 'touch', trusted: true }),
    expect.objectContaining({ type: 'pointerup', pointer: 'touch', trusted: true }),
  ]));
  const menus = events.filter(e => e.type === 'contextmenu');
  if (menus.length) {
    expect(menus[0].trusted).toBe(true);
    await expect(page.locator('[data-sheet="context"]')).toBeVisible();
  }
  await expect(page.locator(ARTICLE_LAYER)).toHaveCount(0);
  await waitArticle(page, 'Alpha');
  await expect.poll(() => contactSamples(page)).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'hold', target: 'revealed-article' }),
  ]));
});

test('a real touch hold records its original target being removed', async ({ page }) => {
  const { holdRevealed } = require('../helpers/revealed_long_press');
  await bootGestureArticle(page);
  await startRecording(page);
  await page.evaluate(() => {
    window.addEventListener('pointerdown', event => {
      window.__originalContactTarget = event.target;
    }, { capture: true, once: true });
  });
  await holdRevealed(page, page.locator('.main:not([data-stack-layer]) #mainContainer'), () => page.evaluate(() => {
    const target = window.__originalContactTarget;
    if (!(target instanceof Element) || target.id === 'mainContainer') throw new Error('Contact must hit article text');
    target.replaceWith(target.cloneNode(true));
  }));
  await expect.poll(() => contactSamples(page)).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'hold', target: 'main', targetConnected: false, removedDuringContact: true }),
    expect.objectContaining({ phase: 'end', target: 'main', targetConnected: false, removedDuringContact: true }),
  ]));
});

test('a real touch hold records a connected target without removal', async ({ page }) => {
  const { holdRevealed } = require('../helpers/revealed_long_press');
  await bootGestureArticle(page);
  await startRecording(page);
  await holdRevealed(page, page.locator('.main:not([data-stack-layer]) #mainContainer'), async () => {});
  await expect.poll(() => contactSamples(page)).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'hold', target: 'main', targetConnected: true, removedDuringContact: false }),
    expect.objectContaining({ phase: 'end', target: 'main', targetConnected: true, removedDuringContact: false }),
  ]));
});

test('browser context click on the revealed source article stays open through handoff', async ({ page }) => {
  await sourceFromList(page);
  await tapShortcut(page, 'author');
  await waitList(page, AUTHOR_RESULTS);
  await settled(page);
  const release = await holdBackReply(page);
  await nativeBack(page);
  await heldBack(page);
  const layer = page.locator(ARTICLE_LAYER);
  await expect(layer).toBeVisible();
  await page.evaluate(async () => {
    const { startDebugRecording } = await import('/src/js/debug_record_control.js');
    startDebugRecording(window.__app);
  });
  await layer.click({ button: 'right', position: { x: 30, y: 30 } });
  const sheet = page.locator('[data-sheet="context"]');
  await expect(sheet).toBeVisible();
  await release();
  await waitArticle(page, 'Alpha');
  await expect(sheet).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__app.debugRecorder.events.filter(e => e.tag === 'contextMenu.dispatch').map(e => e.info))).toEqual(expect.arrayContaining([
    expect.objectContaining({ target: 'revealed-article', preventedFinal: true }),
  ]));
});

test('a browser context click blocked by the open drawer is recorded', async ({ page }) => {
  await bootGestureArticle(page);
  await page.evaluate(async () => {
    const { startDebugRecording } = await import('/src/js/debug_record_control.js');
    startDebugRecording(window.__app);
  });
  await revealArticleDrawer(page);
  await page.mouse.click(10, 100, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__app.debugRecorder.events.filter(e => e.tag === 'contextMenu.blocked').map(e => e.info))).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: 'drawer-open', pointer: 'mouse', preventedFinal: true }),
  ]));
  await expect(page.locator('[data-sheet="context"]')).toHaveCount(0);
});
