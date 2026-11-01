package io.github.abccbaandy.pttchrome

import android.util.AtomicFile
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException

/** One atomic record commits selection and local ciphertext together. Store it under noBackupFilesDir. */
internal class DeviceCredentialFile(private val file: File) : DeviceCredentialStateStore {
    private val record = AtomicFile(file)

    override fun read(): DeviceCredentialState = try {
        DataInputStream(record.openRead()).use { input ->
            if (input.readInt() != FORMAT) throw IOException("Unsupported credential record")
            val source = when (input.readUnsignedByte()) {
                0 -> CredentialSource.LOCAL
                1 -> CredentialSource.MANAGER
                else -> throw IOException("Invalid credential source")
            }
            val local = if (input.readBoolean()) {
                val iv = ByteArray(12).also { input.readFully(it) }
                val length = input.readInt()
                if (length !in 16..MAX_CIPHERTEXT) throw IOException("Invalid ciphertext size")
                SealedCredential(iv, ByteArray(length).also { input.readFully(it) })
            } else null
            if (input.read() != -1) throw IOException("Unexpected credential record data")
            DeviceCredentialState(source, local)
        }
    } catch (error: FileNotFoundException) {
        // An existing but inaccessible record is an error, not a new enrollment.
        if (file.exists() || File(file.path + ".bak").exists()) throw error
        DeviceCredentialState()
    }

    override fun write(value: DeviceCredentialState) {
        val stream = record.startWrite()
        try {
            val output = DataOutputStream(stream)
            output.writeInt(FORMAT)
            output.writeByte(if (value.source == CredentialSource.LOCAL) 0 else 1)
            output.writeBoolean(value.local != null)
            value.local?.let { local ->
                if (local.iv.size != 12 || local.ciphertext.size !in 16..MAX_CIPHERTEXT) {
                    throw IOException("Invalid encrypted record")
                }
                output.write(local.iv)
                output.writeInt(local.ciphertext.size)
                output.write(local.ciphertext)
            }
            output.flush()
            record.finishWrite(stream)
        } catch (error: IOException) {
            record.failWrite(stream)
            throw error
        }
    }

    companion object {
        const val FILE_NAME = "device-credentials"
        private const val FORMAT = 0x50544331
        private const val MAX_CIPHERTEXT = 262144
    }
}
