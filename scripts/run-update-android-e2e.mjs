// Opt-in real Android updater coverage. Invoke through the shared local queue.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), "pttchrome-updater-"));
const origin = "http://127.0.0.1:8126";
const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

try {
  for (const [name, version, code] of [["base", "1.0.0", "1"], ["target", "1.0.1", "2"]]) {
    run(gradle, ["--no-daemon", "--max-workers=1", ":app:assembleDebug"], {
      cwd: path.join(root, "android"),
      shell: process.platform === "win32",
      env: { ...process.env, ANDROID_UPDATE_TEST_ORIGIN: origin,
        ANDROID_VERSION_NAME: version, ANDROID_VERSION_CODE: code },
    });
    fs.copyFileSync(path.join(root, "android/app/build/outputs/apk/debug/app-debug.apk"),
      path.join(fixtures, `${name}.apk`));
  }
  run(process.execPath, ["scripts/run-android-e2e.mjs", "--no-build",
    "tests/e2e/android/app_updates.android.spec.js", "--workers=1", "--retries=0", ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, ANDROID_E2E_APK: path.join(fixtures, "base.apk"),
      ANDROID_UPDATE_TEST_APK: path.join(fixtures, "target.apk") },
  });
} finally {
  fs.rmSync(fixtures, { recursive: true, force: true });
}
