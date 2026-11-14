// The refusal both easy-reading lists give to input they do not present
// (#159 article list, #192 board list): a key, a footer button, pasted text or
// typed text that belongs to no feature easy reading shows is not passed to
// PTT. The reader is told so at error level, which shows even with status
// hints off: a refused input is never silent. The wording itself lives in
// unsupported_hint.js, shared with every easy-reading page.
import { HINT_ERROR } from './status_hint';
import { UNSUPPORTED_KEY_HINT, unsupportedPasteHint, unsupportedTextHint } from './unsupported_hint';

const REFUSAL_HINT_MS = 4000;

// what: 'key' | 'paste' | 'text'.
export function refuseUnsupported(view, what) {
  if (!view || !view.flashListHint) return;
  view.flashListHint(
    what === 'paste'
      ? unsupportedPasteHint('列表')
      : what === 'text'
        ? unsupportedTextHint('列表')
        : UNSUPPORTED_KEY_HINT,
    REFUSAL_HINT_MS,
    HINT_ERROR
  );
}
