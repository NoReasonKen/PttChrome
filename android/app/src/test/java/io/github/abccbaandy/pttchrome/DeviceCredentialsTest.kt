package io.github.abccbaandy.pttchrome

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException

class DeviceCredentialsTest {
    private class MemoryState : DeviceCredentialStateStore {
        private var state = DeviceCredentialState()
        var failWrites = false
        override fun read() = state
        override fun write(value: DeviceCredentialState) {
            if (failWrites) throw IOException("Synthetic write failure")
            state = value
        }
    }

    private class TestCipher : LocalCredentialCipher {
        var readable = true
        override fun seal(value: PasswordManagerCredential, existing: Boolean) =
            SealedCredential(byteArrayOf(1), (value.user + "\n" + value.password).toByteArray())
        override fun open(value: SealedCredential): PasswordManagerCredential {
            if (!readable) throw IOException("Synthetic unavailable key")
            val (user, password) = value.ciphertext.toString(Charsets.UTF_8).split('\n', limit = 2)
            return PasswordManagerCredential(user, password)
        }
    }

    private fun emptyManager(outcome: PasswordSaveOutcome = PasswordSaveOutcome.SAVED) = PasswordManagerCredentials(
        object : PasswordPresenceStore {
            override fun read() = PasswordPresence()
            override fun write(presence: PasswordPresence) = true
        },
        retrieve = { null },
        save = { _, _ -> outcome },
    )

    @Test
    fun localSaveReopensWithoutCallingTheProvider() = runBlocking {
        val state = MemoryState()
        val manager = PasswordManagerCredentials(
            object : PasswordPresenceStore {
                override fun read() = PasswordPresence()
                override fun write(presence: PasswordPresence) = true
            },
            retrieve = { error("Local login must not retrieve from the provider") },
            save = { _, _ -> error("Local save must not invoke the provider") },
        )
        val first = DeviceCredentials(state, TestCipher(), manager)
        assertEquals(CredentialSource.LOCAL, first.status().source)
        first.save(CredentialSource.LOCAL, "synthetic-reader", "pttchrome:v1:JBSWY3DPEHPK3PXP:synthetic-password")

        val reopened = DeviceCredentials(state, TestCipher(), manager)
        assertEquals(PasswordPresence(true, true, true), reopened.status().local.presence)
        assertEquals(
            PasswordManagerCredential("synthetic-reader", "pttchrome:v1:JBSWY3DPEHPK3PXP:synthetic-password"),
            reopened.get().credential,
        )
    }

    @Test
    fun switchingDestinationsRetainsEachRecordAndEmptySavingOnlySelects() = runBlocking {
        val state = MemoryState()
        var provider: PasswordManagerCredential? = null
        var providerPresence = PasswordPresence()
        val manager = PasswordManagerCredentials(
            object : PasswordPresenceStore {
                override fun read() = providerPresence
                override fun write(presence: PasswordPresence): Boolean { providerPresence = presence; return true }
            },
            retrieve = { provider },
            save = { user, password ->
                provider = PasswordManagerCredential(user, password)
                PasswordSaveOutcome.SAVED
            },
        )
        val credentials = DeviceCredentials(state, TestCipher(), manager)
        credentials.save(CredentialSource.LOCAL, "local-reader", "local-password")
        credentials.save(CredentialSource.MANAGER, "manager-reader", "manager-password")
        assertEquals(CredentialSource.MANAGER, credentials.status().source)
        assertEquals(PasswordManagerCredential("manager-reader", "manager-password"), credentials.get().credential)
        credentials.save(CredentialSource.LOCAL, "", "")
        assertEquals(PasswordManagerCredential("local-reader", "local-password"), credentials.get().credential)
        credentials.save(CredentialSource.MANAGER, "", "")
        assertEquals(PasswordManagerCredential("manager-reader", "manager-password"), credentials.get().credential)
    }

    @Test
    fun initiallyEmptyLocalSelectionDoesNotEnrollCredentials() = runBlocking {
        val manager = PasswordManagerCredentials(
            object : PasswordPresenceStore {
                override fun read() = PasswordPresence()
                override fun write(presence: PasswordPresence) = true
            },
            retrieve = { error("An empty local destination must not fall back to the provider") },
            save = { _, _ -> error("Source-only saving must not write provider credentials") },
        )
        val credentials = DeviceCredentials(MemoryState(), TestCipher(), manager)
        assertEquals(PasswordPresence(), credentials.save(CredentialSource.LOCAL, "", "").presence)
        try {
            credentials.get()
            error("Empty local storage must not be a usable credential")
        } catch (error: CredentialStorageException) {
            assertEquals("missing", error.code)
        }
    }

    @Test
    fun unreadableLocalRecordIsVisibleAndCannotBeOverwrittenOrUsedAsFallback() = runBlocking {
        val state = MemoryState()
        val cipher = TestCipher()
        val credentials = DeviceCredentials(state, cipher, emptyManager())
        credentials.save(CredentialSource.LOCAL, "reader", "original")
        val original = state.read()
        cipher.readable = false

        assertEquals("unreadable", credentials.status().local.error)
        for (password in listOf("replacement", "")) {
            try {
                credentials.save(CredentialSource.LOCAL, if (password.isEmpty()) "" else "reader", password)
                error("An unreadable record must not be overwritten")
            } catch (failure: CredentialStorageException) {
                assertEquals("unreadable", failure.code)
            }
            assertEquals(original, state.read())
        }
        credentials.save(CredentialSource.MANAGER, "", "")
        assertEquals(CredentialSource.MANAGER, credentials.status().source)
        try {
            credentials.get()
            error("Missing provider credentials must not fall back to the retained local record")
        } catch (failure: CredentialStorageException) {
            assertEquals("missing", failure.code)
        }
    }

    @Test
    fun failedOrCancelledProviderSavingRetainsPriorSourceAndLocalData() = runBlocking {
        for (outcome in listOf(PasswordSaveOutcome.CANCELLED, PasswordSaveOutcome.FAILED)) {
            val state = MemoryState()
            val credentials = DeviceCredentials(state, TestCipher(), emptyManager(outcome))
            credentials.save(CredentialSource.LOCAL, "reader", "original")
            try {
                credentials.save(CredentialSource.MANAGER, "replacement", "provider-password")
                error("Provider failure must not report a saved source")
            } catch (failure: CredentialStorageException) {
                assertEquals(if (outcome == PasswordSaveOutcome.CANCELLED) "cancelled" else "failed", failure.code)
            }
            assertEquals(CredentialSource.LOCAL, credentials.status().source)
            assertEquals(PasswordManagerCredential("reader", "original"), credentials.get().credential)
        }
    }

    @Test
    fun persistenceFailureRetainsThePreviousCredentialAndSource() = runBlocking {
        val state = MemoryState()
        val credentials = DeviceCredentials(state, TestCipher(), emptyManager())
        credentials.save(CredentialSource.LOCAL, "reader", "original")
        state.failWrites = true
        try {
            credentials.save(CredentialSource.LOCAL, "reader", "replacement")
            error("A failed atomic write must not report success")
        } catch (failure: CredentialStorageException) {
            assertEquals("failed", failure.code)
        }
        assertEquals(PasswordManagerCredential("reader", "original"), credentials.get().credential)
    }

    @Test
    fun deletingLocalCredentialsRetainsTheSelectedProviderAndItsSavedEntry() = runBlocking {
        val state = MemoryState()
        var provider: PasswordManagerCredential? = null
        var providerPresence = PasswordPresence()
        val manager = PasswordManagerCredentials(
            object : PasswordPresenceStore {
                override fun read() = providerPresence
                override fun write(presence: PasswordPresence): Boolean { providerPresence = presence; return true }
            },
            retrieve = { provider },
            save = { user, password ->
                provider = PasswordManagerCredential(user, password)
                PasswordSaveOutcome.SAVED
            },
        )
        val credentials = DeviceCredentials(state, TestCipher(), manager)
        credentials.save(CredentialSource.LOCAL, "local-reader", "local-password")
        credentials.save(CredentialSource.MANAGER, "manager-reader", "manager-password")

        val result = credentials.deleteLocal()

        assertEquals(CredentialSource.MANAGER, result.source)
        assertEquals(PasswordPresence(), result.presence)
        val reopened = DeviceCredentials(state, TestCipher(), manager)
        assertEquals(CredentialSource.MANAGER, reopened.status().source)
        assertEquals(PasswordPresence(), reopened.status().local.presence)
        assertEquals(PasswordPresence(true, true, false), reopened.status().manager.presence)
        assertEquals(PasswordManagerCredential("manager-reader", "manager-password"), reopened.get().credential)
    }

    @Test
    fun deletingAnUnreadableLocalPayloadAllowsFreshEnrollmentWithoutProviderFallback() = runBlocking {
        val state = MemoryState()
        val cipher = TestCipher()
        val credentials = DeviceCredentials(state, cipher, emptyManager())
        credentials.save(CredentialSource.LOCAL, "reader", "original")
        cipher.readable = false
        assertEquals("unreadable", credentials.status().local.error)

        assertEquals(PasswordPresence(), credentials.deleteLocal().presence)
        assertEquals(CredentialSource.LOCAL, credentials.status().source)
        assertEquals(CredentialDestinationStatus(PasswordPresence()), credentials.status().local)
        try {
            credentials.get()
            error("Deleted local credentials must not remain usable")
        } catch (failure: CredentialStorageException) {
            assertEquals("missing", failure.code)
        }
        cipher.readable = true
        credentials.save(CredentialSource.LOCAL, "replacement-reader", "replacement-password")
        assertEquals(PasswordManagerCredential("replacement-reader", "replacement-password"), credentials.get().credential)
    }

    @Test
    fun failedDeletionPreservesTheSavedCredentialAndPresence() = runBlocking {
        val state = MemoryState()
        val credentials = DeviceCredentials(state, TestCipher(), emptyManager())
        credentials.save(CredentialSource.LOCAL, "reader", "original")
        state.failWrites = true

        try {
            credentials.deleteLocal()
            error("A failed deletion must not report success")
        } catch (failure: CredentialStorageException) {
            assertEquals("failed", failure.code)
        }
        assertEquals(CredentialSource.LOCAL, credentials.status().source)
        assertEquals(PasswordPresence(true, true, false), credentials.status().local.presence)
        assertEquals(PasswordManagerCredential("reader", "original"), credentials.get().credential)
    }

    @Test
    fun corruptStateDoesNotGuessAReplacementSelectionDuringDeletion() = runBlocking {
        val credentials = DeviceCredentials(
            object : DeviceCredentialStateStore {
                override fun read(): DeviceCredentialState = throw IOException("Synthetic corrupt record")
                override fun write(value: DeviceCredentialState) = error("A corrupt envelope must not reset selection")
            },
            TestCipher(),
            emptyManager(),
        )
        try {
            credentials.deleteLocal()
            error("A corrupt state must report failure")
        } catch (failure: CredentialStorageException) {
            assertEquals("unreadable", failure.code)
        }
    }
}
