package io.github.abccbaandy.pttchrome

import android.content.res.AssetManager
import android.text.Html
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Trusted WebView receiver; one chooser, two independent ID interpretations, no persistent cache. */
internal class PixivBridge(scope: CoroutineScope, assets: AssetManager, userAgent: String) {
    private val scope = scope
    private val lookup = PixivLookup(userAgent, ::pixivFieldsFromJson,
        { assets.open("pixiv-no-profile.png").use { it.readBytes() } })
    private var lookupId: String? = null
    private var query: String? = null
    private val jobs = mutableMapOf<String, Job>()

    fun handle(request: JSONObject, reply: (JSONObject) -> Unit) {
        val id = request.optInt("id")
        fun error(reason: String) = reply(JSONObject().put("id", id).put("ok", false)
            .put("complete", true).put("error", reason))
        val token = request.optString("lookupId")
        if (!Regex("[A-Za-z0-9_-]{1,64}").matches(token)) { error("invalid"); return }
        if (request.optString("op") == "pixivCancel") {
            if (token == lookupId) cancel()
            reply(JSONObject().put("id", id).put("ok", true))
            return
        }
        val requestedQuery = request.optString("query")
        val kind = request.optString("kind")
        if (!PixivPolicy.validQuery(requestedQuery) || !PixivPolicy.validKind(kind)) { error("invalid"); return }
        if (token != lookupId) {
            cancel()
            lookupId = token
            query = requestedQuery
        }
        // A repeated kind cannot create extra parallel calls or reuse a token for another ID.
        if (query != requestedQuery || jobs.containsKey(kind)) { error("busy"); return }
        jobs[kind] = scope.launch {
            fun send(item: PixivItem, complete: Boolean) {
                if (isActive && lookupId == token) reply(JSONObject().put("id", id).put("ok", true)
                    .put("complete", complete).put("result", item.toJson()))
            }
            val result = lookup.lookup(kind, requestedQuery) { send(it, false) }
            send(result, true)
        }
    }

    fun cancel() {
        lookupId = null
        query = null
        jobs.values.forEach { it.cancel() }
        jobs.clear()
    }
}

internal fun pixivFieldsFromJson(kind: String, raw: String): PixivFields {
    val response = JSONObject(raw)
    fun responseMessage(): String = (response.opt("message") as? String)?.let {
        pixivMessage(Html.fromHtml(it.take(4000), Html.FROM_HTML_MODE_LEGACY).toString().replace("\uFFFC", ""))
    }.orEmpty()
    if (response.opt("error") == true) throw PixivResponseException(responseMessage())
    check(response.opt("error") == false)
    val body = response.getJSONObject("body")
    fun text(key: String): String = if (body.isNull(key)) "" else body.optString(key)
    val user = kind == "user"
    val description = if (user) text("comment") else
        Html.fromHtml(text("illustComment"), Html.FROM_HTML_MODE_LEGACY).toString().replace("\uFFFC", "").trim()
    val image = if (user) text("imageBig").ifBlank { text("image") } else {
        val primary = body.optJSONObject("urls")?.let { if (it.isNull("small")) "" else it.optString("small") }.orEmpty()
        val artwork = body.artworkIdentity()
        val thumbnail = body.optJSONObject("userIllusts")?.optJSONObject(artwork.id)?.let {
            PixivArtworkThumbnail(it.artworkIdentity(), if (it.isNull("url")) "" else it.optString("url"),
                it.opt("isMasked") as? Boolean, it.opt("isUnlisted") as? Boolean)
        }
        PixivPolicy.artworkImage(primary, artwork, thumbnail)
    }
    val restriction = if (user || image.isNotBlank()) "" else when (body.opt("xRestrict") as? Int) {
        1 -> "r18"
        2 -> "r18g"
        else -> if ((body.opt("restrict") as? Int)?.let { it > 0 } == true) "restricted" else ""
    }
    return PixivFields(text(if (user) "userId" else "id"), text(if (user) "name" else "title"),
        description, if (user) "" else text("userName"), body.optInt("width"), body.optInt("height"), image,
        restriction, if (image.isBlank()) responseMessage() else "")
}

private fun JSONObject.artworkIdentity(): PixivArtworkIdentity = PixivArtworkIdentity(
    optString("id"), opt("pageCount") as? Int, opt("illustType") as? Int,
    opt("xRestrict") as? Int, opt("restrict") as? Int)

private fun PixivItem.toJson(): JSONObject = JSONObject().put("query", query).put("kind", kind)
    .put("state", state).put("name", name).put("author", author).put("description", description)
    .put("width", width).put("height", height).put("imageDefault", imageDefault)
    .put("imageError", imageError).put("restriction", restriction).put("message", message)
    .apply { if (imageData != null) put("imageData", imageData) }
