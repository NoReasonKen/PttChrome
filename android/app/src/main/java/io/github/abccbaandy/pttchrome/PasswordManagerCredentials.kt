package io.github.abccbaandy.pttchrome

/** Last-confirmed field presence, never an authoritative inventory of the external provider. */
internal data class PasswordPresence(
    val user: Boolean = false,
    val password: Boolean = false,
    val otpSecret: Boolean = false,
)

internal interface PasswordPresenceStore {
    fun read(): PasswordPresence
    fun write(presence: PasswordPresence): Boolean
}

internal data class PasswordManagerCredential(val user: String, val password: String)
internal enum class PasswordSaveOutcome { SAVED, CANCELLED, FAILED }

/** Coordinates the provider boundary and app-owned, non-secret status metadata. */
internal class PasswordManagerCredentials(
    private val presence: PasswordPresenceStore,
    private val retrieve: suspend () -> PasswordManagerCredential?,
    private val save: suspend (String, String) -> PasswordSaveOutcome,
) {
    fun status() = presence.read()

    suspend fun get(): PasswordManagerCredential? {
        val credential = retrieve() ?: return null
        if (credential.user.isEmpty() || credential.password.isEmpty()) return null
        if (!presence.write(credentialPresence(credential))) return null
        return credential
    }

    suspend fun save(user: String, password: String): PasswordSaveOutcome {
        if (user.isEmpty() || password.isEmpty()) return PasswordSaveOutcome.FAILED
        val outcome = save.invoke(user, password)
        if (outcome != PasswordSaveOutcome.SAVED) return outcome
        return if (presence.write(credentialPresence(PasswordManagerCredential(user, password)))) outcome else PasswordSaveOutcome.FAILED
    }
}

internal fun credentialPresence(credential: PasswordManagerCredential): PasswordPresence {
    val (user, password) = credential
    // Match credential_pack.js: only a valid leading envelope carries a TOTP secret.
    val packed = password.removePrefix("pttchrome:v1:")
    val separator = packed.indexOf(':')
    val hasSecret = packed != password && separator > 0 &&
        packed.substring(0, separator).all { it in 'A'..'Z' || it in '2'..'7' }
    return PasswordPresence(user.isNotEmpty(), password.isNotEmpty(), hasSecret)
}
