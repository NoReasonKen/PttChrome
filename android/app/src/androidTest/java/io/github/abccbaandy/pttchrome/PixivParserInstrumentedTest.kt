package io.github.abccbaandy.pttchrome

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

/** The Android JSON/HTML adapter is separate from JVM-tested request and policy logic. */
class PixivParserInstrumentedTest {
    @Test fun userBiographyAndDefaultProfileSurviveMetadataExtraction() {
        val raw = """{"error":false,"body":{"userId":"123","name":"User","comment":"First\n\nSecond","imageBig":null,"image":"https://s.pximg.net/common/images/no_profile_s.png"}}"""
        val fields = pixivFieldsFromJson("user", raw)
        assertEquals("First\n\nSecond", fields.description)
        assertTrue(pixivMetadata("user", "123", fields).imageDefault)
    }

    @Test fun artworkHtmlBecomesPlainTextAndRestrictedImagesRemainAbsent() {
        val raw = """{"error":false,"body":{"id":"123","title":"Artwork","userName":"Artist","illustComment":"First&lt;safe&gt;<br />Second <b>bold</b>","width":400,"height":800,"urls":{"small":null,"original":"https://i.pximg.net/img-original/unused.jpg"}}}"""
        val fields = pixivFieldsFromJson("artwork", raw)
        assertTrue(fields.description.contains("First<safe>"))
        assertTrue(fields.description.contains("\n"))
        assertFalse(fields.description.contains("<b>"))
        assertEquals("", fields.imageUrl)
        assertFalse(pixivMetadata("artwork", "123", fields).imageDefault)
    }

    @Test fun malformedOrRefusedRepliesAreNotInterpretedAsExistingPages() {
        assertThrows(Exception::class.java) { pixivFieldsFromJson("user", "<html>Blocked</html>") }
        assertThrows(Exception::class.java) { pixivFieldsFromJson("user", """{"error":true,"body":{}}""") }
        assertThrows(Exception::class.java) { pixivFieldsFromJson("user", """{"error":false,"body":null}""") }
    }

    @Test fun absentArtworkPreviewsExposeOnlyExplicitRestrictionFlags() {
        val raw = """{"error":false,"message":"","body":{"id":"123","title":"Artwork","xRestrict":1,"restrict":0,"urls":{"small":null}}}"""
        assertEquals("r18", pixivFieldsFromJson("artwork", raw).restriction)
        assertEquals("r18g", pixivFieldsFromJson("artwork", raw.replace("\"xRestrict\":1", "\"xRestrict\":2")).restriction)
        assertEquals("restricted", pixivFieldsFromJson("artwork", raw.replace("\"xRestrict\":1", "\"xRestrict\":0")
            .replace("\"restrict\":0", "\"restrict\":1")).restriction)
        for (flag in listOf("0", "null", "99", "\"1\"")) {
            assertEquals("", pixivFieldsFromJson("artwork", raw.replace("\"xRestrict\":1", "\"xRestrict\":$flag")).restriction)
        }
        val available = raw.replace("\"small\":null", "\"small\":\"https://i.pximg.net/c/540x540_70/img-master/img/preview.jpg\"")
        assertEquals("", pixivFieldsFromJson("artwork", available).restriction)
    }

    @Test fun structuredApiRefusalsKeepBoundedPlainTextWithoutRequiringAnArtworkBody() {
        val error = assertThrows(PixivResponseException::class.java) {
            pixivFieldsFromJson("artwork", """{"error":true,"message":"This work is <b>unavailable</b>.<br />Try later &amp; check settings.","body":[]}""")
        }
        assertTrue(error.notice.contains("This work is unavailable."))
        assertTrue(error.notice.contains("Try later & check settings."))
        assertFalse(error.notice.contains("<b>"))
        val long = assertThrows(PixivResponseException::class.java) {
            pixivFieldsFromJson("user", """{"error":true,"message":"${"x".repeat(800)}"}""")
        }
        assertEquals(500, long.notice.length)
        for (value in listOf("null", "{}", "123", "\"\"")) {
            val empty = assertThrows(PixivResponseException::class.java) {
                pixivFieldsFromJson("user", """{"error":true,"message":$value}""")
            }
            assertEquals("", empty.notice)
        }
    }

    @Test fun omittedSmallPreviewUsesOnlyTheMatchingPublicSingleArtworkEntry() {
        val raw = """{"error":false,"body":{"id":"151615046","title":"Artwork","pageCount":1,"illustType":0,"xRestrict":0,"restrict":0,"urls":{"small":null,"original":null},"userIllusts":{"999":{"id":"999","url":"https://i.pximg.net/unused.jpg"},"151615046":{"id":"151615046","pageCount":1,"illustType":0,"xRestrict":0,"restrict":0,"isMasked":false,"isUnlisted":false,"url":"https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/11/03/00/30/41/151615046_p0_square1200.jpg"}}}}"""
        val expected = "https://i.pximg.net/c/540x540_70/img-master/img/2026/11/03/00/30/41/151615046_p0_master1200.jpg"
        assertEquals(expected, pixivFieldsFromJson("artwork", raw).imageUrl)
        for (changed in listOf(
            raw.replace("\"pageCount\":1", "\"pageCount\":2"),
            raw.replace("\"xRestrict\":0", "\"xRestrict\":1"),
            raw.replace("\"restrict\":0", "\"restrict\":null"),
            raw.replace("\"isMasked\":false", "\"isMasked\":true"),
            raw.replace("\"isMasked\":false", "\"isMasked\":null"),
            raw.replace("\"isUnlisted\":false", "\"isUnlisted\":true"),
            raw.replace("\"pageCount\":1", "\"pageCount\":\"1\""),
            raw.replace("\"151615046\":{", "\"151615047\":{"),
        )) {
            assertEquals("", pixivFieldsFromJson("artwork", changed).imageUrl)
        }
        val supplied = raw.replace("\"small\":null", "\"small\":\"https://i.pximg.net/c/540x540_70/img-master/img/existing_master1200.jpg\"")
        assertEquals("https://i.pximg.net/c/540x540_70/img-master/img/existing_master1200.jpg",
            pixivFieldsFromJson("artwork", supplied).imageUrl)
    }
}
