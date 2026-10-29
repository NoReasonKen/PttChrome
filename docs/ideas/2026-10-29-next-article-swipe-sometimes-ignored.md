# Next-Article Swipe Sometimes Ignored

- Date: 2026-10-29 (Asia/Taipei)
- Status: Likely cause found 2026-10-30 (code reading only), not fixed

## Problem

At the end of an article, the gesture that opens the next article from the 「下一篇」 card occasionally has no effect. Tapping the card still works.

## Desired behavior

The gesture opens the next article as reliably as tapping the card.

## Context

- The gesture and the card are described in `docs/next-article.md` and implemented in `src/js/pull_next_article.js` and `src/js/next_article.js`.
- The report does not say which device or which conditions trigger it; a reproduction or a debug recording would narrow it down.

## Research (2026-10-30)

Code reading only: the cause below matches the report but is not confirmed on a device.

- **Most likely cause: a pull that starts on the card is ignored on purpose.** `pull_next_article.js#ignoredTarget` excludes the 「下一篇」 card itself (`#` + `NEXT_ARTICLE_ID`) so that a tap on it goes to the click handler. At the end of an article the card covers a large part of the screen, so pulling up from it never starts the gesture while tapping it works, which is the reported symptom.
- **Other candidates:**
  - `atScrollBottom` misses the bottom by a fraction of a pixel when the pull starts (fractional `scrollTop` on high-DPR screens; the check allows 1px).
  - A diagonal pull: more horizontal than vertical movement cancels it.
  - A small scroll during the pull resets it.
- **Likely fix:** let a pull start on the card too, and treat a release below the threshold as a tap.
- **To confirm:** capture a debug recording the next time it happens.
