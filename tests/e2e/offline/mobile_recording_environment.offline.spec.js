const { test, expect } = require('@playwright/test');
const { bootThreadBoard } = require('../helpers/thread_jump');
const { applyRecordedViewport } = require('../helpers/replay');
const { waitRectStable } = require('../helpers/layout');
const ptt = require('../helpers/ptt');

test('recording preserves initial geometry and captures font and viewport changes', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 840 });
  await bootThreadBoard(page);
  await page.evaluate(() => window.__app.setDebugMode(true));
  const fab = page.locator('#floatTools .floatTools__fab');
  const record = page.locator('#debugRecordBtn');
  await fab.tap();
  await record.tap();
  await expect(page.locator('#floatTools')).toHaveAttribute('data-recording', '');
  const initial = await page.evaluate(() => window.__app.debugRecorder.events.find(event => event.tag === 'record.environment').info);
  expect(initial.viewport).toMatchObject({ width: 412, height: 840 });

  const main = '.main:not([data-stack-layer])';
  const before = await waitRectStable(page, main, { fullRect: true });
  await ptt.applyPrefs(page, { mobileFontSize: 20 });
  await expect.poll(() => page.evaluate(() => window.__app.debugRecorder.events
    .filter(event => event.tag === 'record.environment').at(-1).info.terminal.mobileFontPx)).toBe(20);
  const after = await waitRectStable(page, main, { fullRect: true });
  expect(after.height).toBe(before.height);
  expect(after.width).toBe(before.width);

  await page.setViewportSize({ width: 840, height: 412 });
  await expect.poll(() => page.evaluate(() => {
    const app = window.__app;
    const environment = app.debugRecorder.events.filter(event => event.tag === 'record.environment').at(-1).info;
    return environment.viewport.width === 840 && environment.viewport.height === 412 &&
      environment.terminal.rows === app.buf.rows && environment.terminal.cellHeight === app.view.chh;
  })).toBe(true);
  await fab.tap();
  const [download] = await Promise.all([page.waitForEvent('download'), record.tap()]);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const capture = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(capture.cassette.meta.environment).toEqual(initial);
  expect(capture.cassette.rows).toBe(initial.terminal.rows);
  const environments = capture.events.filter(event => event.tag === 'record.environment');
  expect(environments.some(event => event.info.viewport.width === 840)).toBe(true);
  expect(environments.some(event => event.info.terminal.mobileFontPx === 20)).toBe(true);
  expect(await applyRecordedViewport(page, capture)).toEqual(initial);
  expect(page.viewportSize()).toEqual({ width: 412, height: 840 });
});
