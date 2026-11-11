const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, feedRaw } = require('../helpers/replay');
const { waitRectStable, assertElementUnder } = require('../helpers/layout');
const {
  bootDashboard, boardOpened, listActive, dashboardVisible, openNextArticle,
} = require('../helpers/stack_routes');

const homeNext = loadCassette('scn-stack-home-next');
const tools = page => page.locator('#floatTools');
const label = (page, key) => page.evaluate(k => window.__i18n(k), key);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

async function debugMode(page, enabled) {
  await page.locator('[data-key="__more"]').tap();
  await page.locator('[data-panel="more"]')
    .getByText(await label(page, 'cmenu_settings'), { exact: true }).tap();
  const modal = page.locator('.PrefModal');
  await expect(modal).toBeVisible();
  await modal.locator('[data-pref-category="about"]').tap();
  await modal.locator('[data-about-section="debug"] > summary').tap();
  await modal.locator('#pref-debug-mode').setChecked(enabled);
  // The full-screen settings page must cover the floating control.
  if (enabled) {
    const r = await waitRectStable(page, '#floatTools .floatTools__fab');
    await assertElementUnder(page, r.left + r.width / 2, r.top + r.height / 2, 'dialog', {
      closest: '.PrefModal', attribute: 'role',
    });
  }
  await modal.locator('[aria-label="Close"]').first().tap();
  await expect(modal).toBeHidden();
}

async function toggleRecord(page) {
  await expect(tools(page)).toHaveCount(1);
  await tools(page).locator('.floatTools__fab').tap({ timeout: 3000 });
  await page.locator('#debugRecordBtn').tap();
}

async function stopAndRead(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), toggleRecord(page)]);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const articleRead = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 3 && app.easyReading.easyReadingReachedPageEnd &&
    app.commandQueue.idle && !app.buf._settleTimer;
});

test('record from home through board and article navigation, then export on home', async ({ page }, testInfo) => {
  await bootDashboard(page, homeNext);
  await expect(tools(page)).toHaveCount(0);
  await debugMode(page, true);
  await toggleRecord(page);
  await expect(tools(page)).toHaveAttribute('data-recording', '');
  await page.evaluate(() => { window.__recordingInstance = window.__app.debugRecorder; });
  await testInfo.attach('home-recording', { body: await page.screenshot(), contentType: 'image/png' });

  await page.locator('#homeDashboard [data-home-board="C_Chat"]').tap();
  await boardOpened(page);
  for (let i = 0; i < 2; i++) await ptt.sendKey(page, 'ArrowUp');
  await ptt.sendKey(page, 'Enter');
  await articleRead(page);
  await openNextArticle(page, homeNext);
  await articleRead(page);
  await expect(tools(page)).toHaveAttribute('data-recording', '');
  await expect(tools(page)).toHaveCount(1);
  await ptt.sendKey(page, 'ArrowLeft');
  await listActive(page);
  await ptt.sendKey(page, 'ArrowLeft');
  await dashboardVisible(page);
  expect(await page.evaluate(() => window.__app.debugRecorder === window.__recordingInstance)).toBe(true);
  await expect(tools(page)).toHaveCount(1);

  // Inject an IP into the existing recording stream without changing the screen.
  await feedRaw(page, '\x1b]0;192.0.2.45\x07');
  const recording = await stopAndRead(page);
  expect(recording.meta.mode).toBe('debug');
  expect(recording.meta.redacted.ips).toBe(true);
  const received = recording.events.filter(e => e.dir === 'recv')
    .map(e => Buffer.from(e.data, 'base64').toString('latin1')).join('');
  expect(received).not.toContain('192.0.2.45');
  expect(recording.events.some(e => e.dir === 'send')).toBe(true);
  expect(recording.events.some(e => e.state?.pageState === 3)).toBe(true);
  expect(recording.cassette.meta.mode).toBe('debug-derived');
  await expect(tools(page)).not.toHaveAttribute('data-recording', '');
  await expect(page.locator('#debugRecordNotice')).toBeVisible();
});

test('native main menu can start and export; disabling debug hides the controls', async ({ page }, testInfo) => {
  await bootDashboard(page);
  await page.locator('#mobileAppBar [data-key="__homeNative"]').tap();
  await expect(page.locator('#homeDashboard')).toHaveCount(0);
  await expect(tools(page)).toHaveCount(0);
  await debugMode(page, true);
  await toggleRecord(page);
  await expect(tools(page)).toHaveAttribute('data-recording', '');
  await testInfo.attach('native-recording', { body: await page.screenshot(), contentType: 'image/png' });
  expect((await stopAndRead(page)).meta.mode).toBe('debug');
  await page.locator('#debugRecordNotice [aria-label="Close"]').tap();
  await debugMode(page, false);
  await expect(tools(page)).toHaveCount(0);
});
