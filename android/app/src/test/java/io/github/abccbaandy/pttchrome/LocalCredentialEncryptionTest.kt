package io.github.abccbaandy.pttchrome

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import javax.crypto.AEADBadTagException
import javax.crypto.KeyGenerator

class LocalCredentialEncryptionTest {
    @Test
    fun encryptsTheWholeCredentialAndAuthenticatesChanges() {
        // JVM coverage verifies the cipher boundary; instrumented tests exercise Android Keystore.
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val cipher = LocalCredentialEncryption { key }
        val original = PasswordManagerCredential("synthetic-reader", "pttchrome:v1:JBSWY3DPEHPK3PXP:synthetic-password")
        val sealed = cipher.seal(original, existing = false)
        val bytes = sealed.ciphertext.toString(Charsets.ISO_8859_1)
        listOf(original.user, "synthetic-password", "JBSWY3DPEHPK3PXP").forEach {
            assertFalse("Encrypted bytes must not include credential values", bytes.contains(it))
        }
        assertEquals(original, LocalCredentialEncryption { key }.open(sealed))
        val changed = sealed.copy(ciphertext = sealed.ciphertext.clone().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() })
        assertThrows(AEADBadTagException::class.java) { cipher.open(changed) }
    }
}
