package io.github.abccbaandy.pttchrome

import android.app.Activity
import android.app.DownloadManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

/** Android system adapters for the updater; no PTT session or web URL controls these destinations. */
internal class UpdateAndroidPlatform(private val context: Context) : UpdatePlatform {
    private val prefs = context.getSharedPreferences("apk_updates", Context.MODE_PRIVATE)
    private val downloads = context.getSystemService(DownloadManager::class.java)
    private val files = File(context.filesDir, "updates").apply { mkdirs() }
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS)
        .followSslRedirects(false).build()
    var activity = WeakReference<Activity>(null)
    @Volatile var foreground = false
    private val testOrigin: String get() = if (BuildConfig.DEBUG) BuildConfig.UPDATE_TEST_ORIGIN else ""

    override fun now() = System.currentTimeMillis()
    override fun load(): UpdateSaved = try {
        val raw = prefs.getString("state", null)
        if (raw == null) UpdateSaved() else UpdateWire.saved(JSONObject(raw))
    } catch (_: Exception) { UpdateSaved(error = "Stored update information was invalid; check again.") }

    override fun save(value: UpdateSaved) {
        check(prefs.edit().putString("state", UpdateWire.saved(value).toString()).commit()) {
            "Could not save update state."
        }
    }

    private fun readJson(url: String): JSONObject {
        val request = Request.Builder().url(url).header("Accept", "application/vnd.github+json")
            .header("User-Agent", "PttChrome-Fork-Updater").build()
        return http.newCall(request).execute().use { response ->
            require(response.isSuccessful) { "Update check unavailable (HTTP ${response.code})." }
            val body = response.body
            val bytes = body.byteStream().use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(out.size() + count <= 256 * 1024) { "The update response was too large." }
                    out.write(buffer, 0, count)
                }
                out.toByteArray()
            }
            JSONObject(bytes.toString(Charsets.UTF_8))
        }
    }

    override fun latest(): UpdateRelease {
        val release = readJson(if (testOrigin.isEmpty())
            "https://api.github.com/repos/NoReasonKen/PttChrome/releases/latest" else "$testOrigin/release.json")
        require(!release.getBoolean("draft") && !release.getBoolean("prerelease")) { "Only stable releases are supported." }
        val tag = release.getString("tag_name")
        require(Regex("android-fork-v[0-9]+\\.[0-9]+\\.[0-9]+").matches(tag)) { "The release tag is invalid." }
        val base = if (testOrigin.isEmpty()) "https://github.com/NoReasonKen/PttChrome/releases/download/$tag" else testOrigin
        val assets = release.getJSONArray("assets")
        fun asset(name: String): JSONObject = (0 until assets.length()).map { assets.getJSONObject(it) }
            .singleOrNull { it.optString("name") == name } ?: error("Release asset $name is unavailable.")
        require(asset("update.json").getString("browser_download_url") == "$base/update.json") {
            "The update information is from an unexpected source."
        }
        val metadata = readJson("$base/update.json")
        val result = UpdateWire.release(metadata)
        require(result.id == tag && result.version == tag.removePrefix("android-fork-v")) { "Release identity does not match." }
        require(result.url == "$base/pttchrome.apk" && asset("pttchrome.apk").getString("browser_download_url") == result.url) {
            "The APK is from an unexpected source."
        }
        require(asset("pttchrome.apk").getLong("size") == result.size) { "Release APK size does not match." }
        return result
    }

    override fun enqueue(release: UpdateRelease): Long {
        val destination = File(context.getExternalFilesDir(null) ?: error("Download storage is unavailable."), "update-${release.versionCode}.apk")
        check(!destination.exists() || destination.delete()) { "Could not clear the previous partial download." }
        val request = DownloadManager.Request(Uri.parse(release.url))
            .setTitle("PttChrome Fork ${release.version}")
            .setDescription("Downloading app update")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedOverMetered(true).setAllowedOverRoaming(true)
            .setDestinationUri(Uri.fromFile(destination))
        return downloads.enqueue(request)
    }

    override fun query(id: Long): UpdateTransfer {
        downloads.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
            if (cursor == null || !cursor.moveToFirst()) return UpdateTransfer("missing", 0, 0,
                "The system download is no longer available. Tap Retry to try again.")
            fun number(column: String) = cursor.getLong(cursor.getColumnIndexOrThrow(column))
            val status = when (number(DownloadManager.COLUMN_STATUS).toInt()) {
                DownloadManager.STATUS_SUCCESSFUL -> "complete"
                DownloadManager.STATUS_FAILED -> "failed"
                DownloadManager.STATUS_PAUSED -> "paused"
                else -> "running"
            }
            val reason = if (status == "failed") "Download failed (system reason ${number(DownloadManager.COLUMN_REASON)}). Tap Retry to try again." else null
            return UpdateTransfer(status, number(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR).coerceAtLeast(0),
                number(DownloadManager.COLUMN_TOTAL_SIZE_BYTES).coerceAtLeast(0), reason)
        }
    }

    override fun retainVerified(id: Long, release: UpdateRelease): String {
        val token = "verified-$id.apk"
        val destination = retainedFile(token)
        val partial = File(files, "$token.partial")
        try {
            downloads.openDownloadedFile(id).use { descriptor ->
                android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
                    partial.outputStream().use { output ->
                        val buffer = ByteArray(32 * 1024)
                        var copied = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            copied += count
                            require(copied <= release.size) { "Downloaded APK exceeds its expected size." }
                            output.write(buffer, 0, count)
                        }
                    }
                }
            }
            verifyArchive(partial, release)
            check(partial.renameTo(destination)) { "Could not retain the verified APK." }
            return token
        } catch (e: Exception) { partial.delete(); throw e }
    }

    override fun removeDownload(id: Long) {
        try { downloads.remove(id) } catch (_: Exception) { /* A missing system record is already canceled. */ }
    }
    override fun removeFile(file: String) { retainedFile(file).delete() }
    override fun verifyRetained(file: String, release: UpdateRelease) = verifyArchive(retainedFile(file), release)

    private fun retainedFile(token: String): File {
        require(Regex("verified-[0-9]+\\.apk").matches(token)) { "The retained APK reference is invalid." }
        return File(files, token)
    }

    @Suppress("DEPRECATION")
    private fun packageInfo(path: String? = null): PackageInfo {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        return if (path == null) context.packageManager.getPackageInfo(context.packageName, flags)
        else context.packageManager.getPackageArchiveInfo(path, flags) ?: error("The downloaded file is not a valid APK.")
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures?.map { digest(it.toByteArray()) }?.toSet().orEmpty()
    }

    @Suppress("DEPRECATION")
    private fun verifyArchive(file: File, release: UpdateRelease) {
        require(file.isFile && file.length() == release.size) { "The APK is incomplete or unavailable." }
        val hash = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(32 * 1024)
            while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) }
        }
        require(hex(hash.digest()) == release.sha256) { "The APK integrity check failed." }
        val archive = packageInfo(file.absolutePath)
        require(archive.packageName == context.packageName && archive.packageName == release.packageName) { "The APK is for a different app." }
        val version = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        require(version == release.versionCode && version > BuildConfig.VERSION_CODE) { "The APK version is not a newer expected version." }
        require(archive.versionName == release.version) { "The APK version name does not match the release." }
        require(archive.applicationInfo?.minSdkVersion == release.minSdk && release.minSdk <= Build.VERSION.SDK_INT) {
            "The APK requires an incompatible Android version."
        }
        val expected = signers(packageInfo())
        require(expected.isNotEmpty() && signers(archive) == expected) { "The APK signing certificate does not match this app." }
        java.util.zip.ZipFile(file).use { zip ->
            val nativeAbis = zip.entries().asSequence().map { it.name }.filter { it.startsWith("lib/") && it.endsWith(".so") }
                .map { it.split('/').getOrNull(1) }.filterNotNull().toSet()
            require(nativeAbis.isEmpty() || nativeAbis.any { it in Build.SUPPORTED_ABIS }) { "The APK does not support this device's processor." }
        }
    }

    @Volatile var awaitingInstallPermission = false

    fun consumeInstallPermissionReturn(): Boolean {
        val pending = awaitingInstallPermission
        awaitingInstallPermission = false
        return pending && context.packageManager.canRequestPackageInstalls()
    }

    override fun install(file: String, release: UpdateRelease) {
        val host = activity.get() ?: error("Open the app before installing the update.")
        onMain {
            check(!host.isFinishing && !host.isDestroyed) { "Open the app before installing the update." }
            if (!context.packageManager.canRequestPackageInstalls()) {
                awaitingInstallPermission = true
                host.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
                error("Allow PttChrome Fork to install updates, then return to continue installation.")
            }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", retainedFile(file))
            host.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }
    }

    private fun onMain(block: () -> Unit) {
        val done = CountDownLatch(1)
        var failure: Exception? = null
        Handler(Looper.getMainLooper()).post {
            try { block() } catch (e: Exception) { failure = e } finally { done.countDown() }
        }
        check(done.await(5, TimeUnit.SECONDS)) { "The installer could not be opened. Try again." }
        failure?.let { throw it }
    }

    override fun notifyReady(release: UpdateRelease) {
        if (foreground) return
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(NotificationChannel("apk_updates", "App updates", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 71,
            Intent(context, MainActivity::class.java).putExtra("open_update", true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val chinese = UpdateWire.systemLanguage(context).substringBefore('-').equals("zh", true)
        val notice = Notification.Builder(context, "apk_updates").setSmallIcon(R.drawable.ic_stat_terminal)
            .setContentTitle(if (chinese) "PttChrome 更新已下載" else "PttChrome update downloaded")
            .setContentText(if (chinese) "${release.version} 已驗證，點此選擇安裝時間" else "${release.version} is verified. Tap to choose when to install.")
            .setContentIntent(open).setAutoCancel(true).build()
        try { manager.notify(71, notice) } catch (_: SecurityException) { }
    }

    private fun digest(bytes: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
}

/** JSON is confined to the host boundary; the coordinator and its tests use value objects. */
internal object UpdateWire {
    fun systemLanguage(context: Context): String =
        androidx.core.app.LocaleManagerCompat.getSystemLocales(context)[0]?.toLanguageTag() ?: "en"

    fun release(raw: JSONObject): UpdateRelease {
        require(raw.getInt("schemaVersion") == 1) { "Unsupported update metadata format." }
        val apk = raw.getJSONObject("apk")
        val summary = raw.getJSONObject("summary")
        fun lines(key: String): List<String> {
            val array = summary.getJSONArray(key)
            require(array.length() in 1..100) { "Release summary is unavailable." }
            return (0 until array.length()).map { array.getString(it).also { line -> require(line.isNotBlank() && line.length <= 2000) } }
        }
        val release = UpdateRelease(raw.getString("tag"), raw.getString("version"), raw.getString("sourceCommit"),
            raw.getLong("versionCode"), raw.getString("packageName"), raw.getInt("minSdk"), raw.getLong("nativeVersionCode"),
            apk.getString("url"), apk.getString("sha256"), apk.getLong("size"), lines("zhTW"), lines("en"))
        require(Regex("android-fork-v[0-9]+\\.[0-9]+\\.[0-9]+").matches(release.id) && release.id == "android-fork-v${release.version}") { "Invalid release version." }
        require(Regex("[a-f0-9]{40}").matches(release.sourceCommit) && Regex("[a-f0-9]{64}").matches(release.sha256)) { "Invalid release integrity information." }
        require(release.versionCode > 0 && release.nativeVersionCode in 1..release.versionCode && release.minSdk > 0 && release.size in 1..(256L * 1024 * 1024)) {
            "Invalid release compatibility information."
        }
        return release
    }

    fun release(value: UpdateRelease): JSONObject = JSONObject().put("schemaVersion", 1)
        .put("id", value.id).put("tag", value.id).put("version", value.version).put("sourceCommit", value.sourceCommit)
        .put("versionCode", value.versionCode).put("packageName", value.packageName).put("minSdk", value.minSdk)
        .put("nativeVersionCode", value.nativeVersionCode)
        .put("apk", JSONObject().put("url", value.url).put("sha256", value.sha256).put("size", value.size))
        .put("summary", JSONObject().put("zhTW", JSONArray(value.chineseSummary)).put("en", JSONArray(value.englishSummary)))

    fun saved(raw: JSONObject): UpdateSaved {
        fun candidate(key: String) = raw.optJSONObject(key)?.let(::release)
        val file = raw.optString("file").takeIf { it.isNotEmpty() }
        require(file == null || Regex("verified-[0-9]+\\.apk").matches(file)) {
            "Invalid retained update reference."
        }
        return UpdateSaved(raw.optBoolean("automatic", true), raw.optLong("lastSuccess"), raw.optLong("lastFailure"),
            raw.optString("skipped").takeIf { it.isNotEmpty() }, raw.optString("error").takeIf { it.isNotEmpty() },
            candidate("candidate"), candidate("active"), raw.optLong("downloadId"), candidate("ready"),
            file)
    }

    fun saved(value: UpdateSaved): JSONObject = JSONObject().put("automatic", value.automatic)
        .put("lastSuccess", value.lastSuccess).put("lastFailure", value.lastFailure).put("skipped", value.skipped)
        .put("error", value.error).put("candidate", value.candidate?.let(::release)).put("active", value.active?.let(::release))
        .put("downloadId", value.downloadId).put("ready", value.ready?.let(::release)).put("file", value.file)

    fun snapshot(value: UpdateSnapshot, installed: InstalledUpdateApp, context: Context): JSONObject = JSONObject()
        .put("supported", true).put("phase", value.phase).put("installedVersion", installed.version)
        .put("installedVersionCode", installed.versionCode).put("systemLanguage", systemLanguage(context))
        .put("automaticChecks", value.saved.automatic).put("lastSuccessfulCheck", value.saved.lastSuccess)
        .put("lastError", value.saved.error ?: JSONObject.NULL).put("skippedVersion", value.saved.skipped ?: JSONObject.NULL)
        .put("needsNativeUpdate", value.needsNativeUpdate)
        .put("prompt", value.prompt && !AppSettings(context).pageSource().isDev)
        .put("release", value.release?.let(::release) ?: JSONObject.NULL)
        .put("latestRelease", value.latestRelease?.let(::release) ?: JSONObject.NULL)
        .put("progress", JSONObject().put("downloaded", value.downloaded).put("total", value.total))
}
