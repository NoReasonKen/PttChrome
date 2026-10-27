const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { waitPreviewsSettled, waitRectStable } = require('../helpers/layout');
const { DRAWER, PANEL, beginArticleTouch, revealArticleDrawer } = require('../helpers/article_gestures');

const SIM_SOURCE = fs.readFileSync(path.join(__dirname, '../helpers/pmore_sim.js'), 'utf8');
const PORTRAIT = { width: 412, height: 896 };
const LANDSCAPE = { width: 896, height: 412 };

// Unlike ordinary replay, this server answers NAWS with its stored screen,
// then recreates pmore only when the same article is reopened. Its old
// last-page boundary must not silently adapt before that attachment boundary.
async function openArticle(page, { imageProfile, waitLoaded = true } = {}) {
  await bootOffline(page, ptt, { articleGestures: true, imageProfile });
  await ptt.applyPrefs(page, { enableEasyReading: true, enableEasyReadingList: false });
  await page.evaluate(source => {
    const module = { exports: {} };
    new Function('module', 'exports', source)(module, module.exports);
    const { createPmoreSim } = module.exports;
    const app = window.__app;
    const text = line => {
      if (line === 1) return '作者  reader (Reader) 看板 Test';
      if (line === 2) return '標題  [Test] Rotating an article';
      if (line === 3) return '時間  Mon Sep  1 12:00:00 2025';
      if (line % 30 === 10) return `https://i.imgur.com/rotation-${line}.png`;
      return (`article line ${line}: ` + 'continuous reading content '.repeat(3)).slice(0, 76);
    };
    let serverRows = app.buf.rows;
    let inArticle = true;
    let sim = createPmoreSim({ total: 280, rows: serverRows, lineText: text });
    const encode = value => [...value].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    const emit = frame => {
      let bytes = '\x1b[2J\x1b[H';
      frame.texts.forEach((line, row) => {
        if (line) {
          bytes += `\x1b[${row + 1};1H`;
          if (frame.list && (row === 0 || row === 2)) bytes += '\x1b[30;47m' + ' '.repeat(80) + '\r';
          bytes += encode(line) + '\x1b[m';
        }
      });
      app.onData(bytes + `\x1b[${frame.cursor.y + 1};${frame.cursor.x + 1}H`);
    };
    const responses = [];
    let sending = false;
    const drain = () => {
      if (sending || !responses.length) return;
      sending = true;
      setTimeout(() => {
        emit(responses.shift());
        sending = false;
        drain();
      }, 90);
    };
    window.__rotation = { commands: [], sizes: [] };
    window.__stubWSSent = bytes => {
      const at = bytes.indexOf('\xff\xfa\x1f');
      if (at >= 0) {
        const rows = bytes.charCodeAt(at + 5) * 256 + bytes.charCodeAt(at + 6);
        const old = sim.screen();
        serverRows = rows;
        const stored = old.texts.slice(0, rows);
        while (stored.length < rows) stored.push('');
        responses.push({ texts: stored, cursor: { x: 79, y: rows - 1 } });
        window.__rotation.sizes.push(rows);
        drain();
      } else if (bytes === '\x1b[D' && inArticle) {
        inArticle = false;
        window.__rotation.commands.push(bytes);
        const texts = Array(serverRows).fill('');
        texts[0] = '【板主：test】看板《Test》';
        texts[1] = '[←]離開 [→]閱讀 [^P]發表文章';
        texts[2] = '  編號    日 期 作  者       文  章  標  題';
        texts[3] = '    101       9/01 reader       □ [Test] Rotating an article';
        texts[serverRows - 1] = ' 文章選讀 (y)回應(X)推文(^X)轉錄 ';
        responses.push({ texts, list: true, cursor: { x: 0, y: 3 } });
        drain();
      } else if (bytes === '\r' && !inArticle) {
        inArticle = true;
        window.__rotation.commands.push(bytes);
        sim = createPmoreSim({ total: 280, rows: serverRows, lineText: text });
        responses.push(sim.screen());
        drain();
      } else if (/^(\x1b\[[1456]~|:\d+\r)$/.test(bytes)) {
        window.__rotation.commands.push(bytes);
        const response = sim.press(bytes);
        if (response) responses.push(...response.frames);
        drain();
      }
    };
    emit(sim.screen());
  }, SIM_SOURCE);
  await page.waitForFunction(() => window.__app.buf.pageState === 3);
  await page.evaluate(() => window.__app.easyReading.enterEasyReading());
  await expect.poll(() => page.evaluate(() => window.__app.view.reflow)).toBe(true);
  if (waitLoaded) await expect.poll(() => page.evaluate(() => window.__app.easyReading.easyReadingReachedPageEnd)).toBe(true);
}

async function rotate(page, viewport) {
  const previous = await page.evaluate(() => window.__rotation.sizes.length);
  await page.setViewportSize(viewport);
  await expect.poll(() => page.evaluate(() => window.__rotation.sizes.length)).toBeGreaterThan(previous);
  await expect.poll(() => page.evaluate(() => !window.__app.articleResize.active && !window.__app.articleResize.pending)).toBe(true);
  await expect(page.locator('.main')).toHaveClass(/mobileReflow/);
  expect(await page.evaluate(() => window.__app.buf.pageState)).toBe(3);
  expect(await page.evaluate(() => window.__app.buf.pageLines.length)).toBeGreaterThan(200);
}

for (const imageProfile of ['cache', 'slow']) {
  test(`article rotation preserves content and its reading anchor with ${imageProfile} images`, async ({ page }, testInfo) => {
    await openArticle(page, { imageProfile });
    await rotate(page, PORTRAIT);
    await waitPreviewsSettled(page);
    await page.locator('.main').hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.__app.view.currentLineIndex())).toBeGreaterThan(1);
    const anchor = await page.evaluate(() => window.__app.view.currentLineIndex());
    const count = await page.evaluate(() => window.__app.buf.pageLines.length);
    await rotate(page, LANDSCAPE);
    await waitPreviewsSettled(page);
    await expect.poll(() => page.evaluate(saved => Math.abs(window.__app.view.currentLineIndex() - saved), anchor)).toBeLessThan(1);
    expect(await page.evaluate(() => window.__app.buf.pageLines.length)).toBe(count);
    await page.screenshot({ path: testInfo.outputPath('landscape-article.png') });
    await rotate(page, PORTRAIT);
    await expect.poll(() => page.evaluate(saved => Math.abs(window.__app.view.currentLineIndex() - saved), anchor)).toBeLessThan(1);
  });
}

test('a viewport change with unchanged terminal rows restores locally without reopening PTT', async ({ page }) => {
  await openArticle(page);
  await waitPreviewsSettled(page);
  await page.locator('.main').hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.__app.view.currentLineIndex())).toBeGreaterThan(1);
  const before = await page.evaluate(() => ({
    anchor: window.__app.view.currentLineIndex(),
    commands: window.__rotation.commands.length,
    rows: window.__app.buf.rows,
  }));
  await page.setViewportSize(LANDSCAPE);
  await expect.poll(() => page.locator('.main').evaluate(el => Math.round(el.getBoundingClientRect().width)))
    .toBe(LANDSCAPE.width);
  await expect.poll(() => page.evaluate(saved => Math.abs(window.__app.view.currentLineIndex() - saved), before.anchor)).toBeLessThan(1);
  expect(await page.evaluate(() => window.__app.buf.rows)).toBe(before.rows);
  expect(await page.evaluate(() => window.__rotation.sizes)).toEqual([]);
  expect(await page.evaluate(() => window.__rotation.commands.length)).toBe(before.commands);
});

test('an open drawer adapts through the terminal resize and remains usable', async ({ page }, testInfo) => {
  await openArticle(page);
  await rotate(page, PORTRAIT);
  await revealArticleDrawer(page);
  await rotate(page, LANDSCAPE);
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
  const panel = await waitRectStable(page, PANEL);
  const toolbar = await waitRectStable(page, '#mobileToolbar');
  expect(panel.width).toBeCloseTo(LANDSCAPE.width * 0.75, 0);
  expect(panel.height).toBeCloseTo(toolbar.top * 0.6, 0);
  expect(panel.top).toBeCloseTo(toolbar.top * 0.2, 0);
  const buttons = page.locator(`${PANEL} button`);
  await expect(buttons).toHaveCount(5);
  expect(await buttons.evaluateAll(items => items.every(button => button.scrollHeight <= button.clientHeight))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('landscape-drawer.png') });
  await page.touchscreen.tap(10, panel.top + panel.height / 2);
  await expect(page.locator(DRAWER)).toHaveCount(0);
  await revealArticleDrawer(page);
  await expect(page.locator(DRAWER)).toHaveAttribute('data-state', 'open');
});

test('rotation cancels a drawer drag and preserves an article still being loaded', async ({ page }) => {
  await openArticle(page, { waitLoaded: false });
  const width = page.viewportSize().width;
  const main = await waitRectStable(page, '.main');
  const touch = await beginArticleTouch(page, { x: width - 24, y: main.top + 70 });
  await touch.move({ x: width / 2, y: main.top + 70 });
  await page.setViewportSize(PORTRAIT);
  await touch.release();
  await expect(page.locator(DRAWER)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__app.easyReading.easyReadingReachedPageEnd)).toBe(true);
  await expect.poll(() => page.evaluate(() => !window.__app.articleResize.active && !window.__app.articleResize.pending)).toBe(true);
  await expect(page.locator('.main')).toHaveClass(/mobileReflow/);
  expect(await page.evaluate(() => window.__rotation.commands.filter(keys => keys === '\x1b[D').length))
    .toBe(await page.evaluate(() => window.__rotation.sizes.length));
});
