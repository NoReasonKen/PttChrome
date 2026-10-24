# Android App（`android/`）

Read this guide before Android installation, on-device acceptance testing,
APK/web updates or deployment, and changes to `android/**`,
`src/js/android_bridge.js`, `src/js/credential_store.js`, or `src/js/boot_site.js`.

For web changes in an existing APK, start with [development page sources](#debug-版並存與-dev-server-模式):
the APK loads an online reading page, so a local frontend commit or an
unchanged APK rebuild does not deliver unpublished web changes to the phone.
Before connecting a device, use `yarn doctor --android`; add `--web` to verify
desktop access to an already running development server. See the
[environment doctor](local-env-troubleshooting.md#environment-doctor) for scope.

## Fork distribution

This fork uses application ID `io.github.noreasonken.pttchrome` and the visible
name **PttChrome Fork**, independently of the upstream app. Its reading page is
`https://noreasonken.github.io/PttChrome/`; the native bridge and local proxy
accept that page's origin. The retained Kotlin namespace is an implementation
detail, not the installed app's identity.

Release preparation and independent Firebase provisioning are tracked in
[issue #6](https://github.com/NoReasonKen/PttChrome/issues/6). Upstream Firebase,
Google OAuth, and Digital Asset Links registrations described below do not
register this fork's new package, signing certificate, or website.

## Install and update

Install the signed APK from [this fork's releases](https://github.com/NoReasonKen/PttChrome/releases)
directly on the phone, allowing installation from the downloading browser when
Android asks. Keep the upstream app installed if needed. Export settings from
the old app and import them into the fork; saved credentials and login state
do not transfer automatically. Updates to this app require the same signing
key, the same application ID, and an increasing version code. Reading-page
updates are delivered separately through GitHub Pages.

The fork's Firebase project is `pttchrome-7fae4`. Its registered release Android
app is `1:1012243465943:android:e5d5527c79db53dffed292`, with package
`io.github.noreasonken.pttchrome` and the fixed release signing certificate.
The Android OAuth client and Firebase Web OAuth client were checked together
in the generated Android configuration. Debug installations need their own
package/certificate registration before Google sign-in can work.

Cloud sync is private initially. The maintainer can open
`https://noreasonken.github.io/PttChrome/#cloud-sync-setup`, then go to Settings
and Backup to sign in. The link reveals controls for the current page session
only. The initial maintainer account already has the administrator-granted
`cloudSync: true` custom claim. Other accounts require a separate administrator
grant and a fresh sign-in before they can sync. Normal users see local backup
controls without cloud sync. See
[private cloud access](pref-sync-firestore.md#private-access-in-this-fork).

For APK setup, open that link in the installed app. If Android sends it to the
browser, enable `noreasonken.github.io` in the app's system supported-link
settings, then reopen it. Browser and APK sign-in state are separate. Import
settings from the old app before the first sync; PTT credentials stay local
and must be entered again in the new app.

## 為什麼要有 APK
- 手機 Chrome 開網頁版，切到別的 App 幾秒後 WebSocket 被系統凍結／切斷。網頁端無解（瀏覽器分頁沒有前景服務）。
- APK ＝ WebView 殼載入**線上** GitHub Pages（`AppConfig.PAGE_URL`，網頁更新不必重裝）＋前景服務持有 PTT 連線。
- 附帶解掉 Origin 白名單：上游由原生 OkHttp 連，Origin 直接寫 `https://term.ptt.cc`（`docs/pttchrome-research.md`）。
- 原型來源：第三方 demo（loopback proxy＋前景服務，模擬器驗過背景 30 秒不斷線）。正式版修掉 demo 的兩個缺陷，見下方「不變量」1、2。

## 架構
```
WebView  https://noreasonken.github.io/PttChrome/
  ├─ window.__PTT_ANDROID__ = { version, site }     document-start script（只注入 PAGE_ORIGIN）
  ├─ window.PttAndroid                              WebMessageListener（只注入 PAGE_ORIGIN）
  └─ ws://127.0.0.1:<系統挑的 port>/bbs/<token>
        └─ ConnectionService（前景服務 specialUse）
             └─ LocalWebSocketProxy ── OkHttp wss://ws.ptt.cc/bbs（Origin: https://term.ptt.cc，ping 20s）
```
| 檔案 | 職責 |
|---|---|
| `android/app/src/main/java/.../MainActivity.kt` | WebView 設定、注入、返回鍵、檔案選擇、renderer 被回收時重建 |
| `.../ConnectionService.kt` | 前景服務＋通知（「中斷連線並關閉」） |
| `.../LocalWebSocketProxy.kt` | loopback 中繼（session 生命週期） |
| `.../WsProtocol.kt` | RFC 6455 握手／frame 純邏輯（JVM test 守護） |
| `.../CredentialBridge.kt` | Credential Manager：get/create password、雲端同步 Google 登入（ID token）／登出 |
| `.../FileSave.kt` | bridge `saveFile` 的檔名清理（存檔流程本身在 `MainActivity`） |
| `.../PageSource.kt` | 頁面來源（正式版／dev server）與 dev 網址白名單（JVM `PageSourceTest`） |
| `.../AppSettings.kt`／`SettingsActivity.kt` | APK 自己的設定（SharedPreferences，不經 pref_sync）＋原生設定頁（含 ptt.cc 連結預設開啟狀態） |
| `.../DeepLink.kt` | 外部連結（ptt.cc 文章／本站）→ 網頁 deep link fragment（JVM `DeepLinkTest`）；流程與 manifest 坑見 `docs/deep-link.md`「Android APK」 |
| `src/js/android_bridge.js` | 網頁端偵測＋request/reply（訊息合約在檔頭） |
| `src/js/credential_store.js` | 密碼管理員單一入口：`PasswordCredential` 或 bridge |
| `src/js/boot_site.js` | connect 優先序：`?site` > android > prefs proxy > default |

## 不變量（改之前先想清楚）
1. **連線位址只在讀取端覆寫，絕不寫進 prefs**：prefs 經 `pref_sync` 同步到桌機，寫進去桌機會連 127.0.0.1。demo 就是用 seed localStorage 的做法。守護 `tests/unit/boot_site.test.js`。
2. **Android WebView 沒有 `PasswordCredential`**：密碼管理員必須走原生 Credential Manager＋bridge。demo 在 APK 內「自動登入失效」就是這個原因。守護 `tests/unit/credential_store.test.js`、`auto_login_credentials.test.js`（Android 那組）。
3. **密碼字串原樣傳遞**：2FA 密鑰打包在網頁 `credential_pack.js`；原生不解析。Chrome 與 APK 格式相同，但目前**不共用同一筆**（見「密碼共用」節的 Play 限制）。
4. **bridge 與 proxy 都鎖 origin**：`addDocumentStartJavaScript`／`addWebMessageListener` 的 allowedOriginRules 只放**當前頁面來源**（`PageSource.origin`：正式版 `PAGE_ORIGIN`，或 App 設定的 dev server）；proxy 握手當下讀同一個值，同一時間只認一個。換來源＝重建 WebView（注入規則只能建立時給）。dev 網址白名單在 `PageSource.parseDevServer`：只收 http＋`localhost`／`127.0.0.1`，debug APK 另收私有 IPv4。不用 `addJavascriptInterface`（不分 origin）。
5. **proxy 路徑帶每次啟動的隨機 token**：127.0.0.1 本機任何 App 都連得到，沒有 token 就能拿它當 Origin 改寫跳板。token 必須完整經過 `siteToWsUrl`（多段路徑）——守護在 `boot_site.test.js`。
6. **不注入 telnet 指令保活**（demo 的 `IAC DO TIMING-MARK` 已拿掉：PTT 的回應會流進網頁 telnet parser）。保活靠 OkHttp ping。實機若驗出 NAT 逾時再議。
7. **背景不暫停 WebView**：不呼叫 `onPause()`／`pauseTimers()`；`setRendererPriorityPolicy(IMPORTANT, false)`。
8. **軟鍵盤不縮 WebView**：insets 只讓系統列／瀏海，IME 高度以 `pttandroid:ime` 事件交給網頁（`mobile_layout.keyboardInset` 的 `hostInset`）。縮 WebView＝layout resize ⇒ 改列數、重送 NAWS（`docs/mobile.md`）。
   系統列由原生 padding 讓掉且 insets `CONSUMED` ⇒ WebView 裡 `env(safe-area-inset-*)` 為 0，網頁的 safe-area 讓位（`App._readSafeInsets`，`index.html` viewport-fit=cover）不會重複。`guess`：未在 APK 實測 env 值。
9. **新視窗一律轉外部瀏覽器**：`setSupportMultipleWindows(true)`＋`onCreateWindow` 給不掛畫面的暫時 WebView，只取網址就丟。關掉多視窗時 `target=_blank` 會變本頁導航 ⇒ 網頁 `beforeunload` 先跳「離開這個網站？」。網頁端另在 APK 內停用 beforeunload 確認（`src/js/unload_guard.js`，守護 `tests/unit/unload_guard.test.js`）。
10. FGS 型別 `specialUse`（`dataSync` 在 Android 15 起每 24h 限 6h）。不上 Play，無 specialUse 審核問題。

## APK 內刻意關掉的網頁功能
- 設定「連線 → BBS proxy」：不生效，改顯示說明（`options_androidProxyNote`）。
- 連線失敗提示不做 Origin／proxy 診斷（`pttchrome.jsx` onClose：`isAndroidApp()` 時不給 `diagnose`）。
- Web Notification（WebView 沒有）：水球通知改走 bridge `notify` → `MessageNotifier.kt`（獨立頻道「水球」，使用者可在系統設定單獨關）。WebView 切到背景不一定有 blur ⇒ 網頁在 APK 每則都送（`App.onData` 閘門），**前景與否由原生判斷**（`Lifecycle.State.STARTED`），回到前景（`onStart`）把跳過的收掉。仍受網頁「水球通知」開關控制。守護：`android_bridge.test.js`、`background_notification.test.js`、`waterball_notify_gate.test.js`、JVM `MessageNotifierTest`。真機 `unknown`。

## 檔案下載（錄製檔／設定備份匯出）
- WebView 不處理 `a[download]`／`blob:` 下載：點了靜默無反應（原生端也讀不到 `blob:` 網址，裝 `DownloadListener` 沒用）。
- `util.js#downloadAsFile` 在 APK 走 bridge `saveFile`（`{ filename, mime, text }`）→ `MainActivity.saveFile` 開 SAF `ACTION_CREATE_DOCUMENT` 讓使用者選位置 → IO thread 寫 UTF-8 → Toast。免儲存權限。檔名經 `FileSave.kt#safeFileName`（JVM `FileSaveTest`）。
- 同時只一個（第二個回 `busy`）。舊版 APK 回 `unknown op`＝仍下載不了，需更新 APK。
- 守護：`tests/unit/download_as_file.test.js`。真機 `unknown`。

## 雲端同步 Google 登入
- Google 禁止 WebView 內 OAuth（`disallowed_useragent`）⇒ `signInWithPopup` 在 APK 必失敗。改走：網頁 `google_sign_in.js#authenticateGoogle`（`pref_sync.signIn` 預設）→ bridge `googleSignIn` → 原生 `GetSignInWithGoogleOption` 取 ID token → 網頁 `signInWithCredential`。Firestore／App Check 照舊在網頁端跑。登出另送 `googleSignOut`（`clearCredentialState`）。
- `serverClientId` ＝ Firebase Google provider 的 **Web** client（`firebase_config.js#GOOGLE_WEB_CLIENT_ID`，由網頁傳入，原生只驗形狀 `isGoogleWebClientId`）。查法：identitytoolkit admin `GET projects/<p>/defaultSupportedIdpConfigs/google.com` 的 `clientId`。
- Google Cloud must register the Android package and its signing SHA-1 in the
  same project as the Web OAuth client. This fork's release registration is
  `io.github.noreasonken.pttchrome` in project `pttchrome-7fae4`, Firebase Android
  app `1:1012243465943:android:e5d5527c79db53dffed292`. The fixed release
  certificate's SHA-1 and matching Android/Web OAuth clients have been checked
  in the generated Android configuration; on-device sign-in still needs fork
  acceptance testing. Missing registration produces a Credential Manager
  developer error (`error:'failed'`, logcat tag `PttCredentialBridge`).
- The debug package `io.github.noreasonken.pttchrome.debug` is not registered
  yet. Register it separately and add the debug signing certificate before
  testing Google sign-in. Each new debug key needs its own SHA-1 registration;
  inspect the certificate with `keytool -list -v -keystore <keystore>`.
- googleid 以 Kotlin 2.4 編譯，AGP 9 內建 KGP 2.2 讀不了 ⇒ 根 `build.gradle.kts` 以 `kotlin-android` plugin `apply false` 把 KGP 抬到 `libs.versions.toml#kotlin`。
- 守護：`tests/unit/google_sign_in.test.js`（選路）、`tests/integration/pref_sync.test.js`「Android APK sign-in」（emulator 真 `signInWithCredential`）、JVM `CredentialBridgeTest`。

## 密碼共用（Digital Asset Links）

The sideloaded fork keeps its saved PTT credentials separate from Chrome.
Google Password Manager's app/website credential association requires public
Google Play distribution; a GitHub APK does not establish that association.
The native settings explain this limitation through `settings_password_note`.

The fork's `asset_statements` references
`https://noreasonken.github.io/.well-known/assetlinks.json`, but that root file
has not been deployed. No Digital Asset Links verification is established for
this fork. Users can select supported link domains manually in Android's
default-opening settings; creating a root website is not required for the
first APK release.

Upstream reference only: `abccbaandy/abccbaandy.github.io` published statements
for `io.github.abccbaandy.pttchrome` and its debug package. The inherited
certificate comparisons and successful Digital Asset Links API checks apply
to those upstream identities, not this fork's package, certificate, or domain.

If website association is added later, serve the statements from the domain
root rather than `/PttChrome/`, using this fork's package and certificate
SHA-256. A later Play release must account for the Play App Signing certificate
and foreground-service requirements. Keep the fork's application ID and
release signing key stable so installed copies can receive APK updates.

## 建置
- 本機：需 JDK 17+（**完整 JDK**，只有 JRE 會 `No Java compiler found` 或 `Toolchain installation '<jre>' does not provide the required capabilities: [JAVA_COMPILER]`）＋ Android SDK（platform 37、build-tools 37）。
  - 判準：`"$JAVA_HOME/bin/javac" -version` 要成功。系統層 `JAVA_HOME` 指向 JRE 時，在**使用者層**設 `JAVA_HOME` 指向完整 JDK 覆蓋它；改完要重開 Claude 才生效，當下 session 先在指令前加 `JAVA_HOME=<jdk> ./gradlew ...`。
  - `local.properties` 的 `sdk.dir` 要跟 env `ANDROID_HOME` 一致（指到不存在的目錄＝`sdk.dir property ... Directory does not exist`）。
- 推到實機（無線 adb）：`adb mdns services` 找 `_adb-tls-connect` 的 `IP:port` → `adb connect <IP:port>`（已配對過就不需配對碼；沒配對過要手機「無線偵錯 → 以配對碼配對」後 `adb pair`）→ `adb -s <IP:port> install -r app/build/outputs/apk/debug/app-debug.apk`。
  - To test frontend changes in the app, run `yarn start --host` and
    `adb -s <IP:port> reverse tcp:8080 tcp:8080`, then enable dev-server mode.
    For automated setup, force-stop `io.github.noreasonken.pttchrome.debug`
    before using `run-as io.github.noreasonken.pttchrome.debug` to write
    `shared_prefs/app_settings.xml` with `dev_server_enabled=true` and
    `dev_server_url=http://localhost:8080/` (keys: `AppSettings.kt`). Only the
    debug APK supports `run-as`.
  `android/local.properties` 寫 `sdk.dir=`（gitignored）。新版 cmdline-tools 的 `sdkmanager` 已改為 `android sdk install platforms/android-37.0 build-tools/37.0.0`。
- `cd android && ./gradlew test assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`。
- JVM test：`WsProtocolTest`（握手／frame）、`LocalWebSocketProxyTest`（MockWebServer 當假 PTT：Origin 改寫、雙向轉送、token／Origin 拒絕、跟隨當前頁面 origin）、`PageSourceTest`（dev 網址白名單）。
- CI：`.github/workflows/android.yml`（`android/**` 變動才跑；不可設為 required check）。沒有簽章 secrets 時上傳 debug APK。CodeQL 的 java-kotlin 分析在 `codeql.yml`（會編譯 `:app:compileDebugKotlin`）。
- Windows 上新增 `gradlew` 要 `git update-index --chmod=+x android/gradlew`，否則 CI `Permission denied`。

## debug 版並存與 dev server 模式
- The debug build uses `applicationIdSuffix=".debug"`, package
  `io.github.noreasonken.pttchrome.debug`, and the name **PttChrome Fork Debug**.
  Its icon has a green background and yellow DEBUG label (`src/debug/res`);
  update that variant when changing the release icon. Debug and release apps
  coexist. The Kotlin namespace remains `io.github.abccbaandy.pttchrome` for
  both variants; it is not the installed application's identity.
- Debug Google sign-in is not configured in this fork yet. Create a Firebase
  Android app for the debug package in `pttchrome-7fae4`, then register its key:
  `firebase apps:android:sha:create <debug-app-id> <SHA-1> --project pttchrome-7fae4`.
  A different development machine's debug key needs another registration.
  Neither the upstream debug registration nor a release-package registration
  covers this package/key combination.
- App 設定（原生 `SettingsActivity`）→「載入電腦上的 dev server」：WebView 改載入 `yarn start`，改網頁不必推版。入口：網頁設定「連線」分頁的「App 設定」鈕（bridge `openAppSettings`）、長按 App 圖示的動態捷徑（不用靜態 `shortcuts.xml`：要寫死 targetPackage，跟 `.debug` 衝突）、載入失敗頁連結（`pttchrome-app://settings`／`use-production`）。
- 用法：電腦 `yarn start --host`（Windows vite 預設只綁 `[::1]`，adb reverse 連的是 127.0.0.1，同 `docs/android-e2e.md` 踩坑表）＋ `adb reverse tcp:8080 tcp:8080`，網址填 `http://localhost:8080/`。debug APK 也可直接填 `http://<電腦區網 IP>:8080/`。
- 正式版也有此模式，但只收 localhost：區網 IP 需要整個 App 放行明文（network_security_config 無法只放行 IP 範圍），只在 debug（`src/debug/res/xml/network_security_config.xml` base-config 放行）。main 的 config 放行 `127.0.0.1`＋`localhost`。
- 開著 dev 模式：通知標題顯示「開發模式：<origin>」、每次建 WebView 跳 Toast（正式版使用者不會忘了關）。dev 頁連 PTT 照樣走原生 proxy（`boot_site` 的 android 優先），密碼 bridge 同樣開放給 dev origin。

## Publication

Use a fixed encrypted PKCS#12 signing store and keep a private backup of both
the store and its password outside Git. Losing the key prevents normal updates
to an installed copy. Local builds may use gitignored `android/keystore.properties`
with `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`.

The repository's four signing secrets are `ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`.
Release tags fail when any signing input is missing. Non-release builds may
still produce debug artifacts without these secrets.

Push `android-v<version>` to build and verify the signed APK, then publish
`pttchrome.apk` and `LICENSE` in a GitHub Release with links to that tag's
complete corresponding source and installation instructions. `versionCode`
is the Android workflow's `github.run_number`; later updates must increase it.
Before the first release, verify that Pages serves the selected web revision
and that the fork's Google sign-in and Firestore/App Check registrations are
configured. A successful build does not establish device acceptance.

## 狀態

The table below preserves upstream implementation and device evidence inherited
with the source. Its `CONFIRMED` entries refer to the upstream app and backend;
they do not establish acceptance of this fork's APK, signing identity, or cloud
project. Fork on-device acceptance remains pending, including native Google
sign-in, preference sync, and WebView App Check.

| 項目 | 狀態 |
|---|---|
| JVM test（WsProtocol／proxy） | CONFIRMED |
| 真機：背景長時間不斷線 | `unknown`（demo 只在模擬器驗 30 秒） |
| 真機：https 頁連 `ws://127.0.0.1`（`MIXED_CONTENT_ALWAYS_ALLOW`） | `guess`（demo 同設定可連） |
| 真機：GPM 存密碼 | CONFIRMED（使用者實機：存成 `pttchrome.abccbaandy.github.io`） |
| GPM 與 Chrome 共用密碼 | 不共用（CONFIRMED 設定正確；需上 Play 公開管道，未做，見「密碼共用」） |
| 真機：dev server 模式／debug 並存 | `unknown`（JVM／build 綠，待實機） |
| 冷啟動黑畫面數秒 | 成因 CONFIRMED（實機 2026-10）：HTTP 快取未命中（清快取／Pages 新部署換 hash）時重抓主 JS 等 ~450KB，手機到 GitHub Pages 線路不穩（同檔 `curl` 0.6–5.2s；WebView 實測主 JS 9s）。有快取時快。連 PTT 非瓶頸（上游 open＋首筆資料 ~130ms）。網頁在主 JS＋轉碼表載完才 connect。診斷：`adb logcat -s PttChromeApp` 看 `boot:`（`BootTrace.kt`：pageStarted／CommitVisible／Finished、proxyAccept、upstreamOpen／FirstData，pageFinished 後 10s 印 Resource Timing）。對策：開站載入提示（`index.html#bootLoading`＋`src/js/boot_loading.js`，分段進度，零額外請求）。開站快取（`docs/open-cache.md`）的 SW 只快取帶 hash 的檔，網頁本身一律先問網路 ⇒ 更新一定拿得到（使用者的要求：HTTP 快取晚一點可以，保證先跑舊版不行；所以**不做** stale-while-revalidate 的 app shell）。斷線時才退回存的那份網頁。`BootTrace` 只在冷啟動／每次 ws session 各印數行，耗電可忽略（`docs/handoff/android-battery-drain.md`：主成本是前景出幀） |
| 回前景黑畫面數秒 | 成因 CONFIRMED 非回收（使用者實測：恢復後停在原畫面）＝renderer 活著但出幀慢。對策 `offscreenPreRaster`＋PixelCopy 快照遮罩（`MainActivity` onPause 拍／onStart 蓋／visual state callback 後掀，上限 5s），效果 `unknown` 待實機；`adb logcat -s PttChromeApp` 看 `away=`／`firstFrame=`。真回收會跳 Toast |
| 真機：雲端同步 Google 登入 | CONFIRMED（2026-10 實機：原生帳戶選單登入、雲端設定還原） |
| 真機：App Check（reCAPTCHA Enterprise）在 WebView 拿得到 token | CONFIRMED（同上：Firestore 讀寫成功） |
| renderer 被系統回收 | 重建 WebView 重新連線，登入後回到原處：`onStop` 發 `pttandroid:stop` ⇒ `reconnect_resume.saveSnapshot` 把「斷線的話要回哪」存進 localStorage（`SNAPSHOT_KEY`）；重建時 config 帶 `restored: true`（`onRenderProcessGone`，以及 process 被砍、系統還原時的 `savedInstanceState`）⇒ 開機接回、登入回主功能表後照斷線重連那條出發。不是重建的開機一律丟掉存檔；12 小時以上不接；pref `reconnectResume` 關掉不存不接。守護 `reconnect_resume_renderer.test.js`。真機 `unknown`。未來可做「上游保留＋重接後 Ctrl+L」 |
