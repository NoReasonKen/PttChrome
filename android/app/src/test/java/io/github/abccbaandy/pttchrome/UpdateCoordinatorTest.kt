package io.github.abccbaandy.pttchrome

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class UpdateCoordinatorTest {
    private val release = UpdateRelease("android-fork-v0.4.0", "0.4.0", "a".repeat(40), 8,
        "io.github.noreasonken.pttchrome", 26, 7,
        "https://github.com/NoReasonKen/PttChrome/releases/download/android-fork-v0.4.0/pttchrome.apk",
        "0".repeat(64), 1024, listOf("閱讀改善"), listOf("Reading improvements"))

    @Test fun aUserCanDownloadVerifyAndInstallAMissedNativeUpdate() {
        val platform = TestPlatform(release)
        val updater = UpdateCoordinator(InstalledUpdateApp("0.2.0", 4,
            "io.github.noreasonken.pttchrome", 34), platform)
        updater.check(manual = true, development = false)
        assertTrue(updater.snapshot().needsNativeUpdate)
        updater.download(release.id)
        assertEquals("downloading", updater.snapshot().phase)
        platform.transfer = UpdateTransfer("complete", 1024, 1024)
        updater.refresh()
        assertEquals("ready", updater.snapshot().phase)
        updater.install(release.id)
        assertEquals("verified-package", platform.installedFile)
    }

    @Test fun anInstalledReleaseIsNotOfferedForDownload() {
        val updater = UpdateCoordinator(InstalledUpdateApp("0.4.0", 8,
            "io.github.noreasonken.pttchrome", 34), TestPlatform(release))
        updater.check(manual = true, development = false)
        assertEquals("idle", updater.snapshot().phase)
        assertNull(updater.snapshot().release)
        assertEquals("0.4.0", updater.snapshot().latestRelease?.version)
    }

    @Test fun aRetainedApkThatNoLongerPassesVerificationCanBeDownloadedAgain() {
        val platform = TestPlatform(release)
        val updater = updater(platform)
        updater.check(true, false)
        updater.download(release.id)
        platform.transfer = UpdateTransfer("complete", 1024, 1024)
        updater.refresh()
        platform.invalidFile = true
        assertThrows(IllegalArgumentException::class.java) { updater.install(release.id) }
        assertEquals("error", updater.snapshot().phase)
        platform.invalidFile = false
        updater.download(release.id)
        assertEquals("downloading", updater.snapshot().phase)
    }

    @Test fun skippingSurvivesRecreationWhileManualDownloadRemainsPossible() {
        val platform = TestPlatform(release)
        val first = updater(platform)
        first.check(true, false)
        first.skip(release.id)
        val reopened = updater(platform)
        assertFalse(reopened.snapshot().prompt)
        reopened.download(release.id)
        assertTrue(reopened.blocking())
    }

    @Test fun cancelingAnActiveDownloadDoesNotRemoveAnOlderVerifiedApk() {
        val platform = TestPlatform(release)
        val updater = updater(platform)
        updater.check(true, false)
        updater.download(release.id)
        platform.transfer = UpdateTransfer("complete", 1024, 1024)
        updater.refresh()
        updater.download(release.id)
        updater.cancel()
        assertFalse(updater.blocking())
        assertEquals("ready", updater.snapshot().phase)
        updater.install(release.id)
        assertEquals("verified-package", platform.installedFile)
    }

    @Test fun aFailedDownloadUnblocksTheAppAndRequiresAnExplicitRetry() {
        val platform = TestPlatform(release)
        val updater = updater(platform)
        updater.check(true, false)
        updater.download(release.id)
        platform.transfer = UpdateTransfer("failed", 100, 1024, "Network failed")
        updater.refresh()
        assertFalse(updater.blocking())
        assertEquals("error", updater.snapshot().phase)
        updater.refresh()
        assertEquals("error", updater.snapshot().phase)
        updater.download(release.id)
        assertTrue(updater.blocking())
    }

    @Test fun manualChecksInDevelopmentModeDoNotCreateProactivePrompts() {
        val updater = updater(TestPlatform(release))
        updater.check(true, true)
        assertEquals("available", updater.snapshot().phase)
        assertFalse(updater.snapshot().prompt)
    }

    @Test fun systemOwnedDownloadsCanBeReconciledAfterTheUiOwnerIsRecreated() {
        val platform = TestPlatform(release)
        val first = updater(platform)
        first.check(true, false)
        first.download(release.id)
        val reopened = updater(platform)
        assertTrue(reopened.blocking())
        platform.transfer = UpdateTransfer("complete", 1024, 1024)
        reopened.refresh()
        assertEquals("ready", reopened.snapshot().phase)
        reopened.install(release.id)
        assertEquals("verified-package", platform.installedFile)
    }

    @Test fun cancellationDuringVerificationCannotOfferTheCanceledFileForInstall() {
        val platform = TestPlatform(release)
        val updater = updater(platform)
        updater.check(true, false)
        updater.download(release.id)
        platform.transfer = UpdateTransfer("complete", 1024, 1024)
        platform.beforeRetain = { updater.cancel() }
        updater.refresh()
        assertFalse(updater.blocking())
        assertEquals("available", updater.snapshot().phase)
        assertThrows(IllegalStateException::class.java) { updater.install(release.id) }
    }

    private fun updater(platform: TestPlatform) = UpdateCoordinator(
        InstalledUpdateApp("0.2.0", 4, "io.github.noreasonken.pttchrome", 34), platform)

    private class TestPlatform(private val latest: UpdateRelease) : UpdatePlatform {
        var transfer = UpdateTransfer("running", 0, 1024)
        var installedFile: String? = null
        var invalidFile = false
        var beforeRetain: (() -> Unit)? = null
        private var saved = UpdateSaved()
        override fun now() = 100_000_000L
        override fun load() = saved
        override fun save(value: UpdateSaved) { saved = value }
        override fun latest() = latest
        override fun enqueue(release: UpdateRelease) = 42L
        override fun query(id: Long) = transfer
        override fun retainVerified(id: Long, release: UpdateRelease): String {
            beforeRetain?.invoke()
            return "verified-package"
        }
        override fun removeDownload(id: Long) {}
        override fun removeFile(file: String) {}
        override fun verifyRetained(file: String, release: UpdateRelease) {
            require(!invalidFile) { "The APK integrity check failed." }
        }
        override fun install(file: String, release: UpdateRelease) { installedFile = file }
        override fun notifyReady(release: UpdateRelease) {}
    }
}
