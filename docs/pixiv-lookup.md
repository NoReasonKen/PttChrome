# Pixiv numeric-ID lookup

An opt-in enhancement lets readers tap a standalone positive numeric ID in an
article body or comment and choose between Pixiv's user and artwork pages.
Both types may exist for the same ID. `enablePixivLookup` defaults to false and
appears in Enhancements and settings search. It is a normal shared preference;
runtime capability gating leaves it inactive in browsers and older APKs.

## Rendering and interaction

`pixiv_parse.js` returns terminal-cell ranges without network work. Canonical
IDs have 1–15 ASCII digits and no leading zero. Both sides must be whitespace or
the boundary of the row/comment content; adjacent punctuation, brackets, letters
and Chinese characters prevent a match. Existing URLs, identifiers, numeric
compounds such as dates/times/IP addresses, and comment metadata are excluded.
This is a candidate detector, not a claim that a number is a Pixiv ID.
`screen_annotations.js` applies it only to recognized article content; merged
comments supply their reconstructed content bounds. Existing range annotations
and reconstructed article links retain priority. Native grid geometry and copied
text remain unchanged.

The click callback opens the peripheral `PixivLookup` component, using the shared
MobileSheet on mobile and a dark Modal on desktop. Outside tap, Escape and the
host Back entry close it without sending PTT keys. Each kind updates independently.
The small chooser loads with its existing UI dependencies so the first tap can
immediately show a dismissible shell, without waiting on another JavaScript chunk.
Names, descriptions and heading links appear at metadata readiness; the image
arrives later without replacing the link. User names and artwork titles link
directly to their respective Pixiv page, with no separate open/close button.
Titles/names, authors and descriptions are clamped to two, one and three visual
lines respectively. Description whitespace is collapsed for the compact preview,
so source paragraph breaks do not consume its line budget. Title typography
matches the App Bar (17px/22px); descriptions and bylines use 12px/16px with
4px/6px card padding. The popup occupies at most 50% of the dynamic viewport
height and scrolls internally. Images retain their natural ratio, bounded by
available width and half the dynamic viewport height; no image is cropped.

## Android contract

`MainActivity` injects `pixivLookup:true` only through its existing trusted-page
configuration. The existing source-origin and main-frame checks guard both ops:

- `pixivLookup {lookupId, query, kind}` emits matching bridge request-ID replies
  with `complete:false` for metadata and `complete:true` for the image/final state.
  The result contains `query`, `kind`, `state`, bounded plain text fields, image
  dimensions, and optional `imageData`, `imageDefault`, `imageError`, `message`
  and `restriction`. Messages are bounded plain text; restriction codes are
  limited to `r18`, `r18g` and `restricted`.
- `pixivCancel {lookupId}` cancels the matching chooser's jobs and HTTP calls.

`requestAndroid` retains its ordinary single-reply behavior. Its optional third
argument adds `onProgress`, `signal` and a bounded `timeoutMs`. Only an explicitly
streaming caller retains a request after a `complete:false` reply. Abort and final
completion remove timers and signal listeners. `pixiv_lookup.js` owns each pair
of requests, ignores stale/mismatched replies and releases native work on close.

`PixivBridge` retains at most one chooser, with one request per kind. `PixivLookup`
uses anonymous HTTPS with no cookies, redirect following, retry or persistent
cache. Metadata endpoints are fixed to `www.pixiv.net/ajax/user/{id}?full=1&lang=en`
and `www.pixiv.net/ajax/illust/{id}?lang=en`. Images are limited to approved
`i.pximg.net` profile paths or proportional `/c/.../img-master/` transforms; user
info, other hosts/ports, query strings, fragments, squares and originals are
rejected. Each body is bounded to 512 KiB, with connect/read/call deadlines.
Page reload, WebView replacement and Activity destruction cancel jobs.

User descriptions come from `comment`. Artwork `illustComment` is converted to
plain text with Android's HTML parser, never inserted as HTML. The artwork image
prefers `urls.small`; dimensions come from the same metadata response. If that
field is absent, an explicitly public, unmasked, single-page work can use its
matching `userIllusts[id]` thumbnail metadata. A strictly validated
`/c/250x250_80_a2/img-master/img/.../{id}_p0_square1200.jpg` URL supplies the date
and ID for the equivalent `/c/540x540_70/img-master/img/.../{id}_p0_master1200.jpg`
preview. This requests a proportional small image, not the cropped square or
the original. Unknown/restricted/masked records and grouped works do not use
this fallback; a failed image request retains the normal image-error outcome.
A normal successful pair uses two metadata requests and two small-image requests, with
both kinds running concurrently. There is no original-image request, extra size
probe, official embed, album expansion or background ID prefetch.

`android/app/src/main/assets/pixiv-no-profile.png` is the 170×170 default profile
image copied from `https://s.pximg.net/common/images/no_profile.png`. Recognized
default variants and absent profile URLs use this bundled asset without another
HTTP request. Asset attribution remains with Pixiv.

HTTP 404 marks a missing page, including when Pixiv supplies an explanatory message. Missing types are
hidden; if both are missing, one empty-result message remains. Other HTTP/network
errors stay visible as unavailable, not proof of nonexistence. A bounded JSON
error message from other Pixiv responses is displayed as plain text. When successful artwork metadata has no usable image URL,
known `xRestrict` or `restrict` values explain R-18, R-18G or general viewing
restrictions in the page's language. These labels describe metadata flags, not
a verbatim server message. Unknown flags and unexplained network/image failures
keep the general unavailable message; the client does not guess their cause.
No extra page or image request is made to discover an explanation.
Image failures do not hide found metadata or prevent opening its page. Anonymous access does not
bypass Pixiv's visibility or authentication restrictions. Grouped-artwork preview
failures remain deferred. No proxy or separately operated server is required.

## Verification boundaries

### Local phone acceptance article

Run `PIXIV_TEST_ARTICLE=1 yarn start --host --port 8080 --strictPort` and use the
APK's development-page root URL. This explicit development-server mode opens a
synthetic article containing both user and artwork IDs, including a restricted
artwork and non-link boundary examples. It bypasses PTT connection, login and
cloud startup, uses an in-memory settings store installed before the app is
constructed, and leaves the existing native Pixiv bridge intact. The shared Back
guard is installed just as in ordinary startup, so native and browser Back close
the top popup. Taps therefore
query real Pixiv when used inside the debug APK. Terminal sends and reconnect
are inert. Stop the server and start it without the flag to return to normal
operation and the original saved settings. Production builds force the flag off
and remove the article module; no new production setting or Android Activity is
added. The opt-in `mobile_pixiv_test_article.offline.spec.js` verifies this boot
path separately using controlled native replies.

### Automated and device coverage

- Parser, annotation/cache and real-browser component/bridge tests cover ranges,
  metadata-first updates, cancellation, plain text, clamps and error separation.
- Offline mobile input tests use controlled native replies, without contacting
  Pixiv or real PTT. They verify tap/Back/close behavior and captured UI layouts.
- JVM tests exercise actual OkHttp with controlled transport and bounded bodies.
  Android instrumentation checks the actual JSON/HTML adapter separately.
- Phone acceptance verifies the installed native bridge and current Pixiv API.
  Browser mocks and compiling instrumentation are not on-device execution proof.

Accepted supporting experiment: local throwaway branch `codex/pixiv-prototype`,
capture commit `c430af83`. Its standalone debug Activity is not part of this feature.
Implementation requirement: [issue #138](https://github.com/NoReasonKen/PttChrome/issues/138).
