// The board's poll results (#301): `R` on the easy-reading article list, 投票結果
// in the desktop context menu and in the mobile toolbar's More.
//
// PTT's `R` (bbs.c#bbs_cmd_poll_results → poll.c#poll_results) runs
// more(<board>/results, YEA): pmore with its footer prompt (a page at a time,
// no auto exit, no pressanykey: ←/q leave and PTT draws the list)
// (docs/pttbbs-screen-protocol.md, "The poll results"). A board without a
// results file makes more() return -1 before it draws anything, and
// vmsg(「目前沒有任何投票的結果。」) waits at the last row over the list, as a
// banner (「 ◆ … [按任意鍵繼續]」). The digest list's table has no `R`.
//
// The results are long coloured text in PTT's 80 columns, so they show on the
// page of PTT's own screen (screen_page.js, shared with the board entry
// screen) over the list, paging by PTT's own pager. Leaving sends the pager's
// ←. The banner is not shown: its message is read, the one key it waits for
// is sent, and the list comes back with PTT's message as a hint. No real
// result screen has been seen; the shapes come from the source.
import { parseVmsgText } from './push_screen';
import { parseStatusRow } from './string_util';
import { LIST_UNDER, ScreenPage } from './screen_page';
import { BOARD_NOTES } from './board_notes';

const KEY_LEAVE = '\x1b[D';
const KEY_DISMISS = ' ';
const BANNER_FLOAT = /\[按任意鍵繼續\]/;

// The message of a vmsg banner on PTT's last row, or null.
function bannerMessage(facts) {
  const last = facts.rowTexts[facts.rows - 1] || '';
  return BANNER_FLOAT.test(last) ? parseVmsgText(last) : null;
}

export const POLL_RESULTS = Object.freeze({
  source: 'pollResults',
  marker: 'board-notes',
  record: 'board-notes',
  step: 'poll-results',
  keys: 'R',
  words: Object.freeze({
    title: 'pollResults_title', unavailable: 'pollResults_unavailable', failed: 'pollResults_failed',
    busy: 'pollResults_busy', wait: 'pollResults_wait', screen: '投票結果'
  }),
  under: LIST_UNDER,
  // An article list, not the digest list.
  available(core) {
    const ls = core.listSession;
    return BOARD_NOTES.available(core) && !(ls.isDigestList && ls.isDigestList());
  },
  subtitle: BOARD_NOTES.subtitle,
  // A board without results: the banner's one key, and PTT's message as the
  // hint of the list that comes back.
  entryMessage(facts) {
    const message = bannerMessage(facts);
    return message == null ? null : { key: KEY_DISMISS, hint: message };
  },
  // pmore's page leaves with ←; a banner (the failure path shows the screen)
  // with any key.
  decide(facts) {
    if (bannerMessage(facts) != null) return { action: 'skip', key: KEY_DISMISS, shape: 'pause' };
    const last = facts.rowTexts[facts.rows - 1] || '';
    return parseStatusRow(last) ? { action: 'skip', key: KEY_LEAVE, shape: 'pager' } : { action: 'wait' };
  }
});

export class PollResults extends ScreenPage {
  constructor(core) {
    super(core, POLL_RESULTS);
  }
}

// Show the board's poll results (`R`, the context menu, More). Returns whether
// `R` was sent; when not, a hint says why.
export function showPollResults(core) {
  const page = core && core.pollResults;
  return !!page && page.start();
}
