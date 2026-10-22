# Image Preview Behavior

Static source review at `70aaac2b16277597d2acf6ebd2031b2d8f30019a`, prioritizing article easy reading and the Android app, with external discussion context noted below. No application behavior was changed; no browser or device tests, live image-host probes, or application test suites were run. Source-linked tests describe existing coverage, not newly verified results.

## Reading experience and shared implementation

Article easy reading inserts previews below recognized links in the accumulated article, including links in comments. It disables floating hover previews because the media is already inline. The native PTT view instead uses hover previews, while article-list easy reading and temporary native prompt screens do not insert article previews. These choices belong to the shared renderer, rather than an Android-specific image feature. [Article rendering branches](../src/js/term_view.js#L810), [inline article rendering](../src/js/term_view.js#L946), [native branch](../src/js/term_view.js#L995).

The flow is:

1. Terminal cells and annotations identify a link and its full URL.
2. The row renderer preserves the clickable text and creates an inline preview slot.
3. A nearby slot mounts `ImagePreviewer`, which resolves the URL into an image, video, iframe, or album descriptor.
4. The media component loads that descriptor; the slot manages its lifetime and occupied space.

Both rendering modes use `ScreenController`. Inline previews are React leaf components inside the plain DOM screen, with explicit destruction when rows disappear. [Shared renderer](../src/js/term_ui.js#L41), [link and slot creation](../src/render/link_segment.js#L356), [descriptor resolution](../src/components/ImagePreviewer.jsx#L46), [slot mounting](../src/render/inline_preview_slot.js#L499), [row disposal](../src/render/screen.js#L126).

The original URL remains a separate external link. Clicking its text and clicking the displayed image have different meanings. Wrapped URLs create their preview only at the final segment, so a multi-line URL does not produce one image per segment. Automatically repaired URLs can also have previews without rewriting the original article text. [Link element](../src/render/link_segment.js#L20), [wrapped-link slot rule](../src/render/link_segment.js#L369), [repaired links](../src/render/link_segment.js#L33).

## Eligibility and preferences

`enableEasyReading` and `enablePicPreview` both default to `true`, but their names do not imply a shared gate. Current article easy-reading branches pass `inlinePreview: true` directly. `enablePicPreview` is read by the native hover branch; its preference handler only updates that field. Static review found no alternate mobile gate that makes it an inline auto-open switch. Therefore, do not promise that turning off this preference disables article easy-reading previews. [Defaults](../src/js/pref_storage.js#L5), [inline flags](../src/js/term_view.js#L973), [native preference use](../src/js/term_view.js#L1002), [preference handler](../src/js/pttchrome.jsx#L2226).

An ordinary recognized URL gets a slot before the resolver decides whether it is media. Unsupported URLs resolve to an error and render no inline media; a slot is not proof that the URL is an image. Bare-domain links and X mentions deliberately do not create inline previews. [URL slot creation](../src/render/link_segment.js#L356), [unsupported resolver](../src/components/ImagePreviewer.jsx#L755), [inline resolution error](../src/components/ImagePreviewer.jsx#L427), [bare domains](../src/render/link_segment.js#L308), [mentions](../src/render/link_segment.js#L257).

## Supported links and media types

Resolvers are ordered from specific hosts to generic file extensions. They return media descriptions; rendering is shared across hosts. A URL ending in an image-looking extension is not universally proof of an image: Tenor sharing pages are explicitly handled before the generic extension rule. [Resolver ordering](../src/components/ImagePreviewer.jsx#L547), [Tenor recognition](../src/js/image_url_detect.js#L23).

| Link family | Current behavior | Source |
| --- | --- | --- |
| Direct image files | JPEG, PNG, GIF, WebP, APNG, AVIF, SVG, and other listed extensions become images. | [Extension patterns](../src/js/image_url_detect.js#L7), [generic resolver](../src/components/ImagePreviewer.jsx#L745) |
| Imgur single image or sharing URL | Converts to direct media; known static images prefer WebP with an original-format fallback. Ambiguous URLs are probed to preserve animation. | [Imgur resolver](../src/components/ImagePreviewer.jsx#L565), [static candidates](../src/components/ImagePreviewer.jsx#L481) |
| Imgur album or gallery | Fetches album information and expands the returned media entries in order. Album fetch failure becomes an empty album. | [Album API](../src/components/ImagePreviewer.jsx#L533), [album resolver](../src/components/ImagePreviewer.jsx#L550) |
| X/Twitter image URL | Tries original-size media with format/size fallbacks; can use the configured image proxy. | [Resolver](../src/components/ImagePreviewer.jsx#L586), [candidate list](../src/js/image_proxy.js#L94) |
| meee sharing URL | Builds direct image URLs and tries several likely extensions. | [Resolver](../src/components/ImagePreviewer.jsx#L601) |
| Catbox image file | Uses proxy-first candidates when eligible, otherwise the original URL. | [Resolver](../src/components/ImagePreviewer.jsx#L718) |
| Flickr sharing URL | Uses Flickr metadata to construct a direct image URL. | [Resolver](../src/components/ImagePreviewer.jsx#L656) |
| Direct MP4/WebM/OGG | Uses an inline video element, rather than an image. | [Video pattern](../src/js/image_url_detect.js#L9), [resolver](../src/components/ImagePreviewer.jsx#L736) |
| YouTube and Twitch clips | Uses an embedded player iframe. | [YouTube resolver](../src/components/ImagePreviewer.jsx#L623), [Twitch resolver](../src/components/ImagePreviewer.jsx#L642) |
| Tenor sharing page | Uses the configured Worker to resolve media, then displays a muted, looping, automatically playing video. Disabled proxy/resolution means no preview. | [Resolver](../src/components/ImagePreviewer.jsx#L691), [video playback behavior](../src/components/ImagePreviewer.jsx#L351) |

Most inline videos have playback controls and do not automatically play; Tenor's GIF-like descriptor is the explicit exception. Hover previews only display image descriptors, excluding videos, iframes, and albums. [Inline video](../src/components/ImagePreviewer.jsx#L355), [hover filtering](../src/components/ImagePreviewer.jsx#L118).

For ambiguous Imgur links, two parallel HEAD requests examine image content type and MP4 availability. GIF originals remain GIFs; video assets use MP4; confirmed static images can use WebP. Probe requests have a three-second abort timer when AbortController is available, and failures degrade to the existing JPG image path. This probe timeout is separate from image-download behavior. [Classification](../src/js/imgur_probe.js#L22), [probe execution](../src/js/imgur_probe.js#L50), [fallback mapping](../src/components/ImagePreviewer.jsx#L488).

## Loading during scrolling

The slot defers the entire resolver and media component until it approaches the reading viewport. Current margins are 1,500 CSS pixels for mounting and 6,000 for unloading distant previews. The wider unloading margin avoids repeated mounting around one threshold. Shared observers use the actual `.main` scroll container; long-page chunk visibility also participates in the decision. [Margins and decision](../src/js/lazy_media.js#L15), [observer roots](../src/render/inline_preview_slot.js#L188), [chunk visibility](../src/render/inline_preview_slot.js#L675).

Unloading releases the mounted media component, but keeps remembered height or intrinsic proportions as a placeholder. Scrolling back mounts it again; it need not resolve the URL again because descriptor promises are cached. Unsupported/error/loading-only content must not become a permanent blank spacer. [Unmount decision and measurement](../src/render/inline_preview_slot.js#L560), [placeholder rules](../src/js/lazy_media.js#L37), [resolution cache](../src/components/ImagePreviewer.jsx#L28).

Height records are separate for small images, enlarged images, and each zoom step. A single image's intrinsic dimensions can generate a correctly sized placeholder before it remounts. Measurements are remembered in a bounded 500-entry URL cache across slot rebuilds and articles; width-changing layout operations invalidate suitable height measurements. [Mode-specific heights](../src/js/lazy_media.js#L51), [aspect records](../src/js/lazy_media.js#L81), [size cache](../src/render/inline_preview_slot.js#L97), [invalidation](../src/render/inline_preview_slot.js#L148).

The content and spacer overlap in one grid area, so their heights are not added. Browser scroll anchoring handles ordinary media changes; image-size toggles additionally preserve an anchor around the clicked image. These mechanisms aim to preserve reading position, but do not establish that every possible scroll sequence is bug-free. [Grid layout](../src/css/main.css#L1350), [image anchor compensation](../src/render/screen.js#L479).

## Display size, image actions, and related layout

Normal images are centered with height and width limits of `19em` and `39em`; mobile article reflow additionally caps width at the available viewport. [Normal sizing](../src/css/main.css#L656), [mobile width](../src/css/main.css#L271).

Clicking a displayed preview image toggles the size of **all article images** between the normal display and full available width. It does not open a dedicated image viewer. The clicked image supplies the reading-position anchor. The setting survives more pages arriving in the same article and resets when the article identity changes. [Click behavior](../src/render/screen.js#L485), [full-width CSS](../src/css/main.css#L668), [article reset](../src/render/screen.js#L335).

Image controls also offer article-wide zoom steps from 50% to 400%. Full-width enlargement takes precedence while retaining the previous zoom for shrinking back. Gray controls apply a temporary CSS grayscale effect per URL, not a rewritten image file; those controls and the zoom bar are created for a slot containing one laid-out image. Their CSS uses hover/focus visibility, so mobile discoverability should be verified on the actual WebView. [Zoom steps](../src/js/image_zoom.js#L1), [zoom event](../src/render/screen.js#L494), [gray state](../src/render/inline_preview_slot.js#L126), [control creation](../src/render/inline_preview_slot.js#L619), [control visibility](../src/css/main.css#L1456).

Image-caption merging is a separate article layout action. It groups an image link and nearby explanation/translation into side-by-side columns. The button cycles image-before-caption matching, caption-before-image matching, and original layout; changing the column width invalidates preview heights. It does not change the image resolver itself. [Grouping rules](../src/js/image_caption_group.js#L1), [toggle cycle](../src/render/screen.js#L568), [column styling](../src/css/main.css#L705).

## Touch, links, and the Android boundary

Preview media takes priority over terminal click navigation. Image-side blank space is not intended to count as image pixels: the slot itself passes pointer events through while media and its controls remain interactive. This distinction matters near the article's return-to-list click region. [Preview hit targets](../src/js/preview_targets.js#L1), [pointer-event rules](../src/css/main.css#L1369).

For image context menus, the web app deliberately returns without preventing the browser's native menu. This is a handoff, not an implementation of save/search actions. It does not prove that an installed Android WebView supplies the same menu entries as desktop Chrome. [Native image targets](../src/js/preview_targets.js#L30), [context-menu handoff](../src/components/ContextMenu/index.jsx#L403).

The inline media renderer uses web images/videos/iframes; it does not call an Android image-preview bridge. The APK separately handles external navigation: article links and new-window URLs are handed to the system browser rather than replacing the BBS page. Its loaded web-page revision must be checked before treating local source behavior as the installed app's exact behavior. [Shared media renderer](../src/components/ImagePreviewer.jsx#L400), [Android navigation](../android/app/src/main/java/io/github/abccbaandy/pttchrome/MainActivity.kt#L276), [new-window forwarding](../android/app/src/main/java/io/github/abccbaandy/pttchrome/MainActivity.kt#L307), [page-version distinction](domain-overview.md#the-apk-and-its-reading-page-have-separate-versions).

## Failures, retries, proxying, and cache scope

The loading indicator covers URL resolution and media download without claiming a measured percentage. Images stay hidden until their load event and request asynchronous decoding. [Indicator](../src/components/ImagePreviewer.jsx#L156), [image loading](../src/components/ImagePreviewer.jsx#L274).

Each image candidate receives its initial attempt plus two retries, with 300 ms and 600 ms backoff. Exhausting candidates shows a clickable failure prompt; clicking it restarts the candidate list. Retries do not append cache-busting parameters. These rules belong to images, not every resolver/video/iframe failure. [Retry constants and error handling](../src/components/ImagePreviewer.jsx#L179), [manual retry](../src/components/ImagePreviewer.jsx#L258).

There is no general image-download deadline in `FallbackImage`: retries begin on an error event, so a request that never finishes can retain the loading indicator. Resolver rejection instead produces no inline content; album lookup failure becomes an empty album. Video/iframe components have loading state but do not share the image retry prompt. [Image events](../src/components/ImagePreviewer.jsx#L283), [inline error behavior](../src/components/ImagePreviewer.jsx#L427), [album fallback](../src/components/ImagePreviewer.jsx#L533), [video and iframe state](../src/components/ImagePreviewer.jsx#L355).

The shared proxy defaults on for Imgur, X/Twitter, Catbox, and Tenor, with individual site switches and a configurable endpoint. Image candidates prefer eligible proxy URLs and retain direct-host fallbacks. Video bytes are not sent through this image proxy. Tenor uses the Worker to resolve a sharing page, not to proxy its video bytes. [Preference defaults](../src/js/pref_storage.js#L138), [site gates](../src/js/image_proxy.js#L16), [Imgur candidates](../src/js/image_proxy.js#L55), [other candidates](../src/js/image_proxy.js#L94), [Tenor descriptor resolution](../src/components/ImagePreviewer.jsx#L701).

The Worker redirects to the original image when upstream fetches fail or return non-image content, and successful image responses carry cache headers. The image element normally omits Referer, except hosts such as `verb.tw` that require it. These are current source policies; historical latency measurements are not new measurements in this research. [Worker fallback](../proxy/imgur-worker/src/index.js#L315), [cache headers](../proxy/imgur-worker/src/index.js#L227), [Referer exception](../src/components/ImagePreviewer.jsx#L169).

Resolution promises are cached by URL, Imgur probe promises by ID, and layout measurements by URL. These are distinct from image-byte browser/Worker caching. Changing proxy preferences does not redraw or clear already resolved URLs; the preference handler explicitly documents refresh semantics. [Resolution cache](../src/components/ImagePreviewer.jsx#L28), [probe cache](../src/js/imgur_probe.js#L45), [measurement cache](../src/render/inline_preview_slot.js#L97), [preference update](../src/js/pttchrome.jsx#L2231).

Destroyed rows disconnect both observer subscriptions, remove image controls, and unmount their React preview roots. Pending resolver results are ignored by an inactive React effect; that alone does not promise cancellation of every underlying network request. [Slot destruction](../src/render/inline_preview_slot.js#L698), [effect cleanup](../src/components/ImagePreviewer.jsx#L74).

## Existing test evidence and limits

| Area | Relevant coverage |
| --- | --- |
| Inline wiring and unsupported URLs | [image_preview.test.js](../tests/unit/image_preview.test.js#L62) |
| URL classification, animation preservation, host/proxy candidates | [image_url_detect.test.js](../tests/unit/image_url_detect.test.js#L1), [imgur_probe.test.js](../tests/unit/imgur_probe.test.js#L1), [imgur_webp_resolver.test.jsx](../tests/unit/imgur_webp_resolver.test.jsx#L1), [image_proxy_resolver.test.jsx](../tests/unit/image_proxy_resolver.test.jsx#L1) |
| Candidate retry and failure UI | [fallback_image.test.jsx](../tests/unit/fallback_image.test.jsx#L1), [offline image conditions](../tests/e2e/offline/image_load_conditions.offline.spec.js#L78) |
| Lazy mounting, size memory, placeholder dimensions | [lazy_inline_preview.test.js](../tests/unit/lazy_inline_preview.test.js#L1), [preview margin regression](../tests/e2e/offline/lazy_preview_margin.offline.spec.js#L1), [non-media blank-space regression](../tests/e2e/offline/lazy_preview_blank.offline.spec.js#L23) |
| Enlargement followed by unloading, shrinking, and scrolling back | [placeholder regression](../tests/e2e/offline/lazy_preview_enlarge_blank.offline.spec.js#L102) |
| Zoom, grayscale, and image-caption layouts | [image_zoom.offline.spec.js](../tests/e2e/offline/image_zoom.offline.spec.js#L1), [image_gray.offline.spec.js](../tests/e2e/offline/image_gray.offline.spec.js#L1), [merge-image-caption.offline.spec.js](../tests/e2e/offline/merge-image-caption.offline.spec.js#L1) |
| Reading position with previews above the viewport | [reading_position_preview.test.js](../tests/unit/reading_position_preview.test.js#L1) |

The slow-image E2E case explicitly observes the loading interval and eventual successful rendering. This is stronger than checking the final image alone, but existing cases still do not establish every Android touch sequence, image host response, or real network condition. [Slow-loading assertions](../tests/e2e/offline/image_load_conditions.offline.spec.js#L172).

## Author discussions and upstream issue context

The supplied PTT discussion includes author updates about image-side blank space blocking navigation, adding X/Twitter and Catbox proxying, the APK loading the shared page, and configurable floating image-caption controls. These explain feature intent and previous reports; current implementation should still be checked against source. [Author discussion](https://www.ptt.cc/bbs/Browsers/M.1786265274.A.5E3.html).

An upstream CI issue discusses a placeholder regression test whose absolute scroll coordinates interacted with browser scroll anchoring. The follow-up changed test scrolling to use the actual current position and real bottom, with trace evidence. This is evidence of a test-reliability problem, not proof of an unresolved image-preview defect in the application. [Issue #74 discussion](https://github.com/abccbaandy/PttChrome/issues/74#issuecomment-6106217992), [follow-up #75](https://github.com/abccbaandy/PttChrome/pull/75).

## Boundaries for the next report

A useful report can distinguish: URL text versus displayed media; static image versus animated image/video; small versus enlarged/zoomed display; first load versus returning after a long scroll; ordinary article layout versus image-caption merging; and app behavior versus the external browser. These distinctions follow the separate branches above and do not assume which one contains the user's forthcoming problem.
