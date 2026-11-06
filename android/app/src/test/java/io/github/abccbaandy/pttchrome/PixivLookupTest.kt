package io.github.abccbaandy.pttchrome

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.TimeUnit

class PixivLookupTest {
    private val server = MockWebServer()
    private val requests = Collections.synchronizedList(mutableListOf<okhttp3.Request>())
    private val avatar = "https://i.pximg.net/user-profile/img/avatar_170.png"
    private val thumbnail = "https://i.pximg.net/c/540x540_70/img-master/img/art_master1200.jpg"
    private val publicArtwork = PixivArtworkIdentity("151615046", 1, 0, 0, 0)
    private val publicThumbnail = PixivArtworkThumbnail(publicArtwork,
        "https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/11/03/00/30/41/151615046_p0_square1200.jpg",
        masked = false, unlisted = false)

    @Before fun start() { server.start() }
    @After fun close() { server.close() }

    private fun client(fields: PixivFields = PixivFields("123", "Name", "Description", imageUrl = avatar),
        parse: (String, String) -> PixivFields = { _, _ -> fields }) = PixivLookup("Synthetic reader",
        parse, { byteArrayOf(1, 2, 3) }, PixivLookup.client().newBuilder().addInterceptor { chain ->
            requests.add(chain.request())
            chain.proceed(chain.request().newBuilder().url(server.url(chain.request().url.encodedPath)).build())
        }.build())

    private fun metadata() = MockResponse.Builder().body("synthetic metadata")
        .addHeader("Content-Type", "application/json").build()

    @Test fun fixedEndpointsValidateKindsAndNumericIds() {
        assertEquals("https://www.pixiv.net/ajax/user/123?full=1&lang=en",
            PixivPolicy.endpoint("user", "123").toString())
        assertEquals("https://www.pixiv.net/ajax/illust/123?lang=en",
            PixivPolicy.endpoint("artwork", "123").toString())
        for (id in listOf("0", "0123", "1/2", "123?x=1", "-1", "1e3", "1234567890123456")) {
            assertFalse(id, PixivPolicy.validQuery(id))
            assertThrows(IllegalArgumentException::class.java) { PixivPolicy.endpoint("user", id) }
        }
        assertThrows(IllegalArgumentException::class.java) { PixivPolicy.endpoint("https://other.example", "123") }
    }

    @Test fun avatarFallbackOnlyRecognizesKnownDefaultPaths() {
        for (url in listOf("", "null", "https://s.pximg.net/common/images/no_profile.png",
            "https://s.pximg.net/common/images/no_profile_s.png", "https://s.pximg.net/common/images/no_profile_ss.png")) {
            assertTrue(url, PixivPolicy.isDefaultAvatar(url))
        }
        for (url in listOf("http://s.pximg.net/common/images/no_profile.png",
            "https://s.pximg.net.evil.example/common/images/no_profile.png",
            "https://@s.pximg.net/common/images/no_profile.png",
            "https://user@s.pximg.net/common/images/no_profile.png", "https://s.pximg.net:444/common/images/no_profile.png",
            "https://s.pximg.net/other.png", "https://s.pximg.net/common/images/no_profile.png?source=other")) {
            assertFalse(url, PixivPolicy.isDefaultAvatar(url))
        }
        assertTrue(pixivMetadata("user", "123", PixivFields("123", "User", "", imageUrl = "null")).imageDefault)
        assertFalse(pixivMetadata("artwork", "123", PixivFields("123", "Art", "", imageUrl = "null")).imageDefault)
    }

    @Test fun imagePolicyRejectsOriginalsSquaresForeignHostsAndRedirectTargets() {
        assertNotNull(PixivPolicy.imageUrl("user", avatar))
        assertNotNull(PixivPolicy.imageUrl("artwork", thumbnail))
        for (url in listOf("http://i.pximg.net/c/540x540/img-master/a.jpg", "https://evil.example/c/540x540/img-master/a.jpg",
            "https://i.pximg.net.evil.example/c/540x540/img-master/a.jpg", "https://user@i.pximg.net/c/540x540/img-master/a.jpg",
            "https://@i.pximg.net/c/540x540/img-master/a.jpg",
            "https://i.pximg.net:444/c/540x540/img-master/a.jpg", "https://i.pximg.net/img-original/a.jpg",
            "https://i.pximg.net/c/250x250_80_a2/img-master/a_square1200.jpg", "$thumbnail?redirect=elsewhere")) {
            assertNull(url, PixivPolicy.imageUrl("artwork", url))
        }
        assertNull(PixivPolicy.imageUrl("user", thumbnail))
        assertNull(PixivPolicy.imageUrl("artwork", avatar))
        assertNull(PixivPolicy.mediaType("text/html"))
        assertEquals("image/png", PixivPolicy.mediaType("IMAGE/PNG; charset=binary"))
    }

    @Test fun payloadIdentityAndTextBoundsAreEnforced() {
        val item = pixivMetadata("artwork", "123", PixivFields("123", "x".repeat(700), "y".repeat(7000),
            author = "z".repeat(800), width = Int.MAX_VALUE, height = -10))
        assertEquals(500, item.name.length)
        assertEquals(500, item.author.length)
        assertEquals(6000, item.description.length)
        assertEquals(100000, item.width)
        assertEquals(0, item.height)
        assertThrows(IllegalArgumentException::class.java) {
            pixivMetadata("user", "123", PixivFields("999", "Wrong identity", ""))
        }
    }

    @Test fun missingSmallPreviewUsesTheSamePublicSingleArtworkProportionalVariant() {
        assertEquals(
            "https://i.pximg.net/c/540x540_70/img-master/img/2026/11/03/00/30/41/151615046_p0_master1200.jpg",
            PixivPolicy.artworkImage("", publicArtwork, publicThumbnail))
    }

    @Test fun suppliedSmallPreviewIsPreservedWithoutUsingTheDerivedVariant() {
        assertEquals(thumbnail, PixivPolicy.artworkImage(thumbnail, publicArtwork, publicThumbnail))
        assertEquals(thumbnail, PixivPolicy.artworkImage(thumbnail,
            publicArtwork.copy(pageCount = null, xRestrict = 1), null))
    }

    @Test fun fallbackRejectsUnknownRestrictedMaskedUnlistedOrGroupedArtwork() {
        for (identity in listOf(
            publicArtwork.copy(id = "0"), publicArtwork.copy(pageCount = null), publicArtwork.copy(pageCount = 2),
            publicArtwork.copy(illustType = null), publicArtwork.copy(illustType = 1), publicArtwork.copy(illustType = 2),
            publicArtwork.copy(xRestrict = null), publicArtwork.copy(xRestrict = 1),
            publicArtwork.copy(restrict = null), publicArtwork.copy(restrict = 1),
        )) {
            assertEquals(identity.toString(), "", PixivPolicy.artworkImage("", identity,
                publicThumbnail.copy(identity = identity)))
            assertEquals(identity.toString(), "", PixivPolicy.artworkImage("", publicArtwork,
                publicThumbnail.copy(identity = identity)))
        }
        for (candidate in listOf(null, publicThumbnail.copy(masked = true), publicThumbnail.copy(masked = null),
            publicThumbnail.copy(unlisted = true), publicThumbnail.copy(unlisted = null),
            publicThumbnail.copy(identity = publicArtwork.copy(id = "151615047")))) {
            assertEquals(candidate.toString(), "", PixivPolicy.artworkImage("", publicArtwork, candidate))
        }
    }

    @Test fun fallbackRejectsEveryUnrecognizedThumbnailUrlInsteadOfReplacingArbitraryText() {
        val url = publicThumbnail.url
        for (candidate in listOf(
            url.replace("https://", "http://"), url.replace("i.pximg.net", "i.pximg.net.evil.example"),
            url.replace("i.pximg.net", "other.example"), url.replace("i.pximg.net", "user@i.pximg.net"),
            url.replace("i.pximg.net", "@i.pximg.net"), url.replace("i.pximg.net", "i.pximg.net:443"),
            "$url?format=small", "$url#preview", url.replace("250x250_80_a2", "1200x1200"),
            url.replace("151615046_p0", "151615047_p0"), url.replace("_p0_", "_p1_"),
            url.replace("_square1200.jpg", "_square600.jpg"), url.replace(".jpg", ".png"),
            url.replace("/2026/11/03/", "/2026/02/31/"), url.replace("/00/30/41/", "/24/30/41/"),
            url.replace("/img-master/", "/img-original/"), url.replace("/2026/", "/%32%30%32%36/"),
        )) {
            assertEquals(candidate, "", PixivPolicy.artworkImage("", publicArtwork,
                publicThumbnail.copy(url = candidate)))
        }
    }

    @Test fun derivedProportionalPreviewUsesOnlyMetadataAndOneImageRequest() = runBlocking {
        server.enqueue(metadata())
        server.enqueue(MockResponse.Builder().body("proportional image").addHeader("Content-Type", "image/jpeg").build())
        val result = client(parse = { _, _ -> PixivFields(publicArtwork.id, "Artwork", "Description",
            imageUrl = PixivPolicy.artworkImage("", publicArtwork, publicThumbnail)) })
            .lookup("artwork", publicArtwork.id) { assertEquals("found", it.state) }
        assertEquals("found", result.state)
        assertFalse(result.imageError)
        assertTrue(result.imageData!!.startsWith("data:image/jpeg;base64,"))
        assertEquals(2, server.requestCount)
        assertEquals("https://www.pixiv.net/ajax/illust/151615046?lang=en", requests[0].url.toString())
        assertEquals("https://i.pximg.net/c/540x540_70/img-master/img/2026/11/03/00/30/41/151615046_p0_master1200.jpg",
            requests[1].url.toString())
    }

    @Test fun existingSmallPreviewStillLoadsDirectlyWithoutAProbe() = runBlocking {
        server.enqueue(metadata())
        server.enqueue(MockResponse.Builder().body("existing preview").addHeader("Content-Type", "image/jpeg").build())
        val result = client(parse = { _, _ -> PixivFields(publicArtwork.id, "Artwork", "",
            imageUrl = PixivPolicy.artworkImage(thumbnail, publicArtwork, publicThumbnail)) })
            .lookup("artwork", publicArtwork.id) { }
        assertFalse(result.imageError)
        assertEquals(2, server.requestCount)
        assertEquals(thumbnail, requests[1].url.toString())
    }

    @Test fun metadataArrivesBeforeTheImageAndTheResultUsesOnlyTwoRequests() = runBlocking {
        server.enqueue(metadata())
        val ready = CompletableDeferred<PixivItem>()
        val pending = async { client().lookup("user", "123") { ready.complete(it) } }
        val first = withTimeout(5000) { ready.await() }
        assertEquals("found", first.state)
        assertNull(first.imageData)
        assertFalse(pending.isCompleted)
        server.enqueue(MockResponse.Builder().body("small image").addHeader("Content-Type", "image/png").build())
        val completed = withTimeout(5000) { pending.await() }
        assertEquals(first.name, completed.name)
        assertTrue(completed.imageData!!.startsWith("data:image/png;base64,"))
        assertEquals(2, server.requestCount)
        for (request in requests) {
            assertEquals("https://www.pixiv.net/", request.header("Referer"))
            assertNull(request.header("Cookie"))
            assertNull(request.header("Authorization"))
        }
        assertEquals("www.pixiv.net", requests[0].url.host)
        assertEquals("i.pximg.net", requests[1].url.host)
    }

    @Test fun defaultProfileUsesTheBundledImageWithoutAnotherRequest() = runBlocking {
        server.enqueue(metadata())
        val item = client(PixivFields("123", "User", "", imageUrl = "https://s.pximg.net/common/images/no_profile.png"))
            .lookup("user", "123") { }
        assertTrue(item.imageDefault)
        assertEquals("data:image/png;base64,AQID", item.imageData)
        assertEquals(1, server.requestCount)
    }

    @Test fun missingAndRefusedMetadataRemainDifferentAndNeverLoadAnImage() = runBlocking {
        for ((status, state) in listOf(404 to "missing", 403 to "unavailable", 429 to "unavailable")) {
            server.enqueue(MockResponse.Builder().code(status).body("upstream failure").build())
            var progress = false
            assertEquals(state, client().lookup("user", "123") { progress = true }.state)
            assertFalse(progress)
        }
        assertEquals(3, server.requestCount)
    }

    @Test fun aKnownRestrictionRetainsMetadataWithoutAttemptingAnImageRequest() = runBlocking {
        for (reason in listOf("r18", "r18g", "restricted")) {
            server.enqueue(metadata())
            val item = client(PixivFields("123", "Artwork", "Description", restriction = reason))
                .lookup("artwork", "123") { assertEquals(reason, it.restriction) }
            assertEquals("found", item.state)
            assertEquals("Artwork", item.name)
            assertEquals(reason, item.restriction)
            assertTrue(item.imageError)
            assertNull(item.imageData)
        }
        assertEquals(3, server.requestCount)
    }

    @Test fun unknownRestrictionCodesAndAccessibleImagesAreNotReportedAsBlocked() = runBlocking {
        server.enqueue(metadata())
        val unknown = client(PixivFields("123", "Artwork", "", restriction = "unknown"))
            .lookup("artwork", "123") { }
        assertEquals("", unknown.restriction)
        assertTrue(unknown.imageError)
        server.enqueue(metadata())
        server.enqueue(MockResponse.Builder().body("preview").addHeader("Content-Type", "image/jpeg").build())
        val available = client(PixivFields("123", "Artwork", "", imageUrl = thumbnail, restriction = "r18"))
            .lookup("artwork", "123") { }
        assertEquals("", available.restriction)
        assertFalse(available.imageError)
        assertEquals(3, server.requestCount)
    }

    @Test fun structuredApiReasonsSurviveSuccessAndErrorHttpStatuses() = runBlocking {
        val reason = "This work cannot be viewed in your region."
        for (status in listOf(200, 403, 429)) {
            server.enqueue(MockResponse.Builder().code(status).body("structured error")
                .addHeader("Content-Type", "application/json; charset=utf-8").build())
            val item = client(parse = { _, _ -> throw PixivResponseException(reason) })
                .lookup("artwork", "123") { error("A refusal has no metadata progress") }
            assertEquals("unavailable", item.state)
            assertEquals(reason, item.message)
        }
        assertEquals(3, server.requestCount)
    }

    @Test fun aMissingPageStaysHiddenEvenWhenPixivSuppliesAnExplanation() = runBlocking {
        server.enqueue(MockResponse.Builder().code(404).body("structured missing message")
            .addHeader("Content-Type", "application/json").build())
        val result = client(parse = { _, _ -> throw PixivResponseException("This user does not exist.") })
            .lookup("user", "123") { error("A missing page has no usable metadata") }
        assertEquals("missing", result.state)
        assertEquals("", result.message)
        assertEquals(1, server.requestCount)
    }

    @Test fun absentAndMalformedApiReasonsDoNotInventMessagesOrRevealErrorPages() = runBlocking {
        for ((status, state) in listOf(200 to "unavailable", 404 to "missing", 403 to "unavailable")) {
            server.enqueue(MockResponse.Builder().code(status).body("structured error")
                .addHeader("Content-Type", "application/json").build())
            val item = client(parse = { _, _ -> throw PixivResponseException("") })
                .lookup("user", "123") { error("A refusal has no metadata progress") }
            assertEquals(state, item.state)
            assertEquals("", item.message)
        }
        server.enqueue(MockResponse.Builder().code(403).body("<html>Internal upstream details</html>")
            .addHeader("Content-Type", "text/html").build())
        val html = client(parse = { _, _ -> error("HTML error pages must not be parsed") })
            .lookup("user", "123") { }
        assertEquals("unavailable", html.state)
        assertEquals("", html.message)
        server.enqueue(MockResponse.Builder().code(404).body("invalid JSON")
            .addHeader("Content-Type", "application/json").build())
        val malformed = client(parse = { _, _ -> throw IllegalArgumentException("Parser internals") })
            .lookup("user", "123") { }
        assertEquals("missing", malformed.state)
        assertEquals("", malformed.message)
        assertEquals(5, server.requestCount)
    }

    @Test fun visibleApiReasonsAreBoundedAndOversizedErrorBodiesAreDiscarded() = runBlocking {
        server.enqueue(metadata())
        val notice = client(parse = { _, _ -> throw PixivResponseException("\u0000" + "x".repeat(800)) })
            .lookup("user", "123") { }
        assertEquals("x".repeat(500), notice.message)
        server.enqueue(MockResponse.Builder().code(403).chunkedBody("x".repeat(PixivPolicy.BODY_LIMIT + 1), 8192)
            .addHeader("Content-Type", "application/json").build())
        val oversized = client(parse = { _, _ -> error("Oversized error must not be parsed") })
            .lookup("user", "123") { }
        assertEquals("unavailable", oversized.state)
        assertEquals("", oversized.message)
        assertEquals(2, server.requestCount)
    }

    @Test fun invalidPayloadAndOversizedMetadataAreUnavailable() = runBlocking {
        server.enqueue(metadata())
        assertEquals("unavailable", client(parse = { _, _ -> throw IllegalArgumentException("Malformed JSON") })
            .lookup("user", "123") { error("Invalid metadata must not be published") }.state)
        server.enqueue(MockResponse.Builder().body("x".repeat(PixivPolicy.BODY_LIMIT + 1))
            .addHeader("Content-Type", "application/json").build())
        assertEquals("unavailable", client().lookup("user", "123") { error("Oversized data must not be published") }.state)
        assertEquals(2, server.requestCount)
    }

    @Test fun redirectsAreNotFollowedAndImageFailurePreservesFoundMetadata() = runBlocking {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", server.url("/redirect")).build())
        assertEquals("unavailable", client().lookup("user", "123") { }.state)
        assertEquals(1, server.requestCount)
        server.enqueue(metadata())
        server.enqueue(MockResponse.Builder().code(403).build())
        val item = client().lookup("user", "123") { assertEquals("found", it.state) }
        assertEquals("found", item.state)
        assertTrue(item.imageError)
        assertNull(item.imageData)
        assertEquals(3, server.requestCount)
    }

    @Test fun anUnavailableProportionalPreviewDoesNotFallBackToAnOriginalOrSquare() = runBlocking {
        server.enqueue(metadata())
        val result = client(PixivFields("123", "Artwork", "", imageUrl = "null"))
            .lookup("artwork", "123") { }
        assertEquals("found", result.state)
        assertTrue(result.imageError)
        assertEquals(1, server.requestCount)
    }

    @Test fun streamedOversizedImagesAndHtmlBodiesPreserveOnlyMetadata() = runBlocking {
        for (image in listOf(
            MockResponse.Builder().chunkedBody("x".repeat(PixivPolicy.BODY_LIMIT + 1), 8192)
                .addHeader("Content-Type", "image/png").build(),
            MockResponse.Builder().body("<html>Sign in</html>").addHeader("Content-Type", "text/html").build(),
        )) {
            server.enqueue(metadata())
            server.enqueue(image)
            val item = client().lookup("user", "123") { }
            assertEquals("found", item.state)
            assertTrue(item.imageError)
            assertNull(item.imageData)
        }
        assertEquals(4, server.requestCount)
    }

    @Test fun cancellationDuringImageLoadingStopsWithoutPublishingAFinalResult() = runBlocking {
        server.enqueue(metadata())
        val ready = CompletableDeferred<Unit>()
        var finished = false
        val job = async {
            client().lookup("user", "123") { ready.complete(Unit) }
            finished = true
        }
        withTimeout(5000) { ready.await() }
        // Metadata has completed, and the second request has reached the controlled server.
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
        job.cancelAndJoin()
        assertFalse(finished)
    }
}
