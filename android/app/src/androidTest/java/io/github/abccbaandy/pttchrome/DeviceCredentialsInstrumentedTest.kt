package io.github.abccbaandy.pttchrome

import android.security.keystore.KeyInfo
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.SecretKeyFactory

/** Supplemental storage-boundary checks; the APK E2E covers the shared UI and real bridge. */
class DeviceCredentialsInstrumentedTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var directory: File
    private lateinit var record: File
    private lateinit var alias: String
    private val credential = PasswordManagerCredential(
        "synthetic-keystore-reader", "pttchrome:v1:JBSWY3DPEHPK3PXP:synthetic-keystore-password",
    )

    @Before
    fun prepareIsolatedStore() {
        val suffix = UUID.randomUUID().toString()
        alias = "pttchrome.instrumentation.$suffix"
        directory = File(context.noBackupFilesDir, "credential-test-$suffix").apply { mkdirs() }
        record = File(directory, DeviceCredentialFile.FILE_NAME)
    }

    @After
    fun removeIsolatedStore() {
        directory.deleteRecursively()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    }

    private fun open(): DeviceCredentials = DeviceCredentials(
        DeviceCredentialFile(record),
        LocalCredentialEncryption(AndroidCredentialKey(alias)::resolve),
        PasswordManagerCredentials(
            object : PasswordPresenceStore {
                override fun read() = PasswordPresence()
                override fun write(presence: PasswordPresence) = true
            },
            retrieve = { error("Local enrollment must not request provider authentication") },
            save = { _, _ -> error("Local enrollment must not save into a provider") },
        ),
    )

    @Test
    fun actualKeystorePersistsEncryptedCredentialsWithoutPerUseAuthentication() = runBlocking {
        open().save(CredentialSource.LOCAL, credential.user, credential.password)
        val key = AndroidCredentialKey(alias).resolve(false)
        assertNull(key.encoded)
        val info = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore")
            .getKeySpec(key, KeyInfo::class.java) as KeyInfo
        assertFalse(info.isUserAuthenticationRequired)
        val persisted = record.readBytes().toString(Charsets.ISO_8859_1)
        listOf(credential.user, "synthetic-keystore-password", "JBSWY3DPEHPK3PXP").forEach {
            assertFalse("App storage must contain ciphertext instead of credential values", persisted.contains(it))
        }
        assertEquals(credential, open().get().credential)
        assertEquals(PasswordPresence(true, true, true), open().status().local.presence)
    }

    @Test
    fun tamperingFailsVisiblyAndDoesNotOverwriteTheRetainedRecord() = runBlocking {
        open().save(CredentialSource.LOCAL, credential.user, credential.password)
        record.writeBytes(record.readBytes().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() })
        val damaged = record.readBytes()
        assertEquals("unreadable", open().status().local.error)
        try {
            open().save(CredentialSource.LOCAL, "replacement", "replacement-password")
            error("Integrity failure must not be silently replaced")
        } catch (failure: CredentialStorageException) {
            assertEquals("unreadable", failure.code)
        }
        assertArrayEquals(damaged, record.readBytes())
    }

    @Test
    fun unavailableKeyIsNeverRegeneratedOverAnExistingRecord() = runBlocking {
        open().save(CredentialSource.LOCAL, credential.user, credential.password)
        val persisted = record.readBytes()
        val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        assertEquals("unreadable", open().status().local.error)
        try {
            open().save(CredentialSource.LOCAL, "replacement", "replacement-password")
            error("Key loss requires visible recovery rather than automatic re-enrollment")
        } catch (failure: CredentialStorageException) {
            assertEquals("unreadable", failure.code)
        }
        assertFalse(keys.containsAlias(alias))
        assertArrayEquals(persisted, record.readBytes())
    }
}
