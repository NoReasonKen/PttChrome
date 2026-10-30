package io.github.abccbaandy.pttchrome

internal data class InstalledUpdateApp(val version: String, val versionCode: Long,
    val packageName: String, val sdk: Int)

internal data class UpdateRelease(val id: String, val version: String, val sourceCommit: String,
    val versionCode: Long, val packageName: String, val minSdk: Int, val nativeVersionCode: Long,
    val url: String, val sha256: String, val size: Long,
    val chineseSummary: List<String>, val englishSummary: List<String>)

internal data class UpdateTransfer(val status: String, val downloaded: Long, val total: Long,
    val error: String? = null)

internal data class UpdateSaved(val automatic: Boolean = true, val lastSuccess: Long = 0,
    val lastFailure: Long = 0, val skipped: String? = null, val error: String? = null,
    val candidate: UpdateRelease? = null, val active: UpdateRelease? = null,
    val downloadId: Long = 0, val ready: UpdateRelease? = null, val file: String? = null)

internal data class UpdateSnapshot(val phase: String, val release: UpdateRelease?,
    val latestRelease: UpdateRelease?, val needsNativeUpdate: Boolean, val prompt: Boolean,
    val saved: UpdateSaved, val downloaded: Long, val total: Long)

/** The platform boundary owns HTTP, persistent storage, DownloadManager and package installation. */
internal interface UpdatePlatform {
    fun now(): Long
    fun load(): UpdateSaved
    fun save(value: UpdateSaved)
    fun latest(): UpdateRelease
    fun enqueue(release: UpdateRelease): Long
    fun query(id: Long): UpdateTransfer
    fun retainVerified(id: Long, release: UpdateRelease): String
    fun removeDownload(id: Long)
    fun removeFile(file: String)
    fun verifyRetained(file: String, release: UpdateRelease)
    fun install(file: String, release: UpdateRelease)
    fun notifyReady(release: UpdateRelease)
}

/** Public update actions share one durable state, independent of any About view or Activity. */
internal class UpdateCoordinator(private val installed: InstalledUpdateApp,
    private val platform: UpdatePlatform) {
    private val lock = Any()
    private var saved = platform.load()
    private var checking = false
    private var verifying = false
    private var generation = 0L
    private var later: String? = null
    private var transfer = UpdateTransfer("running", 0, 0)
    private var retainedChecked = false
    private var developmentPage = false

    init {
        if ((saved.ready == null) != (saved.file == null)) {
            saved.file?.let(platform::removeFile)
            change(saved.copy(ready = null, file = null, error = "Incomplete retained update state was cleared."))
        }
        if (saved.ready != null && saved.ready!!.versionCode <= installed.versionCode) {
            saved.file?.let(platform::removeFile)
            change(saved.copy(ready = null, file = null))
        }
        if ((saved.active == null) != (saved.downloadId == 0L)) {
            if (saved.downloadId != 0L) platform.removeDownload(saved.downloadId)
            change(saved.copy(active = null, downloadId = 0, error = "Incomplete download state was cleared."))
        }
    }

    private fun change(value: UpdateSaved) { saved = value; platform.save(value) }
    private fun eligible(release: UpdateRelease) = release.versionCode > installed.versionCode &&
        release.packageName == installed.packageName && release.minSdk <= installed.sdk

    fun snapshot(): UpdateSnapshot = synchronized(lock) {
        val phase = when {
            verifying -> "verifying"
            saved.active != null -> if (transfer.status == "paused") "paused" else "downloading"
            checking -> "checking"
            saved.ready != null && saved.file != null -> "ready"
            saved.error != null -> "error"
            saved.candidate?.let(::eligible) == true -> "available"
            else -> "idle"
        }
        val visible = saved.active ?: saved.ready ?: saved.candidate?.takeIf(::eligible)
        val relevant = saved.candidate?.let { eligible(it) && installed.versionCode < it.nativeVersionCode } == true
        UpdateSnapshot(phase, visible, saved.candidate, relevant,
            phase == "available" && relevant && saved.automatic && !developmentPage &&
                saved.candidate?.id != saved.skipped && saved.candidate?.id != later,
            saved, transfer.downloaded, transfer.total)
    }

    fun check(manual: Boolean, development: Boolean) {
        synchronized(lock) {
            developmentPage = development
            if (checking || saved.active != null || !UpdatePolicy.checkDue(platform.now(), saved.lastSuccess,
                    saved.lastFailure, saved.automatic, development, manual)) return
            checking = true
        }
        try {
            val latest = platform.latest()
            require(latest.packageName == installed.packageName) { "This release is for a different app package." }
            require(latest.minSdk <= installed.sdk) { "This update requires a newer Android version." }
            synchronized(lock) {
                change(saved.copy(candidate = latest, lastSuccess = platform.now(), lastFailure = 0, error = null))
            }
        } catch (e: Exception) {
            synchronized(lock) { change(saved.copy(lastFailure = platform.now(), error = message(e))) }
        } finally { synchronized(lock) { checking = false } }
    }

    fun preferences(automatic: Boolean) = synchronized(lock) { change(saved.copy(automatic = automatic)) }
    fun skip(id: String) = synchronized(lock) {
        require(id == saved.candidate?.id) { "The update changed; check it again." }
        change(saved.copy(skipped = id))
    }
    fun later() = synchronized(lock) { later = saved.candidate?.id }
    fun blocking(): Boolean = synchronized(lock) { saved.active != null || verifying }

    fun download(id: String?) = synchronized(lock) {
        check(saved.active == null && !verifying && !checking) { "An update operation is already running." }
        val release = saved.candidate ?: error("Check for an update first.")
        require(id == null || id == release.id) { "The update changed; check it again." }
        require(eligible(release)) { "No compatible newer APK is available." }
        val request = platform.enqueue(release)
        generation++
        transfer = UpdateTransfer("running", 0, release.size)
        change(saved.copy(active = release, downloadId = request, error = null))
    }

    fun cancel() = synchronized(lock) {
        val id = saved.downloadId
        generation++
        verifying = false
        change(saved.copy(active = null, downloadId = 0, error = null))
        if (id != 0L) platform.removeDownload(id)
    }

    fun refresh() {
        val work: Triple<Long, UpdateRelease, Long>? = synchronized(lock) {
            val id = saved.downloadId
            val release = saved.active
            if (release == null || id == 0L || verifying) return@synchronized null
            try {
                transfer = platform.query(id)
                when (transfer.status) {
                    "complete" -> { verifying = true; Triple(id, release, generation) }
                    "failed", "missing" -> {
                        platform.removeDownload(id)
                        change(saved.copy(active = null, downloadId = 0,
                            error = transfer.error ?: "The download failed. Tap Retry to try again."))
                        null
                    }
                    else -> null
                }
            } catch (e: Exception) {
                change(saved.copy(active = null, downloadId = 0, error = message(e)))
                platform.removeDownload(id)
                null
            }
        }
        if (work != null) {
            val (id, release, token) = work
            try {
                val file = platform.retainVerified(id, release)
                synchronized(lock) {
                    if (generation != token || saved.downloadId != id) {
                        platform.removeFile(file)
                    } else {
                        saved.file?.takeIf { it != file }?.let(platform::removeFile)
                        change(saved.copy(active = null, downloadId = 0, ready = release, file = file, error = null))
                        retainedChecked = true
                        platform.notifyReady(release)
                    }
                }
            } catch (e: Exception) {
                synchronized(lock) {
                    if (generation == token && saved.downloadId == id)
                        change(saved.copy(active = null, downloadId = 0, error = message(e)))
                }
            } finally {
                platform.removeDownload(id)
                synchronized(lock) { if (generation == token) verifying = false }
            }
        }
        synchronized(lock) {
            if (!retainedChecked && saved.ready != null && saved.file != null) {
                retainedChecked = true
                try { platform.verifyRetained(saved.file!!, saved.ready!!) }
                catch (e: Exception) {
                    platform.removeFile(saved.file!!)
                    change(saved.copy(ready = null, file = null, error = message(e)))
                }
            }
        }
    }

    fun install(id: String?) {
        val (release, file, token) = synchronized(lock) {
            check(saved.active == null && !verifying) { "Wait for the download to finish." }
            val release = saved.ready ?: error("Download and verify the APK first.")
            val file = saved.file ?: error("The downloaded APK is unavailable.")
            require(id == null || id == release.id) { "The selected APK is not the retained update." }
            verifying = true
            Triple(release, file, generation)
        }
        try {
            platform.verifyRetained(file, release)
        } catch (e: Exception) {
            synchronized(lock) {
                if (generation == token) {
                    verifying = false
                    platform.removeFile(file)
                    change(saved.copy(ready = null, file = null, error = message(e)))
                }
            }
            throw e
        }
        synchronized(lock) {
            if (generation != token) return
            verifying = false
        }
        // The Android adapter awaits a main-thread installer handoff. Never hold
        // the state monitor here: the main thread also reads the Back-key guard.
        try {
            platform.install(file, release)
            synchronized(lock) { if (generation == token) change(saved.copy(error = null)) }
        } catch (e: Exception) {
            synchronized(lock) { if (generation == token) change(saved.copy(error = message(e))) }
            throw e
        }
    }

    fun fail(e: Exception) = synchronized(lock) { change(saved.copy(error = message(e))) }
    private fun message(e: Exception) = e.message?.take(300) ?: "The update operation failed."
}
