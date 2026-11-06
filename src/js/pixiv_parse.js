// Optional Pixiv lookup candidates, expressed in terminal-cell columns. Finding
// a number never starts a request or decides whether it denotes a user/artwork.
import { rangeInTermUrl } from "./term_url_flag";

export const MAX_PIXIV_ID_DIGITS = 15;

export function isPixivId(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_PIXIV_ID_DIGITS && value[0] !== "0" && !/[^0-9]/.test(value);
}

const digit = ch => !!ch && ch >= "0" && ch <= "9";
const whitespace = ch => typeof ch === "string" && /^\s$/u.test(ch);

// `ann` is the existing comment annotation. Merged comment callers replace
// contentCol/contentEnd with the merged sequence's contentStart/tailStart;
// original row coordinates cannot describe the reconstructed multiline block.
// Modern comment headers have no content and are deliberately excluded.
export function detectPixivIds(chars, text, ann) {
  if (!chars?.length || ann?.hidden || ann?.modern) return [];
  let start = 0;
  let end = chars.length;
  if (ann?.userid || Number.isInteger(ann?.contentCol)) {
    if (!Number.isInteger(ann.contentCol) || !Number.isInteger(ann.contentEnd)) return [];
    start = Math.max(0, ann.contentCol);
    end = Math.min(chars.length, ann.contentEnd);
  }

  // Preserve terminal columns while classifying complete characters. Neither
  // a DBCS trail byte nor an unknown/sparse cell can masquerade as a delimiter.
  // The Big5 full-width space is A1 40; Unicode wide spaces use WIDE_TRAIL.
  const ascii = new Array(chars.length);
  const spaces = new Array(chars.length);
  for (let i = 0; i < chars.length; ++i) {
    const cell = chars[i];
    if (cell?.isLeadByte) {
      const next = chars[i + 1];
      const big5Space = cell.ch === "\xa1" && next?.ch === "\x40";
      const unicodeSpace = whitespace(cell.ch) && next?.ch === "\uffff";
      if (big5Space || unicodeSpace) spaces[i] = spaces[i + 1] = true;
      ++i;
    } else if (cell?.ch?.length === 1) {
      spaces[i] = whitespace(cell.ch);
      if (cell.ch.charCodeAt(0) < 0x80) ascii[i] = cell.ch;
    }
  }

  const found = [];
  for (let i = start; i < end; ++i) {
    if (!digit(ascii[i])) continue;
    const from = i;
    let query = "";
    while (i < end && digit(ascii[i])) query += ascii[i++];
    // Trusted comment content boundaries also count as start/end. In a merged
    // block, its synthetic newline is whitespace, never an ID continuation.
    const leftBoundary = from === start || spaces[from - 1] === true;
    const rightBoundary = i === end || spaces[i] === true;
    if (isPixivId(query) && leftBoundary && rightBoundary && !rangeInTermUrl(chars, from, i)) {
      found.push({ startCol: from, endCol: i, query });
    }
    --i;
  }
  return found;
}
