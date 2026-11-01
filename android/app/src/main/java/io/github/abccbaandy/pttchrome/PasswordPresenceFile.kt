package io.github.abccbaandy.pttchrome

import android.util.AtomicFile
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException

/** A private atomic record containing only a format version and three presence flags. */
internal class PasswordPresenceFile(file: File) : PasswordPresenceStore {
    private val record = AtomicFile(file)

    override fun read(): PasswordPresence = try {
        DataInputStream(record.openRead()).use { input ->
            if (input.readUnsignedByte() != 1) throw IOException("Unsupported credential status format")
            PasswordPresence(input.readBoolean(), input.readBoolean(), input.readBoolean())
        }
    } catch (_: FileNotFoundException) {
        PasswordPresence()
    }

    override fun write(presence: PasswordPresence): Boolean {
        val stream = try { record.startWrite() } catch (_: IOException) { return false }
        return try {
            val output = DataOutputStream(stream)
            output.writeByte(1)
            output.writeBoolean(presence.user)
            output.writeBoolean(presence.password)
            output.writeBoolean(presence.otpSecret)
            output.flush()
            record.finishWrite(stream)
            true
        } catch (_: IOException) {
            record.failWrite(stream)
            false
        }
    }
}
