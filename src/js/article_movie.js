// An article's ANSI animation (#300): `p` in an easy-reading article, 播放動畫
// in the desktop context menu and in the mobile toolbar's More.
//
// pmore's `p` (pmore.c#pmore_cmd_movie, also `P`) plays the article as a movie
// (docs/pttbbs-screen-protocol.md, "An article's animation"):
//   a movie            plays from where pmore shows the article (Home first,
//                      so it plays from its start): 「動畫播放中… 可按 q,
//                      Ctrl-C 或其它任意鍵停止」 on the last row, 「互動式動畫
//                      播放中…」 (its choices one row above), paused 「暫停播放
//                      動畫，請按任意鍵繼續或 q 中斷。」; any key stops a plain
//                      one (the key is used up), an interactive one takes keys
//                      as its choices but q and Ctrl-C always stop it (at a
//                      choice with 「已強制中斷互動式系統」, a vmsg); when it ends
//                      or stops, pmore shows the article again, at the movie's
//                      last frame
//   no movie           pmore asks 「這可能是傳統動畫檔, 若要直接播放請輸入速度
//                      (秒): 」 (default 1) to page through the article as a
//                      classic animation; Enter plays it, Ctrl-C clears the
//                      answer and the article comes back. On a terminal that is
//                      not 24 rows it asks 「傳統動畫是以 24 行為單位設計的…[Yn]」
//                      next, and Ctrl-C there still plays.
// The animation is shown on the page of PTT's own screen (screen_page.js,
// shared with the board entry screen, #292) over the article, which stays on
// screen under it as an operation over the article (ARTICLE_UNDER,
// article_hold.run): a copy of it at the reader's line covers the reading
// area while easy reading mirrors PTT natively (functionMode) without drawing
// its frames, and the article is easy reading's again when pmore shows it,
// at the reader's line (the reading record).
//
// An article that is no movie is followed as pmore does: the page shows its
// question, with a hint; the reader can answer it on the page, or leave
// (Ctrl-C). Whether an article is a movie cannot be told cheaply before `p`
// (pmore decides from its first page, and easy reading hides the question it
// asks there), so every entrance offers `p` on every article.
import { functionModeExitDecision } from './easy_reading';
import { articlePresented } from './article_hold';
import { recordFor } from './reading_record';
import { parseStatusRow } from './string_util';
import { ScreenPage, screenFacts } from './screen_page';

const SOURCE = 'articleMovie';
const KEY_HOME = '\x1b[1~';
const KEY_BREAK = 'q';
const KEY_CLEAR = '\x03';

const PAUSED_RE = /暫停播放動畫/;
const STOPPED_RE = /已強制中斷互動式系統/;
const INTERACTIVE_RE = /互動式動畫播放中/;
const PLAYING_RE = /動畫播放中/;
const QUESTION_RE = /這可能是傳統動畫檔|傳統動畫是以 24 行/;

// What PTT's screen waits for while the page shows (screen_page's decide).
// Only the last two rows and the cursor are read: a movie's frames draw
// anything above them.
//   paused, interactive   q: it always stops the movie (Home could be a
//                         choice's key)
//   playing               Home: any key stops a plain movie and is used up;
//                         one that lands on the article after the movie
//                         ended only moves pmore to its top
//   a question            Ctrl-C (the classic animation's speed; the 24-row
//                         question then plays, and the movie is stopped next)
//   stopped (a vmsg)      Home, as any key; the page leaves on a tap too
export function articleMovieDecision(facts) {
  const f = facts || {};
  const rowTexts = f.rowTexts || [];
  const rows = f.rows || rowTexts.length;
  const last = rowTexts[rows - 1] || '';
  const above = rowTexts[rows - 2] || '';
  if (PAUSED_RE.test(last)) return { action: 'skip', key: KEY_BREAK, shape: 'movie' };
  if (STOPPED_RE.test(last)) return { action: 'skip', key: KEY_HOME, shape: 'pause' };
  if (INTERACTIVE_RE.test(last) || INTERACTIVE_RE.test(above))
    return { action: 'skip', key: KEY_BREAK, shape: 'movie' };
  if (PLAYING_RE.test(last)) return { action: 'skip', key: KEY_HOME, shape: 'movie' };
  if (QUESTION_RE.test(above) && f.curY === rows - 2) return { action: 'skip', key: KEY_CLEAR, shape: 'input' };
  return { action: 'wait' };
}

// What easy reading makes of PTT's screen now: 'resume' (the article's pager),
// 'leave' (a list or a menu) or 'stay' (easy_reading.functionModeExitDecision).
function articleScreen(core) {
  const buf = core.buf;
  if (!buf) return 'stay';
  const lastRowNum = buf.rows - 1;
  return functionModeExitDecision({
    pageState: buf.pageState,
    isStatusRow: !!parseStatusRow(buf.getRowText(lastRowNum, 0, buf.cols)),
    curY: buf.cur_y,
    lastRowNum
  });
}

function enqueue(core, step) {
  if (!core.commandQueue) return false;
  // A flushed key is as unanswered as a timed-out one.
  core.commandQueue.enqueue({ ...step, onFlushed: () => step.onFail('flushed') });
  return true;
}

// The article held under the page: the page runs as an operation over the
// article (article_hold.run), which keeps a copy of the article at the
// reader's line over the reading area. Easy reading mirrors PTT natively from
// the asking key on (functionMode: its frames are held, not drawn) and stays
// so while the page holds (easy_reading._onScreenSettled). When pmore shows
// the article again, the reader's line is asked for (the reading record's
// 'article-movie' row) and the operation ends (article_hold.done): easy
// reading takes the frame back and the copy lifts once the line is restored.
// PTT showing a list or a menu instead (a q that reached the article after
// the movie ended) is not guessed at: the operation fails and the article is
// held with a message (article_hold.fail).
export const ARTICLE_UNDER = Object.freeze({
  begin(core, kind) {
    // The reader's line, before the native mirror.
    const bm = recordFor(core).begin(kind.record, { view: core.view, buf: core.buf });
    // ARTICLE_MOVIE.available() saw the article presented, nothing run over it.
    core.articleHold.run(SOURCE, { cover: true });
    core.easyReading._enterFunctionMode();
    return bm;
  },
  send: enqueue,
  continue: enqueue,
  back: (core) => articleScreen(core) === 'resume',
  // The pager drawn by the asking key's Home is a frame on the way.
  entryBack: false,
  // A movie draws its footer on every frame: a frame that looks like a list
  // is the movie's.
  lost: (core) => articleScreen(core) === 'leave' &&
    articleMovieDecision(screenFacts(core.buf)).action !== 'skip',
  // The line is asked for first: the copy lifts once it is restored.
  takeBack: (core, end) => {
    end();
    core.articleHold.done(SOURCE);
  },
  // The connection closed: no article to restore.
  drop: () => {},
  hold: (core) => core.articleHold.fail(SOURCE, {
    reason: 'article-movie: left the article', message: 'articleMovie_lost'
  }),
  // Over the article's copy (hidden_article_route.coverWithArticle).
  pageClass: 'overArticleCover'
});

// The article animation's kind of page (screen_page.js).
export const ARTICLE_MOVIE = Object.freeze({
  source: SOURCE,
  marker: 'article-movie',
  record: 'article-movie',
  step: 'article-movie',
  // From the article's top: pmore plays from where it shows the article.
  keys: KEY_HOME + 'p',
  words: Object.freeze({
    title: 'articleMovie_title', unavailable: 'articleMovie_unavailable', failed: 'articleMovie_failed',
    busy: 'articleMovie_busy', wait: 'articleMovie_wait', screen: '動畫'
  }),
  under: ARTICLE_UNDER,
  // Easy reading presents an article (a mail too: pmore plays it the same
  // way) and nothing runs over it.
  available(core) {
    if (core.connectState !== 1 || !core.easyReading || !core.commandQueue) return false;
    if (core.aidNavigation && core.aidNavigation.active) return false;
    if (!core.articleHold || !articlePresented(core)) return false;
    return !core.articleHold.running && !core.articleHold.held;
  },
  subtitle: (core) => core.view?._articleTitle || '',
  decide: articleMovieDecision,
  shownHint: (d) => (d.action === 'skip' && d.shape === 'input' ? 'articleMovie_notMovie' : null)
});

export class ArticleMovie extends ScreenPage {
  constructor(core) {
    super(core, ARTICLE_MOVIE);
  }
}

// Play the article's animation (`p`, the context menu, More). Returns whether
// the keys were sent; when not, a hint says why.
export function showArticleMovie(core) {
  const movie = core && core.articleMovie;
  return !!movie && movie.start();
}
