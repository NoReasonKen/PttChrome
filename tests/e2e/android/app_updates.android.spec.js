// Opt-in: scripts/run-update-android-e2e.mjs builds both debug-signed artifacts.
// The native bridge, DownloadManager, verification and installer remain real.
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { test: base, expect } = require('./fixtures');
const { APK_PKG, sdkTool } = require('./android_env');
const { openScreen, tap, recordTouches } = require('./screen');

const enabled = !!process.env.ANDROID_UPDATE_TEST_APK;
const test = base.extend({
  apkInstalled: [async ({ android }, use) => {
    if (!enabled) { await use(null); return; }
    // Only the disposable debug test identity is reset; production is untouched.
    await android.device.shell(`pm uninstall ${APK_PKG}`).catch(() => {});
    const result = spawnSync(sdkTool('adb'), ['-s', android.serial, 'install', '-r', '-t', '-g', process.env.ANDROID_E2E_APK], { encoding: 'utf8' });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    await use(process.env.ANDROID_E2E_APK);
  }, { scope: 'worker', timeout: 120000 }],
});

test.describe('controlled Android updater', () => {
  test.skip(!enabled, 'Opt-in requires the two artifacts from run-update-android-e2e.mjs');
  let server;
  let rejectHash = false;
  const origin = 'http://127.0.0.1:8126';
  test.beforeAll(async () => {
    if (!enabled) return;
    const bytes = fs.readFileSync(process.env.ANDROID_UPDATE_TEST_APK);
    server = http.createServer((request, response) => {
      if (request.url === '/pttchrome.apk') {
        response.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': bytes.length });
        response.end(bytes);
        return;
      }
      const metadata = {
        schemaVersion: 1, tag: 'android-fork-v1.0.1', version: '1.0.1',
        sourceCommit: 'a'.repeat(40), versionCode: 2, packageName: APK_PKG,
        minSdk: 26, nativeVersionCode: 2,
        apk: { url: `${origin}/pttchrome.apk`, size: bytes.length,
          sha256: rejectHash ? '0'.repeat(64) : crypto.createHash('sha256').update(bytes).digest('hex') },
        summary: { zhTW: ['受控更新測試'], en: ['Controlled update test'] },
      };
      const release = { draft: false, prerelease: false, tag_name: metadata.tag,
        assets: [{ name: 'update.json', browser_download_url: `${origin}/update.json` },
          { name: 'pttchrome.apk', browser_download_url: metadata.apk.url, size: bytes.length }] };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.url === '/release.json' ? release : metadata));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(8126, '127.0.0.1', resolve);
    });
  });
  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function openUpdates(apk, invalid) {
    rejectHash = invalid;
    // DownloadManager needs an active OS network even for adb-reversed HTTP.
    // The reader's PTT socket remains stubbed by openScreen.
    await apk.device.shell('svc wifi enable; svc data enable');
    await apk.device.shell('appops set ' + APK_PKG + ' REQUEST_INSTALL_PACKAGES allow');
    const reverse = spawnSync(sdkTool('adb'), ['-s', apk.device.serial(), 'reverse', 'tcp:8126', 'tcp:8126']);
    expect(reverse.status).toBe(0);
    await openScreen(apk.page, {}, { reload: true });
    await recordTouches(apk.page);
    await tap(apk.page, apk.device, '[data-key="__more"]');
    await tap(apk.page, apk.device, '[data-key="__settings"]');
    await apk.page.locator('[data-pref-category="about"]').scrollIntoViewIfNeeded();
    await tap(apk.page, apk.device, '[data-pref-category="about"]');
    const key = (name) => apk.page.evaluate((value) => window.__i18n(value), name);
    const section = apk.page.locator('[data-about-section="update"]');
    await section.getByRole('button', { name: await key('about_update_check'), exact: true }).click();
    await expect(section.getByText('1.0.1', { exact: false })).toBeVisible();
    await section.getByRole('button', { name: await key('about_update_download'), exact: true }).click();
    return { section, key };
  }

  test('a corrupt artifact releases the block and cannot reach installation', async ({ apk }) => {
    const { section, key } = await openUpdates(apk, true);
    await expect(section.getByRole('alert')).toContainText('integrity', { timeout: 90000 });
    await expect(apk.page.locator('[data-app-update-block]')).toHaveCount(0);
    await expect(section.getByRole('button', { name: await key('about_update_install'), exact: true })).toHaveCount(0);
  });

  test('About downloads a signed newer APK and hands it to the real system installer', async ({ apk }) => {
    const { section, key } = await openUpdates(apk, false);
    // Foreground completion now opens the system installer automatically.
    await apk.device.tap({ text: /^(Update|Install)$/ });
    await expect.poll(async () => String(await apk.device.shell(`dumpsys package ${APK_PKG}`)), { timeout: 90000 })
      .toMatch(/versionCode=2\b/);
    await apk.device.shell(`am force-stop ${APK_PKG}`);
    // The OS package record, not a mocked bridge response, establishes overwrite.
    expect(String(await apk.device.shell(`dumpsys package ${APK_PKG}`))).toContain('versionName=1.0.1');
  });
});
