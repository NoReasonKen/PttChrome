# Image Preview Behavior

This note describes the current source behavior, with article easy reading on the Android app as the starting point. It is a source review, not a report of browser or device test results.

## Article easy reading

Recognized media links receive inline preview slots in the accumulated article, including links in comments. A slot mounts its media preview near the reading position; the media resolver may produce an image, video, iframe, or album. The original link remains available separately. Article easy reading uses these inline previews instead of floating hover previews. [Article rendering](../src/js/term_view.js), [slot lifecycle](../src/render/inline_preview_slot.js), [media resolver](../src/components/ImagePreviewer.jsx).

Inline images use a maximum height of `23.75em` and maximum width of `39em`, with mobile layout and image-caption columns applying their own available-width limits. Grayscale remains a per-image display option. Image-caption merging remains a separate article layout action. [Image sizing and layout](../src/css/main.css), [caption grouping](../src/js/image_caption_group.js), [grayscale state](../src/render/inline_preview_slot.js).

Activate a successfully loaded inline image by clicking it or focusing it and pressing Enter or Space to open that one image in the PhotoSwipe viewer. The viewer receives the loaded image's `currentSrc` when available, its natural dimensions, alt text, and referrer policy; it does not resolve the article link a second time. The inline image remains at its reading size and the article layout does not change. [Activation and event detail](../src/render/screen.js), [viewer](../src/js/image_viewer.js), [application lifecycle](../src/js/pttchrome.jsx).

The viewer opens fitted to the viewport. Double-tap toggles between fit and exactly twice the fitted size; pinch and pan remain continuous. Its maximum zoom is the greater of eight times fit or twice the zoom needed for the image to span the viewport width, so small and very tall images can grow beyond the screen. Close button, Escape, and the existing system-back sheet dismissal close the viewer. The named modal gate suspends terminal input, the background is inert while open, and focus returns to the image when it still exists. [Zoom settings and modal lifecycle](../src/js/image_viewer.js), [named modal state](../src/js/pttchrome.jsx).

Images stay lazy-loaded as the reader scrolls. Existing URL resolution, proxy selection, retry behavior, grayscale, and image-caption merging remain part of the inline preview experience. [Lazy preview slots](../src/render/inline_preview_slot.js), [media loading](../src/components/ImagePreviewer.jsx).

## Reading modes and preferences

Article easy reading enables inline previews directly and disables duplicate floating previews. Native PTT view uses hover previews instead; article-list easy reading and temporary terminal prompts do not insert article previews. `enablePicPreview` defaults on but currently controls native hover previews, rather than disabling inline previews in article easy reading. [Rendering branches](../src/js/term_view.js), [defaults](../src/js/pref_storage.js), [preference handler](../src/js/pttchrome.jsx).

Ordinary recognized URLs receive slots before media resolution. Unsupported URLs eventually display no media; a slot does not establish that a URL is an image. Wrapped links add their preview only at the last segment, while bare domains and X mentions do not receive inline previews. Automatically repaired URLs can receive previews without changing the original article text. [Link construction](../src/render/link_segment.js).

## Supported media

The resolver registry tries specific hosts before generic file extensions and returns an image, video, iframe, or album description. The renderer consumes these descriptions without duplicating layout behavior for each host. [Registry and rendering](../src/components/ImagePreviewer.jsx), [shared URL patterns](../src/js/image_url_detect.js).

| Link family | Resolution behavior |
| --- | --- |
| Direct image files | Recognized image extensions become inline images. |
| Imgur single image | Known static images prefer WebP and retain original-format candidates. Ambiguous sharing URLs are probed to preserve GIF or video animation. |
| Imgur album/gallery | Album metadata expands into individual media descriptions. A failed lookup becomes an empty album. |
| X/Twitter image | Original-size image candidates have format/size fallbacks and optional proxying. |
| meee, Catbox, Flickr | Host-specific rules construct image URLs; eligible Catbox images can use the proxy. |
| Direct MP4/WebM/OGG | Inline video with playback controls. |
| YouTube, Twitch clips | Embedded player iframe. |
| Tenor sharing page | The configured Worker resolves the sharing page to muted, looping video; disabling that resolver means no preview. |

Most videos do not autoplay; Tenor's GIF-like media is the explicit exception. Hover previews display only image descriptions, excluding videos, iframes, and albums. Image-viewer activation applies to loaded images, leaving these other media controls intact. [Media descriptions and playback](../src/components/ImagePreviewer.jsx), [activation](../src/render/screen.js).

Ambiguous Imgur URLs use parallel HEAD probes for image type and MP4 availability, with a three-second abort timer where supported. Probe failure degrades to the existing JPG path; this is separate from any image-download timeout. [Probe classification and execution](../src/js/imgur_probe.js).

## Lazy loading and reading position

Preview mounting begins within 1,500 CSS pixels of the reading viewport. Mounted media is released only after moving beyond a wider 6,000-pixel margin, avoiding repeated mounting near one threshold. The observers use the actual `.main` scroll container, with long-page chunk visibility also participating. Deferred mounting postpones URL resolution as well as image download. [Margins](../src/js/lazy_media.js), [observers and mounting](../src/render/inline_preview_slot.js).

Unloaded previews keep measured height or intrinsic proportions as placeholders. A bounded 500-entry URL cache preserves measurements across row rebuilds and articles; width-changing layout operations invalidate affected measurements. Content and spacer share one grid area, so their heights are not added. Loading indicators, errors, and unsupported links must not leave permanent blank spacers. Browser scroll anchoring handles ordinary layout changes. [Slot measurements and cleanup](../src/render/inline_preview_slot.js), [placeholder decisions](../src/js/lazy_media.js), [grid rules](../src/css/main.css).

## Failures, proxies, and caches

The loading indicator represents both URL resolution and download without claiming a measured percentage. Each image candidate receives its initial request plus two retries, delayed by 300 and 600 ms. Exhausting candidates displays a clickable failure prompt that restarts the list. Requests keep their original URLs rather than adding cache-busting parameters. [Image load and retry state](../src/components/ImagePreviewer.jsx).

These retry rules apply to image downloads. Unsupported URLs or rejected resolvers render no inline content, album lookup failure becomes an empty album, and video/iframe components use separate loading state. `FallbackImage` has no general download deadline: a request that never produces load/error can keep displaying its loading indicator. [Resolver and media error paths](../src/components/ImagePreviewer.jsx).

The image proxy defaults on with individual Imgur, X/Twitter, Catbox, and Tenor switches. Image candidates retain direct-host fallbacks; Tenor uses the Worker to resolve a page rather than proxy video bytes. Ordinary image requests omit Referer, except hosts such as `verb.tw` that require it. The viewer copies the successfully loaded preview's policy before requesting that same URL. [Proxy configuration and candidates](../src/js/image_proxy.js), [defaults](../src/js/pref_storage.js), [Worker fallback](../proxy/imgur-worker/src/index.js), [media loading](../src/components/ImagePreviewer.jsx), [viewer policy](../src/js/image_viewer.js).

URL-resolution promises, Imgur probe promises, layout measurements, and browser/Worker image-byte caches have different lifetimes. Proxy preference changes leave already resolved URLs cached, so the current preference handler documents refresh semantics. Reusing a preview URL avoids another host-resolution or album lookup, but the browser can still revalidate image bytes. [Resolution cache](../src/components/ImagePreviewer.jsx), [probe cache](../src/js/imgur_probe.js), [preference updates](../src/js/pttchrome.jsx).

## Android and interaction boundaries

The APK uses the shared web renderer. External article links open through the system browser, while preview-image activation opens the in-page viewer. The installed APK's web-page revision must be checked before attributing local source changes to its current behavior. [Android navigation](../android/app/src/main/java/io/github/abccbaandy/pttchrome/MainActivity.kt), [page-version distinction](domain-overview.md#the-apk-and-its-reading-page-have-separate-versions).

Media hit areas take priority over terminal click navigation; blank space beside a preview passes through. Inline image context menus are handed to the browser rather than recreated by the application. This handoff does not promise that Android WebView supplies every desktop save/search menu entry. [Hit targets](../src/js/preview_targets.js), [pointer-event rules](../src/css/main.css), [context-menu handling](../src/components/ContextMenu/index.jsx).

## Related coverage

Offline browser coverage is in [image_viewer.offline.spec.js](../tests/e2e/offline/image_viewer.offline.spec.js), [mobile_image_viewer.offline.spec.js](../tests/e2e/offline/mobile_image_viewer.offline.spec.js), [image_gray.offline.spec.js](../tests/e2e/offline/image_gray.offline.spec.js), and [merge-image-caption.offline.spec.js](../tests/e2e/offline/merge-image-caption.offline.spec.js). These are coverage locations; this note does not claim that the tests passed.

See [Image Viewer Integration](image-viewer-design.md) for the library choice, gesture settings, and modal lifecycle. The [author's PTT discussion](https://www.ptt.cc/bbs/Browsers/M.1786265274.A.5E3.html) provides historical context on preview hit areas and image proxying. [Upstream issue #74](https://github.com/abccbaandy/PttChrome/issues/74) concerns scrolling-test reliability around placeholders, rather than establishing an unresolved application defect.
