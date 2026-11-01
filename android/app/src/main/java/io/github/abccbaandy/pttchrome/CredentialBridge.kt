package io.github.abccbaandy.pttchrome

import android.app.Activity
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPasswordOption
import androidx.credentials.PasswordCredential
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * Credential Manager bridge for password-manager login and Google cloud-sync sign-in.
 *
 * WebView has no PasswordCredential API. Passwords travel unchanged through this
 * bridge; credential_pack.js packs and unpacks the optional TOTP secret. Only
 * last-confirmed presence flags are retained by the app, not account information.
 * The message contract is documented in src/js/android_bridge.js.
 */
class CredentialBridge(private val activity: Activity) {
    private val manager = CredentialManager.create(activity)
    private val passwords = PasswordManagerCredentials(
        PasswordPresenceFile(File(activity.filesDir, "password-manager-presence")),
        retrieve = {
            val credential = manager.getCredential(
                activity, GetCredentialRequest(listOf(GetPasswordOption())),
            ).credential
            (credential as? PasswordCredential)?.let { PasswordManagerCredential(it.id, it.password) }
        },
        save = { user, password ->
            try {
                manager.createCredential(activity, CreatePasswordRequest(user, password))
                PasswordSaveOutcome.SAVED
            } catch (_: CreateCredentialCancellationException) {
                PasswordSaveOutcome.CANCELLED
            } catch (_: CreateCredentialException) {
                PasswordSaveOutcome.FAILED
            }
        },
    )

    /** Return the JSON reply for the requesting page. Never expose provider exception contents. */
    suspend fun handle(request: JSONObject): String {
        val id = request.optInt("id")
        val reply = JSONObject().put("id", id)
        when (request.optString("op")) {
            "getPassword" -> try {
                val credential = passwords.get()
                if (credential != null) {
                    val presence = passwords.status().toJson()
                    reply.put("ok", true).put("user", credential.user).put("password", credential.password)
                        .put("presence", presence)
                } else {
                    reply.put("ok", false).put("error", "missing")
                }
            } catch (_: NoCredentialException) {
                reply.put("ok", false).put("error", "missing")
            } catch (_: GetCredentialCancellationException) {
                reply.put("ok", false).put("error", "cancelled")
            } catch (_: GetCredentialException) {
                reply.put("ok", false).put("error", "failed")
            } catch (_: IOException) {
                reply.put("ok", false).put("error", "failed")
            }
            "storePassword" -> try {
                when (passwords.save(request.optString("user"), request.optString("password"))) {
                    PasswordSaveOutcome.SAVED -> reply.put("ok", true).put("presence", passwords.status().toJson())
                    PasswordSaveOutcome.CANCELLED -> reply.put("ok", false).put("error", "cancelled")
                    PasswordSaveOutcome.FAILED -> reply.put("ok", false).put("error", "failed")
                }
            } catch (_: IOException) {
                reply.put("ok", false).put("error", "failed")
            }
            "getPasswordStatus" -> try {
                reply.put("ok", true).put("presence", passwords.status().toJson())
            } catch (_: IOException) {
                reply.put("ok", false).put("error", "failed")
            }
            "googleSignIn" -> googleSignIn(request.optString("serverClientId"), reply)
            "googleSignOut" -> try {
                manager.clearCredentialState(ClearCredentialStateRequest())
                reply.put("ok", true)
            } catch (e: ClearCredentialException) {
                Log.i(TAG, "googleSignOut: ${e.type}")
                reply.put("ok", false)
            }
            else -> reply.put("ok", false).put("error", "unknown op")
        }
        return reply.toString()
    }

    /**
     * 雲端同步的 Google 登入：WebView 內不准做 OAuth（disallowed_useragent），由原生取 Google ID
     * token，網頁再 `signInWithCredential` 交給 Firebase（src/js/google_sign_in.js）。
     * serverClientId 必須是 Firebase Google provider 的 Web client，token 的 aud 才會被接受；
     * 另外 Google Cloud 同專案要有本 App（package＋簽章 SHA-1）的 Android OAuth client，
     * 否則 Credential Manager 回 developer error（docs/android-app.md「雲端同步 Google 登入」）。
     */
    private suspend fun googleSignIn(serverClientId: String, reply: JSONObject) {
        if (!isGoogleWebClientId(serverClientId)) {
            reply.put("ok", false).put("error", "badClientId")
            return
        }
        try {
            // 使用者按了「登入」才會走到這裡 ⇒ 用明確的「使用 Google 帳戶登入」流程（會列出裝置上所有帳號），
            // 不用 GetGoogleIdOption 的「只列授權過的帳號」靜默流程。
            val option = GetSignInWithGoogleOption.Builder(serverClientId).build()
            val cred = manager.getCredential(activity, GetCredentialRequest(listOf(option))).credential
            if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                reply.put("ok", true).put("idToken", GoogleIdTokenCredential.createFrom(cred.data).idToken)
            } else {
                Log.w(TAG, "googleSignIn: unexpected credential ${cred.type}")
                reply.put("ok", false).put("error", "failed")
            }
        } catch (e: GetCredentialCancellationException) {
            reply.put("ok", false).put("error", "cancelled")
        } catch (e: GetCredentialException) {
            // 含 Android OAuth client 沒註冊（訊息帶 "developer console is not set up correctly"）。
            Log.w(TAG, "googleSignIn: ${e.type} ${e.message}")
            reply.put("ok", false).put("error", "failed")
        } catch (e: GoogleIdTokenParsingException) {
            Log.w(TAG, "googleSignIn: token parse", e)
            reply.put("ok", false).put("error", "failed")
        }
    }

    private companion object {
        const val TAG = "PttCredentialBridge"
    }
}

private fun PasswordPresence.toJson() = JSONObject()
    .put("user", user)
    .put("password", password)
    .put("otpSecret", otpSecret)

private val GOOGLE_WEB_CLIENT_ID = Regex("""\d+-[a-z0-9]+\.apps\.googleusercontent\.com""")

/** bridge 只收 OAuth client id 形狀的 serverClientId（網頁端常數 firebase_config.js#GOOGLE_WEB_CLIENT_ID）。 */
internal fun isGoogleWebClientId(id: String): Boolean = GOOGLE_WEB_CLIENT_ID.matches(id)
