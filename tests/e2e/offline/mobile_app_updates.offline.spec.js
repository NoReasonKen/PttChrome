const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { drawMainMenu } = require('../helpers/main_menu');

const text = (page, key) => page.evaluate((value) => window.__i18n(value), key);

// This replaces only the external Android message endpoint. The real About UI,
// update store, global modal ownership and browser input paths remain connected.
async function installUpdateHost(page, { proactive = false } = {}) {
  await page.addInitScript(({ proactive }) => {
    const listeners = [];
    const release = {
      id: 'android-fork-v0.4.0', version: '0.4.0', versionCode: 6,
      nativeVersionCode: 6, minSdk: 26,
      sourceCommit: '1111111111111111111111111111111111111111',
      apk: { url: 'https://github.com/NoReasonKen/PttChrome/releases/download/android-fork-v0.4.0/pttchrome.apk', size: 1048576, sha256: 'a'.repeat(64) },
      summary: { zhTW: ['手機版更新摘要。'], en: ['Release summary for the phone.'] },
    };
    const host = window.__updateHost = {
      requests: [],
      state: {
        supported: true, phase: 'idle', installedVersion: '0.3.0', installedVersionCode: 5,
        systemLanguage: 'zh-CN', automaticChecks: true, lastSuccessfulCheck: 0,
        lastError: null, needsNativeUpdate: false, prompt: false,
        release: null, progress: { downloaded: 0, total: 0 },
      },
    };
    window.__PTT_ANDROID__ = { version: '0.3.0', updateSupported: true };
    window.PttAndroid = {
      addEventListener(kind, listener) { if (kind === 'message') listeners.push(listener); },
      postMessage(data) {
        const request = JSON.parse(data);
        if (request.op !== 'update') {
          queueMicrotask(() => listeners.forEach((listener) => listener({ data: JSON.stringify({ id: request.id, ok: false, error: 'unknown op' }) })));
          return;
        }
        host.requests.push(request);
        if (request.action === 'check' && (request.manual || proactive)) {
          Object.assign(host.state, { phase: 'available', release, needsNativeUpdate: true, prompt: !request.manual, lastSuccessfulCheck: Date.now() });
        } else if (request.action === 'download') {
          Object.assign(host.state, { phase: 'downloading', prompt: false, progress: { downloaded: 262144, total: 1048576 } });
        } else if (request.action === 'cancel') {
          Object.assign(host.state, { phase: 'available', progress: { downloaded: 0, total: 0 } });
        } else if (request.action === 'later' || request.action === 'skip') {
          host.state.prompt = false;
        }
        queueMicrotask(() => {
          for (const listener of listeners) listener({ data: JSON.stringify({ id: request.id, ok: true, state: host.state }) });
        });
      },
    };
  }, { proactive });
}

async function bootUpdateMenu(page, options) {
  await installUpdateHost(page, options);
  await bootOffline(page, ptt);
  await drawMainMenu(page);
  await expect(page.locator('body')).toHaveClass(/mobile-layout/);
}

async function collectPttBytes(page) {
  await page.evaluate(() => {
    window.__updatePttBytes = [];
    window.__stubWSSent = (bytes) => window.__updatePttBytes.push(bytes);
  });
}

const sentPtt = (page) => page.evaluate(() => (window.__updatePttBytes || []).join(''));
const requestActions = (page) => page.evaluate(() => window.__updateHost.requests.map((request) => request.action));

test('manual About update blocks reading and Back during download until explicit cancellation without PTT navigation', async ({ page }) => {
  await bootUpdateMenu(page);
  await page.locator('[data-key="__more"]').tap();
  await page.locator('[data-key="__settings"]').tap();
  const modal = page.locator('.PrefModal');
  await expect(modal).toBeVisible();
  await modal.locator('[data-pref-category="about"]').tap();
  const update = modal.locator('[data-about-section="update"]');
  await expect(update.getByRole('button', { name: await text(page, 'about_update_check'), exact: true })).toBeVisible();
  await collectPttBytes(page);
  await update.getByRole('button', { name: await text(page, 'about_update_check'), exact: true }).tap();
  await expect(update.getByText('手機版更新摘要。', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('about-update-summary.png'), animations: 'disabled' });
  await update.getByRole('button', { name: await text(page, 'about_update_download'), exact: true }).tap();
  const block = page.locator('[data-app-update-block]');
  await expect(block).toBeVisible();
  await expect(block.getByRole('button', { name: await text(page, 'about_update_cancel_download'), exact: true })).toBeVisible();
  await page.waitForFunction(() => !!window.history.state?.pttchromeBackGuard);
  await page.goBack();
  await expect(block).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(block).toBeVisible();
  await expect(modal).toBeVisible();
  expect((await requestActions(page)).filter((action) => action === 'cancel')).toHaveLength(0);
  expect(await sentPtt(page)).toBe('');
  await page.screenshot({ path: test.info().outputPath('download-blocks-back.png'), animations: 'disabled' });
  await block.getByRole('button', { name: await text(page, 'about_update_cancel_download'), exact: true }).tap();
  await expect(block).toHaveCount(0);
  expect((await requestActions(page)).filter((action) => action === 'cancel')).toHaveLength(1);
  expect(await sentPtt(page)).toBe('');
  await expect(update.getByRole('button', { name: await text(page, 'about_update_download'), exact: true })).toBeEnabled();
});

test('a proactive update prompt opens About at the update controls without sending PTT navigation', async ({ page }) => {
  await bootUpdateMenu(page, { proactive: true });
  const prompt = page.locator('[data-app-update-prompt]');
  await expect(prompt).toBeVisible();
  await collectPttBytes(page);
  await prompt.getByRole('button', { name: await text(page, 'about_update_view'), exact: true }).tap();
  await expect(page.locator('.PrefModal')).toBeVisible();
  const update = page.locator('.PrefModal [data-about-section="update"]');
  await expect(update.getByRole('button', { name: await text(page, 'about_update_download'), exact: true })).toBeVisible();
  await expect(update.getByText('手機版更新摘要。', { exact: true })).toBeVisible();
  expect(await sentPtt(page)).toBe('');
});
