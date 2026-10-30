package io.github.abccbaandy.pttchrome

import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Process-wide host owner; downloaded APKs and system request IDs survive process recreation. */
internal class ApkUpdater private constructor(private val context: Context) {
    private val platform = UpdateAndroidPlatform(context)
    private val installed = InstalledUpdateApp(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE.toLong(),
        context.packageName, android.os.Build.VERSION.SDK_INT)
    private val coordinator = UpdateCoordinator(installed, platform)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val checkingRequested = AtomicBoolean(false)

    fun blocking() = coordinator.blocking()
    fun systemLanguage() = UpdateWire.systemLanguage(context)

    fun foreground(activity: Activity) {
        platform.activity = WeakReference(activity)
        platform.foreground = true
        scope.launch { coordinator.refresh() }
    }
    fun background() { platform.foreground = false }

    fun reconcile(onFinished: () -> Unit = {}) {
        scope.launch { try { coordinator.refresh() } finally { onFinished() } }
    }

    suspend fun handle(request: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        var failure: Exception? = null
        try {
            when (request.optString("action")) {
                "state" -> coordinator.refresh()
                "check" -> {
                    if (checkingRequested.compareAndSet(false, true)) {
                        val manual = request.optBoolean("manual", true)
                        scope.launch {
                            try { coordinator.check(manual, AppSettings(context).pageSource().isDev) }
                            finally { checkingRequested.set(false) }
                        }
                    }
                }
                "download" -> coordinator.download(request.optString("releaseId").takeIf { it.isNotEmpty() })
                "cancel" -> coordinator.cancel()
                "install" -> coordinator.install(request.optString("releaseId").takeIf { it.isNotEmpty() })
                "preferences" -> coordinator.preferences(request.getBoolean("automaticChecks"))
                "skip" -> coordinator.skip(request.getString("releaseId"))
                "later" -> coordinator.later()
                else -> error("Unknown update action.")
            }
        } catch (e: Exception) { coordinator.fail(e); failure = e }
        val state = UpdateWire.snapshot(coordinator.snapshot(), installed, context)
        if (checkingRequested.get() && !coordinator.blocking()) state.put("phase", "checking")
        JSONObject().put("id", request.optInt("id")).put("ok", failure == null).put("state", state).apply {
            failure?.let { put("error", it.message ?: "Update operation failed.") }
        }
    }

    companion object {
        @Volatile private var instance: ApkUpdater? = null
        fun get(context: Context): ApkUpdater = instance ?: synchronized(this) {
            instance ?: ApkUpdater(context.applicationContext).also { instance = it }
        }
    }
}

/** The system can deliver completion after the web view or app process has gone away. */
class UpdateDownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
        val pending = goAsync()
        ApkUpdater.get(context).reconcile { pending.finish() }
    }
}
