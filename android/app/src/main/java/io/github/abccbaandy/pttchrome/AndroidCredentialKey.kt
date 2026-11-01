package io.github.abccbaandy.pttchrome

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Resolves a non-exportable app-owned key without adding authentication or lock-screen requirements. */
internal class AndroidCredentialKey(private val alias: String = ALIAS) {
    fun resolve(create: Boolean): SecretKey {
        val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
        if (store.containsAlias(alias)) {
            return store.getKey(alias, null) as? SecretKey
                ?: throw UnrecoverableKeyException("Local credential key is unavailable")
        }
        if (!create) throw UnrecoverableKeyException("Local credential key is unavailable")
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).apply {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
        }.generateKey()
    }

    companion object {
        const val ALIAS = "pttchrome.local-credentials.v1"
        private const val PROVIDER = "AndroidKeyStore"
    }
}
