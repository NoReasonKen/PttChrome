// A failed article operation holds the article (#193): the reader stays on it
// with a message, the debug recording logs a bug event, nothing more is sent,
// and pull-to-refresh retries from what PTT shows.
const { expect } = require('@playwright/test');
const { touchDrag } = require('./real_input');
const { waitRectStable } = require('./layout');
const { recordHints, recordedHints } = require('./stack_routes');

// Every bug event, every key sent from now on, and whether easy reading ever
// turns off (the native screen).
async function watchHold(page) {
  await recordHints(page);
  await page.evaluate(() => {
    const app = window.__app;
    window.__bugs = [];
    window.__keys = [];
    window.__wentNative = false;
    app.debugRecorder = {
      isRecording: true,
      log: (tag, info) => {
        if (tag === 'bug') window.__bugs.push(info);
        if (tag === 'easyReading.exit') window.__wentNative = true;
      }
    };
    const reply = window.__stubWSSent;
    window.__stubWSSent = (data) => {
      window.__keys.push(data);
      reply(data);
    };
  });
}

const keyCount = page => page.evaluate(() => window.__keys.length);
const sentSince = (page, n) => page.evaluate((n) => window.__keys.slice(n), n);

// The article stays shown under its cover, the message (`[zh_TW, en_US]`,
// either locale) names the failure, and one bug event from `source` is logged.
async function expectArticleHeld(page, { message, source, text }) {
  await expect.poll(async () => (await recordedHints(page)).some(hint => message.includes(hint)), { timeout: 15000 }).toBe(true);
  expect(await page.evaluate(() => window.__app.articleHold.held)).toBe(true);
  await expect(page.locator('[data-stack-layer]').first()).toContainText(text);
  expect(await page.evaluate(() => window.__wentNative)).toBe(false);
  expect(await page.evaluate(() => window.__bugs)).toEqual([expect.objectContaining({ source })]);
  expect(await recordedHints(page)).not.toContainEqual(expect.stringMatching(/原生|native/i));
}

// A pull from the top of the held article.
async function pullDown(page) {
  const r = await waitRectStable(page, '[data-stack-layer]');
  const x = r.left + r.width / 2;
  const y = r.top + 40;
  await touchDrag(page, { x, y }, { x, y: y + 260 });
}

module.exports = { watchHold, keyCount, sentSince, expectArticleHeld, pullDown };
