package io.github.abccbaandy.pttchrome

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.IOException

internal enum class CredentialSource(val wire: String) {
    LOCAL("local"), MANAGER("manager");

    companion object {
        fun fromWire(value: String) = entries.find { it.wire == value }
    }
}

internal data class SealedCredential(val iv: ByteArray, val ciphertext: ByteArray)
internal data class DeviceCredentialState(
    val source: CredentialSource = CredentialSource.LOCAL,
    val local: SealedCredential? = null,
)

internal interface DeviceCredentialStateStore {
    fun read(): DeviceCredentialState
    fun write(value: DeviceCredentialState)
}

internal interface LocalCredentialCipher {
    fun seal(value: PasswordManagerCredential, existing: Boolean): SealedCredential
    fun open(value: SealedCredential): PasswordManagerCredential
}

internal data class CredentialDestinationStatus(val presence: PasswordPresence, val error: String? = null)
internal data class DeviceCredentialStatus(
    val source: CredentialSource,
    val local: CredentialDestinationStatus,
    val manager: CredentialDestinationStatus,
)
internal data class SelectedCredential(val source: CredentialSource, val credential: PasswordManagerCredential)
internal data class CredentialWriteResult(val source: CredentialSource, val presence: PasswordPresence)

/** Sanitized error codes only; never retain provider exception text or credential values. */
internal class CredentialStorageException(val code: String, val source: CredentialSource? = null) :
    IOException("Credential operation failed")

/** Owns the installed app's source and retained local record, independently of any loaded page. */
internal class DeviceCredentials(
    private val state: DeviceCredentialStateStore,
    private val cipher: LocalCredentialCipher,
    private val manager: PasswordManagerCredentials,
) {
    private val mutex = Mutex()

    suspend fun status(): DeviceCredentialStatus = mutex.withLock {
        withContext(Dispatchers.IO) {
            val saved = readState()
            val local = try {
                CredentialDestinationStatus(saved.local?.let { credentialPresence(openLocal(it)) } ?: PasswordPresence())
            } catch (_: CredentialStorageException) {
                CredentialDestinationStatus(PasswordPresence(), "unreadable")
            }
            val provider = try {
                CredentialDestinationStatus(manager.status())
            } catch (_: IOException) {
                CredentialDestinationStatus(PasswordPresence(), "failed")
            }
            DeviceCredentialStatus(saved.source, local, provider)
        }
    }

    suspend fun save(source: CredentialSource, user: String, password: String): CredentialWriteResult = mutex.withLock {
        val saved = withContext(Dispatchers.IO) { readState() }
        if (user.isEmpty() && password.isEmpty()) {
            val presence = when (source) {
                CredentialSource.LOCAL -> withContext(Dispatchers.IO) {
                    saved.local?.let { credentialPresence(openLocal(it)) } ?: PasswordPresence()
                }
                CredentialSource.MANAGER -> withContext(Dispatchers.IO) { manager.status() }
            }
            withContext(Dispatchers.IO) { writeState(saved.copy(source = source)) }
            return@withLock CredentialWriteResult(source, presence)
        }
        if (user.isEmpty() || password.isEmpty()) throw CredentialStorageException("invalid", saved.source)
        val credential = PasswordManagerCredential(user, password)
        val next = when (source) {
            CredentialSource.LOCAL -> withContext(Dispatchers.IO) {
                // An unreadable record must remain recoverable, including when its key is missing.
                saved.local?.let { openLocal(it) }
                val sealed = try { cipher.seal(credential, saved.local != null) } catch (_: Exception) {
                    throw CredentialStorageException("failed", saved.source)
                }
                saved.copy(source = source, local = sealed)
            }
            CredentialSource.MANAGER -> {
                when (manager.save(user, password)) {
                    PasswordSaveOutcome.SAVED -> Unit
                    PasswordSaveOutcome.CANCELLED -> throw CredentialStorageException("cancelled", saved.source)
                    PasswordSaveOutcome.FAILED -> throw CredentialStorageException("failed", saved.source)
                }
                saved.copy(source = source)
            }
        }
        withContext(Dispatchers.IO) { writeState(next) }
        CredentialWriteResult(source, credentialPresence(credential))
    }

    /** Explicit deletion need not decrypt the payload, including after key loss or integrity failure. */
    suspend fun deleteLocal(): CredentialWriteResult = mutex.withLock {
        withContext(Dispatchers.IO) {
            val saved = readState()
            writeState(saved.copy(local = null))
            CredentialWriteResult(saved.source, PasswordPresence())
        }
    }

    suspend fun get(): SelectedCredential = mutex.withLock {
        val saved = withContext(Dispatchers.IO) { readState() }
        val credential = when (saved.source) {
            CredentialSource.LOCAL -> withContext(Dispatchers.IO) { saved.local?.let { openLocal(it) } }
            CredentialSource.MANAGER -> manager.get()
        } ?: throw CredentialStorageException("missing", saved.source)
        SelectedCredential(saved.source, credential)
    }

    private fun readState(): DeviceCredentialState = try { state.read() } catch (_: IOException) {
        throw CredentialStorageException("unreadable")
    }

    private fun writeState(value: DeviceCredentialState) {
        try { state.write(value) } catch (_: IOException) { throw CredentialStorageException("failed") }
    }

    private fun openLocal(value: SealedCredential): PasswordManagerCredential = try {
        cipher.open(value)
    } catch (_: Exception) {
        throw CredentialStorageException("unreadable", CredentialSource.LOCAL)
    }
}
