package io.github.abccbaandy.pttchrome

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Base64
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Only fixed Pixiv metadata endpoints and their small image responses cross the bridge. */
internal object PixivPolicy {
    const val BODY_LIMIT = 512 * 1024
    private val idPattern = Regex("[1-9][0-9]{0,14}")
    private val defaultPaths = setOf("/common/images/no_profile.png",
        "/common/images/no_profile_s.png", "/common/images/no_profile_ss.png")
    private val squarePreviewPath = Regex("/c/250x250_80_a2/img-master/img/" +
        "([0-9]{4}/[0-9]{2}/[0-9]{2}/[0-9]{2}/[0-9]{2}/[0-9]{2})/" +
        "([1-9][0-9]{0,14})_p0_square1200\\.jpg")
    private val imageDateFormat = DateTimeFormatter.ofPattern("uuuu/MM/dd/HH/mm/ss")
        .withResolverStyle(ResolverStyle.STRICT)

    fun validQuery(query: String) = idPattern.matches(query)
    fun validKind(kind: String) = kind == "user" || kind == "artwork"

    fun endpoint(kind: String, query: String): HttpUrl {
        require(validKind(kind) && validQuery(query))
        val path = if (kind == "user") "user/$query?full=1&lang=en" else "illust/$query?lang=en"
        return requireNotNull("https://www.pixiv.net/ajax/$path".toHttpUrlOrNull())
    }

    fun isDefaultAvatar(value: String): Boolean {
        if (value.isBlank() || value == "null") return true
        val url = value.toHttpUrlOrNull() ?: return false
        return !hasUserInfo(value) && url.scheme == "https" && url.host == "s.pximg.net" && url.port == 443 &&
            url.username.isEmpty() && url.password.isEmpty() && url.encodedPath in defaultPaths &&
            url.query == null && url.fragment == null
    }

    fun imageUrl(kind: String, value: String): HttpUrl? {
        if (!validKind(kind)) return null
        val url = value.toHttpUrlOrNull() ?: return null
        if (hasUserInfo(value) || url.scheme != "https" || url.host != "i.pximg.net" || url.port != 443 ||
            url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null ||
            url.query != null) return null
        val path = url.encodedPath
        if (kind == "user") return url.takeIf { path.startsWith("/user-profile/") }
        // The proportional small URL uses a bounded /c/.../img-master/ transform.
        // Do not accept originals, arbitrary hosts or cropped square thumbnails.
        return url.takeIf { path.startsWith("/c/") && path.contains("/img-master/") &&
            !path.contains("_square") }
    }

    fun mediaType(header: String?): String? = header.orEmpty().substringBefore(';')
        .trim().lowercase().takeIf { it in setOf("image/jpeg", "image/png", "image/webp", "image/gif") }

    fun artworkImage(primary: String, artwork: PixivArtworkIdentity,
        thumbnail: PixivArtworkThumbnail?): String {
        if (primary.isNotBlank()) return primary
        if (!artwork.isPublicSingleIllustration() || thumbnail == null ||
            thumbnail.identity != artwork || thumbnail.masked != false || thumbnail.unlisted != false) return ""
        // Some anonymous replies omit every body.urls value while their matching
        // public userIllusts entry still supplies this exact thumbnail format.
        // Derive only its same-image proportional transform, never an original.
        val uri = try { URI(thumbnail.url) } catch (_: Exception) { return "" }
        if (uri.scheme != "https" || uri.host != "i.pximg.net" || uri.rawUserInfo != null ||
            uri.port != -1 || uri.rawQuery != null || uri.rawFragment != null) return ""
        val match = squarePreviewPath.matchEntire(uri.rawPath.orEmpty()) ?: return ""
        val date = match.groupValues[1]
        if (match.groupValues[2] != artwork.id) return ""
        try { LocalDateTime.parse(date, imageDateFormat) } catch (_: Exception) { return "" }
        val derived = "https://i.pximg.net/c/540x540_70/img-master/img/$date/${artwork.id}_p0_master1200.jpg"
        return imageUrl("artwork", derived)?.toString().orEmpty()
    }

    private fun hasUserInfo(value: String): Boolean = try { URI(value).rawUserInfo != null }
        catch (_: Exception) { true }
}

internal data class PixivArtworkIdentity(val id: String, val pageCount: Int?, val illustType: Int?,
    val xRestrict: Int?, val restrict: Int?) {
    fun isPublicSingleIllustration() = PixivPolicy.validQuery(id) && pageCount == 1 &&
        illustType == 0 && xRestrict == 0 && restrict == 0
}

internal data class PixivArtworkThumbnail(val identity: PixivArtworkIdentity, val url: String,
    val masked: Boolean?, val unlisted: Boolean?)

internal data class PixivFields(val id: String, val name: String, val description: String,
    val author: String = "", val width: Int = 0, val height: Int = 0, val imageUrl: String = "",
    val restriction: String = "", val message: String = "")

internal data class PixivItem(val query: String, val kind: String, val state: String,
    val name: String = "", val author: String = "", val description: String = "",
    val width: Int = 0, val height: Int = 0, val imageData: String? = null,
    val imageDefault: Boolean = false, val imageError: Boolean = false,
    val restriction: String = "", val message: String = "")

/** A structured Pixiv refusal, distinct from invalid JSON and transport failures. */
internal class PixivResponseException(val notice: String) : Exception("Pixiv refused the metadata request")

internal fun pixivMessage(value: String): String = value.filter {
    !it.isISOControl() || it == '\n' || it == '\t'
}.trim().take(500)

internal fun pixivMetadata(kind: String, query: String, fields: PixivFields): PixivItem {
    require(PixivPolicy.validKind(kind) && PixivPolicy.validQuery(query))
    require(fields.id == query && fields.name.isNotBlank())
    return PixivItem(query, kind, "found", fields.name.take(500), fields.author.take(500),
        fields.description.take(6000), fields.width.coerceIn(0, 100000),
        fields.height.coerceIn(0, 100000), imageDefault = kind == "user" && PixivPolicy.isDefaultAvatar(fields.imageUrl),
        restriction = if (fields.imageUrl.isBlank() && fields.restriction in setOf("r18", "r18g", "restricted"))
            fields.restriction else "", message = pixivMessage(fields.message))
}

/** Lifetime is owned by the current chooser's coroutine; cancellation aborts its HTTP call. */
internal class PixivLookup(
    private val userAgent: String,
    private val parseFields: (String, String) -> PixivFields,
    private val defaultAvatar: () -> ByteArray,
    private val http: OkHttpClient = client(),
) {
    private data class Payload(val status: Int, val contentType: String?, val bytes: ByteArray)

    suspend fun lookup(kind: String, query: String, metadataReady: (PixivItem) -> Unit): PixivItem {
        require(PixivPolicy.validKind(kind) && PixivPolicy.validQuery(query))
        val fields: PixivFields
        val item: PixivItem
        try {
            val metadata = read(PixivPolicy.endpoint(kind, query), metadata = true)
            if (metadata.status == 404) return PixivItem(query, kind, "missing")
            if (metadata.status != 200) {
                // Only a structured API refusal may supply visible upstream text.
                // HTML error pages, status labels and parser errors are never shown.
                if (isJson(metadata.contentType) && metadata.bytes.isNotEmpty()) {
                    try {
                        withContext(Dispatchers.IO) { parseFields(kind, metadata.bytes.toString(Charsets.UTF_8)) }
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: PixivResponseException) {
                        val notice = pixivMessage(error.notice)
                        if (notice.isNotBlank()) return PixivItem(query, kind, "unavailable", message = notice)
                    } catch (_: Exception) {
                        // A malformed body does not explain a restriction.
                    }
                }
                return PixivItem(query, kind, "unavailable")
            }
            check(isJson(metadata.contentType))
            fields = withContext(Dispatchers.IO) { parseFields(kind, metadata.bytes.toString(Charsets.UTF_8)) }
            item = pixivMetadata(kind, query, fields)
        } catch (error: CancellationException) {
            throw error
        } catch (error: PixivResponseException) {
            return PixivItem(query, kind, "unavailable", message = pixivMessage(error.notice))
        } catch (_: Exception) {
            return PixivItem(query, kind, "unavailable")
        }
        metadataReady(item)
        if (item.restriction.isNotEmpty()) return item.copy(imageError = true)
        return try {
            if (item.imageDefault) {
                val bytes = withContext(Dispatchers.IO) { defaultAvatar() }
                require(bytes.size <= PixivPolicy.BODY_LIMIT)
                item.copy(imageData = imageData("image/png", bytes))
            } else {
                val image = read(requireNotNull(PixivPolicy.imageUrl(kind, fields.imageUrl)))
                check(image.status == 200)
                val type = requireNotNull(PixivPolicy.mediaType(image.contentType))
                require(image.bytes.isNotEmpty())
                item.copy(imageData = imageData(type, image.bytes))
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            item.copy(imageError = true)
        }
    }

    private suspend fun imageData(type: String, bytes: ByteArray): String = withContext(Dispatchers.IO) {
        "data:$type;base64,${Base64.getEncoder().encodeToString(bytes)}"
    }

    private fun isJson(contentType: String?): Boolean = contentType.orEmpty()
        .substringBefore(';').trim().equals("application/json", true)

    private suspend fun read(url: HttpUrl, metadata: Boolean = false): Payload = suspendCancellableCoroutine { continuation ->
        val request = Request.Builder().url(url).header("User-Agent", userAgent)
            .header("Referer", "https://www.pixiv.net/")
            .header("Accept", "application/json,image/*;q=0.9")
            .header("Cache-Control", "no-store").build()
        val call = http.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val payload = response.use {
                        // Keep bounded API errors for their explicit reason, never image/HTML errors.
                        val bytes = if (it.code == 200 || (metadata && isJson(it.header("Content-Type"))))
                            boundedBytes(it) else byteArrayOf()
                        Payload(it.code, it.header("Content-Type"), bytes)
                    }
                    if (continuation.isActive) continuation.resume(payload)
                } catch (error: Exception) {
                    if (continuation.isActive) continuation.resumeWithException(error)
                }
            }
        })
    }

    private fun boundedBytes(response: Response): ByteArray {
        val body = response.body
        require(body.contentLength() <= PixivPolicy.BODY_LIMIT)
        return body.byteStream().use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = stream.read(buffer)
                if (count == -1) break
                require(output.size() + count <= PixivPolicy.BODY_LIMIT)
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
    }

    companion object {
        fun client(): OkHttpClient = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS).build()
    }
}
