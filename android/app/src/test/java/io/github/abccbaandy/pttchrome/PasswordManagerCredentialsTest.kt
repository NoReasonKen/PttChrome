package io.github.abccbaandy.pttchrome

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PasswordManagerCredentialsTest {
    private class MemoryPresence : PasswordPresenceStore {
        private var value = PasswordPresence()
        override fun read() = value
        override fun write(presence: PasswordPresence): Boolean { value = presence; return true }
    }

    @Test
    fun statusDoesNotRetrieveCredentialsAndSurvivesAnotherWorkflowInstance() = runBlocking {
        val presence = MemoryPresence()
        val credentials = PasswordManagerCredentials(
            presence,
            retrieve = { error("Status must not query the provider") },
            save = { _, _ -> PasswordSaveOutcome.SAVED },
        )

        assertEquals(PasswordPresence(), credentials.status())
        assertEquals(PasswordSaveOutcome.SAVED, credentials.save("reader", "pttchrome:v1:JBSWY3DPEHPK3PXP:synthetic"))
        val reopened = PasswordManagerCredentials(
            presence,
            retrieve = { error("Reopening settings must not query the provider") },
            save = { _, _ -> error("Reopening settings must not store credentials") },
        )
        assertEquals(PasswordPresence(true, true, true), reopened.status())
    }

    @Test
    fun cancelledOrFailedReplacementPreservesTheLastConfirmedPresence() = runBlocking {
        for (outcome in listOf(PasswordSaveOutcome.CANCELLED, PasswordSaveOutcome.FAILED)) {
            val presence = MemoryPresence().apply { write(PasswordPresence(true, true, true)) }
            val credentials = PasswordManagerCredentials(
                presence, retrieve = { null }, save = { _, _ -> outcome },
            )

            assertEquals(outcome, credentials.save("replacement", "password-only"))
            assertEquals(PasswordPresence(true, true, true), credentials.status())
        }
    }

    @Test
    fun savingPasswordOnlyReplacesOptionalSecretPresence() = runBlocking {
        val presence = MemoryPresence().apply { write(PasswordPresence(true, true, true)) }
        val credentials = PasswordManagerCredentials(
            presence, retrieve = { null }, save = { _, _ -> PasswordSaveOutcome.SAVED },
        )

        assertEquals(PasswordSaveOutcome.SAVED, credentials.save("reader", "password-only"))
        assertEquals(PasswordPresence(true, true, false), credentials.status())
    }

    @Test
    fun incompleteSaveDoesNotReachTheProviderOrChangePresence() = runBlocking {
        val credentials = PasswordManagerCredentials(
            MemoryPresence(), retrieve = { null }, save = { _, _ -> error("Incomplete replacement") },
        )

        assertEquals(PasswordSaveOutcome.FAILED, credentials.save("reader", ""))
        assertEquals(PasswordSaveOutcome.FAILED, credentials.save("", "synthetic"))
        assertEquals(PasswordPresence(), credentials.status())
    }

    @Test
    fun metadataFailureDoesNotReportASuccessfulReplacement() = runBlocking {
        val previous = PasswordPresence(true, true, true)
        val presence = object : PasswordPresenceStore {
            override fun read() = previous
            override fun write(presence: PasswordPresence) = false
        }
        val credentials = PasswordManagerCredentials(
            presence, retrieve = { null }, save = { _, _ -> PasswordSaveOutcome.SAVED },
        )

        assertEquals(PasswordSaveOutcome.FAILED, credentials.save("reader", "replacement"))
        assertEquals(previous, credentials.status())
    }

    @Test
    fun retrievalUpdatesOnlyConfirmedPerFieldPresence() = runBlocking {
        val presence = MemoryPresence()
        var providerValue: PasswordManagerCredential? = PasswordManagerCredential(
            "reader", "pttchrome:v1:JBSWY3DPEHPK3PXP:pa:ss:word",
        )
        val credentials = PasswordManagerCredentials(
            presence, retrieve = { providerValue }, save = { _, _ -> PasswordSaveOutcome.SAVED },
        )

        assertEquals(providerValue, credentials.get())
        assertEquals(PasswordPresence(true, true, true), credentials.status())
        providerValue = null
        assertNull(credentials.get())
        assertEquals(PasswordPresence(true, true, true), credentials.status())
        providerValue = PasswordManagerCredential("reader", "pttchrome:v1:not-a-secret:password")
        assertEquals(providerValue, credentials.get())
        assertEquals(PasswordPresence(true, true, false), credentials.status())
    }
}
