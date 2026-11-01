package io.github.abccbaandy.pttchrome

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** AES-GCM authenticates the entire credential payload; the platform supplies a fresh IV. */
internal class LocalCredentialEncryption(private val key: (create: Boolean) -> SecretKey) : LocalCredentialCipher {
    override fun seal(value: PasswordManagerCredential, existing: Boolean): SealedCredential {
        val plain = ByteArrayOutputStream().use { bytes ->
            DataOutputStream(bytes).use { output ->
                output.writeUTF(value.user)
                output.writeUTF(value.password)
            }
            bytes.toByteArray()
        }
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key(!existing))
            cipher.updateAAD(AUTHENTICATED_FORMAT)
            SealedCredential(cipher.iv, cipher.doFinal(plain))
        } finally {
            plain.fill(0)
        }
    }

    override fun open(value: SealedCredential): PasswordManagerCredential {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, value.iv))
        cipher.updateAAD(AUTHENTICATED_FORMAT)
        val plain = cipher.doFinal(value.ciphertext)
        return try {
            DataInputStream(ByteArrayInputStream(plain)).use { input ->
                val credential = PasswordManagerCredential(input.readUTF(), input.readUTF())
                if (input.read() != -1 || credential.user.isEmpty() || credential.password.isEmpty()) {
                    throw IOException("Invalid credential record")
                }
                credential
            }
        } finally {
            plain.fill(0)
        }
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        val AUTHENTICATED_FORMAT = "PttChrome local credentials v1".toByteArray(Charsets.US_ASCII)
    }
}
