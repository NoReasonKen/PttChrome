# Reproducing layout and scroll failures

## Keep scroll regressions capable of failing

Use `tests/e2e/helpers/layout.js#assertScrollCapacity(page, selector, offset)`
when testing scroll resets. It measures real browser overflow without moving the
reader and fails when the container could not retain the supplied positive offset.
A short destination can clamp the old position to zero even when the application
does not reset it, making a defective implementation appear correct.

After scrolling the source with real input, wait for stability and establish a
positive source position. After navigation settles, check that the destination
has enough overflow before asserting the expected reset. If the source was at
the bottom, use a smaller positive offset for the destination: retaining part of
the old position would still expose the defect, and source-only controls may
make the source taller. The article-navigation-origin tests exercise this
contract with long, wrapping articles at a tall mobile viewport.

## Preserve images for visual review

The shared local E2E runner uses a compact line reporter. Set `E2E_ARTIFACT_DIR`
when a run needs durable image attachments:

```bash
WT="$PWD" WAIT=1800 E2E_ARTIFACT_DIR="$PWD/tmp/review-images" \
  <primary>/scripts/e2e-when-idle.local.sh offline-mobile \
  tests/e2e/offline/mobile_article_navigation_origin.offline.spec.js \
  --workers=1 --retries=0
```

The runner adds `scripts/e2e-artifacts-reporter.cjs`. Each run receives a unique
directory containing copied PNG/JPEG/WebP attachments and `images.json`. The
summary prints absolute paths. Buffer attachments from passing tests are saved
too; they no longer depend on an HTML reporter or Playwright's temporary output.
An image-copy failure makes the run fail rather than silently losing evidence.

The reporter saves images already attached by tests; it does not take screenshots
or record video for every test. A test can opt into a review screenshot only when
`E2E_ARTIFACT_DIR` is set. Keep the output in a scratch or gitignored directory and
inspect the saved image before claiming visual verification.

## Reuse a capture's viewport

Debug recordings include a numeric/boolean `record.environment` snapshot at the
start, after effective size changes and before stopping. The initial snapshot is also available
as `cassette.meta.environment`, with the initial terminal dimensions on the
cassette. Older recordings retain their previous format.

The snapshot includes CSS viewport size, device pixel ratio, visual viewport
geometry, effective terminal cell dimensions and rendering flags. It contains
no raw preferences or article text. Resize notifications are coalesced and
unchanged snapshots are skipped; receive/send processing adds no measurements.

Before booting an offline reproduction, call:

```js
const { applyRecordedViewport } = require('../helpers/replay');
const environment = await applyRecordedViewport(page, recording);
```

Pass `{ at: milliseconds }` to select the latest snapshot at or before an event.
The helper sets only CSS viewport width and height, returns the full snapshot
for comparison, and leaves legacy recordings unchanged. Existing cassette
terminal-size checks still apply. OS text scaling, device pixel ratio and browser
zoom need a matching device/context configuration; setting a viewport alone does
not emulate them. A capture containing rotation still needs its resize sequence
replayed explicitly.
