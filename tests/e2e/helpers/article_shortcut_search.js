const { expect } = require('@playwright/test');
const ptt = require('./ptt');
const { bootOffline, waitScreenSettled, waitConnected } = require('./replay');
const { bootGestureArticle, revealArticleDrawer, beginArticleTouch } = require('./article_gestures');
const { nextFrames } = require('./real_input');
const { MAIN, recordHints, recordedHints } = require('./stack_routes');

// Controlled PTT boundary, derived from upstream read.c select_read,
// read_cmd_quit, read_loader and bbs.c view_postinfo. The actual application,
// parser, rendering, command queue, touch input and Back dispatch remain real.
async function bootShortcutSearch(page, options = {}) {
  await bootGestureArticle(page);
  await page.evaluate(options => {
    const app = window.__app;
    const encode = text => [...text].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    const state = { surface: 'source', filtered: !!options.filtered, selected: 'source', searched: false, kind: 'author' };
    const frame = () => {
      let rows = {}, cursor = [24, 80];
      if (state.surface === 'source' || state.surface === 'child') {
        const source = state.surface === 'source';
        rows = {
          0: '作者  test (Reader) 看板 Test',
          1: '標題  ' + (source ? '[Test] Source article' : state.kind === 'thread' ? 'Re: [Test] Source article' : '[Test] Result article'),
          2: '時間  Mon Sep  1 12:00:00 2025',
          4: source ? 'Original reading position.' : 'A matching result article.',
          23: '  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~23 行  (y)回應(X%)推文(h)說明(←)離開 '
        };
      } else if (state.surface === 'main') {
        rows = { 0: '【主功能表】', 3: '  (B)oard 看板列表', 23: '我是測試主選單' };
        cursor = [4, 1];
      } else {
        rows = {
          0: '【板主：test】看板《' + (options.wrongBoard && state.searched ? 'Other' : 'Test') + '》',
          1: '[←]離開 [→]閱讀 [^P]發表文章 [b]備忘錄',
          2: '  編號    日 期 作  者       文  章  標  題',
          3: '    101       9/01 test         □ [Test] Source article',
          4: '    102       9/01 test         □ ' + (state.kind === 'thread' ? 'Re: [Test] Source article' : '[Test] Result article'),
          23: state.filtered ? ' 系列文章  [←]離開 [→]閱讀' : ' 文章列表  [←]離開 [→]閱讀'
        };
        cursor = [state.selected === 'source' ? 4 : 5, 1];
        if (state.surface === 'info') {
          rows[18] = '│ 文章代碼(AID): #1gIeu-3A (Test) [ptt.cc] [Test] Source article';
          rows[23] = '請按任意鍵繼續';
          cursor = [24, 1];
        } else if (state.surface === 'authorPrompt') {
          rows[23] = '搜尋作者: ';
          cursor = [24, 11];
        } else if (state.surface === 'empty') {
          rows[23] = ' ◆ 找不到符合條件的文章。 [按任意鍵繼續]';
          cursor = [24, 1];
        } else if (state.surface === 'missing') {
          rows[22] = '找不到這個文章代碼(AID)，可能是文章已消失，或是你找錯看板了';
          rows[23] = '請按任意鍵繼續';
          cursor = [24, 1];
        }
      }
      let data = '\x1b[2J';
      for (const [index, text] of Object.entries(rows)) {
        const inverse = state.surface !== 'source' && state.surface !== 'child' && [0, 2].includes(Number(index));
        const encoded = encode(text);
        // Native title/header bars fill the whole row. Partial inversion is
        // deliberately rejected by the application's list fingerprint.
        data += `\x1b[${Number(index) + 1};1H${inverse ? '\x1b[7m' : ''}${inverse ? encoded.padEnd(80) : encoded}\x1b[0m`;
      }
      return data + `\x1b[${cursor[0]};${cursor[1]}H`;
    };
    const respond = bytes => {
      const command = bytes.replace(/\f/g, '');
      if (command === 'Q') state.surface = 'info';
      else if (command === ' ' && state.surface === 'info') state.surface = 'list';
      else if (command === ' ' && state.surface === 'empty') state.surface = 'list';
      else if (command === ' ' && state.surface === 'missing') state.surface = 'list';
      else if (command === '\x1b[D') {
        if (state.surface === 'source' || state.surface === 'child') state.surface = 'list';
        else if (state.filtered) state.filtered = false;
        else state.surface = 'main';
      } else if (command === 'sTest\r') {
        state.surface = 'list';
      } else if (command === '#1gIeu-3A\r') {
        state.surface = options.deleted && state.searched ? 'missing' : 'list';
        state.selected = 'source';
      } else if (command === 'a') state.surface = 'authorPrompt';
      else if (command === 'S' && state.surface === 'list') {
        state.surface = options.empty ? 'empty' : 'list';
        state.filtered = !options.empty;
        state.selected = 'child';
        state.searched = true;
        state.kind = 'thread';
      }
      else if (command === 'test\r' && state.surface === 'authorPrompt') {
        state.surface = options.empty ? 'empty' : 'list';
        state.filtered = !options.empty;
        state.selected = 'child';
        state.searched = true;
      } else if (command === '\r') state.surface = state.selected;
      else if (/^\d+\r$/.test(command) && state.surface === 'list') {
        // The easy-reading list's number jumps: 101 (1 in results) is the first row.
        const index = Number(command.slice(0, -1)) - (state.filtered ? 1 : 101);
        state.selected = index <= 0 ? 'source' : 'child';
      } else if (['\x1b[1~', '\x1b[4~', '\x1b[5~', '\x1b[6~'].includes(command) && state.surface === 'list') {
        // Home, End and paging: the whole list fits on one page.
      } else if (command) return;
      if (options.pausePrompt && state.surface === 'authorPrompt') return;
      if (options.wrongPrompt && state.surface === 'authorPrompt') state.surface = 'list';
      setTimeout(() => app.onData(frame()), 0);
    };
    window.__gestureSent = [];
    window.__stubWSSent = bytes => {
      window.__gestureSent.push(bytes);
      respond(bytes);
    };
    window.__shortcutServer = { state, frame };
    // Preserve the URL-less identity path: a real shortcut must acquire Q.
    app.onData(frame());
  }, options);
  await waitScreenSettled(page, { 1: 'Source article' });
  // The source replaces the booted article with no navigation edge, as bootImageArticle's own article does.
  await page.evaluate(() => window.__app.easyReading.enterEasyReading());
  await expect(page.locator(SCREEN)).toContainText('Original reading position.');
  await expect(page.locator(MAIN)).toHaveClass(/articleHorizontalGestures/);
  await recordHints(page);
}

// Whether a notice was shown since boot. Notices are brief, so they are
// recorded as they show rather than read from the page.
const hinted = (page, text) => recordedHints(page).then(hints => hints.some(hint => hint.includes(text)));

async function searchAuthor(page) {
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="author"]').tap();
}

// The real screen; a revealed stacked page is a second copy with the same ids.
const SCREEN = `${MAIN} #mainContainer`;
const visibleText = page => page.locator(SCREEN).innerText();

async function waitSearchResults(page) {
  await expect.poll(() => hinted(page, 'Same-author search results')).toBe(true);
  await expect.poll(() => visibleText(page)).toContain('Source article');
}

async function nativeBack(page) {
  await page.goBack();
}

async function openSearchResult(page, { thread = false } = {}) {
  await ptt.sendKey(page, 'Enter');
  await expect(page.locator('#mobileAppBar .mobileAppBarTitle')).toContainText(thread ? 'Re: [Test] Source article' : '[Test] Result article');
  await expect(page.locator(MAIN)).toHaveClass(/articleHorizontalGestures/);
}

// A small controlled board for chained searches. Same protocol sources as
// above: Q leaves an info box over the list, `s<board>` from a result article
// keeps that subset, Left leaves a subset for the full list, #AID selects in
// the full list only, author search is case-insensitive substring matching,
// native S is case-insensitive equality of the reply-stripped subject, and a
// new result list selects its newest entry.
// `fn`: the file name in each article's URL line (aid_codec.aidToFn).
const NESTED_ARTICLES = [
  { aid: '1gIeu-3A', fn: 'M.1783270974.A.0CA', author: 'alice', title: '[Talk] Alpha topic', body: 'Alpha', push: 10 },
  { aid: '1gIeu-3B', fn: 'M.1783270974.A.0CB', author: 'alice', title: '[Talk] Beta topic', body: 'Beta', push: 20 },
  { aid: '1gIeu-3C', fn: 'M.1783270974.A.0CC', author: 'bob', title: 'Re: [Talk] Beta topic', body: 'Charlie', push: 30 },
  { aid: '1gIeu-3D', fn: 'M.1783270974.A.0CD', author: 'bob', title: '[Talk] Delta topic', body: 'Delta', push: 40 }
];

// options.loggedIn: this connection first passes the main menu, as a real
//   login does, so reconnect/open resume may capture and store a plan.
// `homeMenu`: the main menu has My Favorites, so the home dashboard shows on it.
// `dynamicRows`: model negotiated terminal rows separately from application layout.
// `leadingArticles`: that many of alice's articles come before Alpha, so her
//   search results list them above Alpha and Beta.
// `alphaLines`: Alpha runs that many lines, over several PTT pages.
// `urls`: articles end with their URL line, so the app knows an article's
//   AID without asking PTT.
// `images`: short articles show an image link near their top, previewed inline.
// `ptList`: screens behave as PTT's do where the default server simplifies: a
//   list's footer names its keys, (y)回應 among them, `s<board>` from a list
//   lands on the board's full list, and the main menu has its title bar.
async function bootNestedShortcutSearch(page, { loggedIn = false, startAtMain = false, boardEntry = null, legacyCaptions = false, extraArticles = 0, leadingArticles = 0, homeMenu = false, dynamicRows = false, pinned = false, alphaLines = 0, urls = false, images = false, ptList = false } = {}) {
  if (startAtMain) await bootOffline(page, ptt);
  else await bootGestureArticle(page);
  await installNestedServer(page, { surface: loggedIn || startAtMain ? 'main' : 'article', boardEntry, legacyCaptions, extraArticles, leadingArticles, homeMenu, dynamicRows, pinned, alphaLines, urls, images, ptList });
  if (startAtMain) {
    await waitScreenSettled(page, { 0: '主功能表' });
    return;
  }
  if (loggedIn) {
    await waitScreenSettled(page, { 0: '主功能表' });
    await page.evaluate(() => {
      const server = window.__shortcutServer;
      server.state.surface = 'article';
      window.__app.onData(server.frame());
    });
  }
  // Easy reading pages a long Alpha on to its later pages.
  await waitScreenSettled(page, alphaLines ? {} : { 1: 'Alpha topic' });
  await expect(page.locator(MAIN)).toHaveClass(/articleHorizontalGestures/);
}

// A new PTT session on the same board data: it starts at the main menu after
// login with a fresh cursor and no search. `deleted` carries over.
async function nestedSessionAfterLogin(page, { deleted = [], legacyCaptions = false, extraArticles = 0, homeMenu = false } = {}) {
  await installNestedServer(page, { surface: 'main', deleted, legacyCaptions, extraArticles, homeMenu });
}

async function installNestedServer(page, session) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  const extras = Array.from({ length: Math.min(60, Math.max(0, session.extraArticles || 0)) }, (_, index) => ({
    aid: '1gIeu-4' + alphabet[index], author: 'alice',
    title: '[Talk] Extra topic ' + String(index + 1).padStart(2, '0'),
    body: 'Extra ' + String(index + 1).padStart(2, '0'), push: 5
  }));
  const leading = Array.from({ length: Math.min(30, Math.max(0, session.leadingArticles || 0)) }, (_, index) => ({
    aid: '1gIeu-2' + alphabet[index], author: 'alice',
    title: '[Talk] Earlier topic ' + String(index + 1).padStart(2, '0'),
    body: 'Earlier ' + String(index + 1).padStart(2, '0'), push: 5
  }));
  await page.evaluate(({ articles, session }) => {
    const app = window.__app;
    const encode = text => [...text].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    const subject = title => title.replace(/^(?:(?:Re|Fw):\s*)+/i, '').toLowerCase();
    // surface: article | list | info | prompt | empty | missing | main | query |
    //   boardInfo | notes | notesMovie | notesPause
    // `promptless`: `a` shows no prompt, as on a screen where it is no command.
    // `squeezedFooter`: the pager footer has room only for its short hints,
    //   as a very long article's (more.c#common_pmore_footer_handler).
    const state = {
      surface: session.surface, board: 'Test', filter: null, cursor: 0, open: articles.find(article => article.body === 'Alpha'), line: 1,
      deleted: new Set(session.deleted || []), prompt: null, promptless: false, squeezedFooter: false,
      // backPause: { kind: 'pause' | 'vmsg', message }: the next Back from an
      // article answers with that pause first (#189).
      backPause: null, pausing: null,
      terminalRows: session.dynamicRows ? app.buf.rows : 24,
      applicationRows: session.dynamicRows ? app.buf.rows : 24, sizeChanges: [],
      replyDelayMs: 90, holdResponses: false, queuedResponses: 0,
      // Ctrl-Q on the list (read.c#read_cmd_query → talk.c#my_query): the
      // author's query screen, or nothing at all for an author in
      // `goneAuthors` (getuser fails). `querySleepMs`: PTT's sleep after the
      // key on the query screen, before the list (#254).
      goneAuthors: new Set(), querySleepMs: 0, queryUser: null, sleepPending: 0,
      // `i` on the list (bbs.c#bbs_cmd_config → board.c#b_config, #288): the
      // board information, a PSB list `boardInfoAt` is the cursor item of.
      // `boardInfoFails`: get_boardheader fails and PTT draws the list again;
      // `boardInfoGarbled`: a row of the screen reads as nothing PTT prints.
      boardInfoAt: 0, boardInfoFails: false, boardInfoGarbled: false,
      // `b` on the list (bbs.c#b_notes, #292): more(notes, NA), then
      // pressanykey. `notes`: 'plain' (a coloured screen), 'none' (「本看板尚無
      // 進板畫面。」 at (4,20)), 'movie' (`notesFrames` frames `notesFrameMs`
      // apart; any key stops it) or 'interactive' (keys other than q and
      // Ctrl-C are its choices, kept in `notesChoices`). A movie that ends or
      // is stopped waits in pressanykey over its last frame; `notesStop:
      // 'list'` draws the list at once instead, as pmore's READ_NEXT would.
      notes: 'plain', notesStop: 'pause', notesFrame: 0, notesFrames: 4, notesFrameMs: 300, notesChoices: []
    };
    const listed = () => {
      const all = articles.filter(article => !state.deleted.has(article.aid) && (!state.filter || !article.pinned));
      return state.filter ? all.filter(state.filter.match) : all;
    };
    const selected = () => listed()[state.cursor];
    let storedScreen = null;
    let painted = null;
    const render = (screen, fullRepaint) => {
      const clear = fullRepaint || !painted;
      let data = clear ? '\x1b[2J' : '';
      const next = Array.from({ length: state.terminalRows }, (_, row) => ({
        text: screen.rows[row] || '', inverse: screen.inverse.includes(row)
      }));
      next.forEach((line, row) => {
        const previous = painted?.[row];
        if (!clear && previous?.text === line.text && previous.inverse === line.inverse) return;
        data += `\x1b[${row + 1};1H\x1b[0m\x1b[2K`;
        const encoded = encode(line.text);
        data += (line.inverse ? `\x1b[7m${encoded.padEnd(80)}` : encoded) + '\x1b[0m';
      });
      painted = next;
      return data + `\x1b[${Math.min(screen.cursor[0], state.terminalRows)};${screen.cursor[1]}H`;
    };
    // Long rows wrap on a phone, so the article scrolls and has a position.
    const bodyLine = (article, row) => (`${article.body} line ${String(row).padStart(2, '0')}: ` + 'reading text '.repeat(5)).slice(0, 80);
    const articleRows = (article, termRows) => {
      if (article.lines) return longArticleRows(article, termRows);
      const rows = {
        0: `作者  ${article.author} (${article.author}) 看板 Test`,
        1: '標題  ' + article.title,
        2: '時間  Mon Sep  1 12:00:00 2025',
        [termRows - 1]: `  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~${termRows - 1} 行  ` +
          (state.squeezedFooter ? '(h)說明 (←/q)離開 ' : '(y)回應(X%)推文(h)說明(←)離開 ')
      };
      for (let row = 4; row < Math.min(22, termRows - 1); row++) rows[row] = bodyLine(article, row);
      if (session.images) rows[5] = `https://i.urusai.cc/viewer-${article.body.toLowerCase()}.png`;
      if (session.urls && article.fn) rows[Math.min(21, termRows - 2)] = `※ 文章網址: https://www.ptt.cc/bbs/Test/${article.fn}.html`;
      return rows;
    };
    // `lines`: an article that long, its header on the first page, paged a
    // screen at a time from `state.line`. `text`: lines by number that read
    // otherwise, such as its sign-off and comments.
    const longArticleRows = (article, termRows) => {
      const page = termRows - 1;
      const end = Math.min(article.lines, state.line + page - 1);
      const line = n => article.text?.[n] != null ? article.text[n]
        : n === 1 ? `作者  ${article.author} (${article.author}) 看板 Test`
        : n === 2 ? '標題  ' + article.title : n === 3 ? '時間  Mon Sep  1 12:00:00 2025'
          : n === 4 ? '' : bodyLine(article, n - 1);
      const rows = {
        [termRows - 1]: `  瀏覽 第 ${Math.ceil(end / page)}/${Math.ceil(article.lines / page)} 頁 (${Math.floor(end * 100 / article.lines)}%)  ` +
          `目前顯示: 第 ${String(state.line).padStart(2, '0')}~${end} 行  ` +
          // Past line 99 the full hints no longer fit the row.
          (state.line < 100 ? '(y)回應(X%)推文(h)說明(←)離開 ' : '(y)回應(h)說明(←)離開 ')
      };
      for (let n = state.line; n <= end; n++) rows[n - state.line] = line(n);
      return rows;
    };
    const cellWidth = text => [...text].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x80 ? 1 : 2), 0);
    const padCells = (text, n) => text + ' '.repeat(Math.max(0, n - cellWidth(text)));
    // The query screen as helpers/user_list.js draws it: from row 1 over the
    // list (my_query's move(1, 0); clrtobot()), the board's title kept on row
    // 0, the 請按任意鍵繼續 bar on the last row.
    const queryRows = (id, termRows) => {
      const lines = [
        padCells('《ＩＤ暱稱》' + id + ' (' + id + ' 的暱稱)', 40) + '《經濟狀況》清寒',
        padCells('《登入次數》12 次 (同天內只計一次)', 40) + '《有效文章》3 篇 (退:0)',
        padCells('《目前動態》不在站上', 40) + '《私人信箱》最近無新信件',
        padCells('《上次上站》01/02/2026 03:04:05 Fri', 40) + '《上次故鄉》某地',
        padCells('《 五子棋 》    0 勝     0 敗     0 和', 40) + '《象棋戰績》    0 勝     0 敗     0 和',
        '',
        '《個人名片》' + id + ' 目前沒有名片'
      ];
      const rows = { 0: `【板主：test】看板《${state.board}》` };
      lines.forEach((text, index) => { rows[1 + index] = text; });
      rows[termRows - 1] = '▄'.repeat(15) + ' 請按任意鍵繼續 ' + '▄'.repeat(15);
      return rows;
    };
    // bbs.c#view_postinfo over the screen: a 5-row box (QUERY_ARTICLE_URL),
    // the row next to it cleared, the right border printed at column 76 over
    // the content rows. `line`: the screen row of the article (crs_ln + 3).
    // `noAid`: fn2aidu fails and the AID row is a bare frame line; no `fn`:
    // the board gives no web address.
    const postInfoRows = (article, line, termRows) => {
      const bLines = termRows - 1;
      let area = line + 1;
      if (area + 5 > bLines || line >= Math.floor(bLines * 2 / 3)) area -= 6;
      const content = text => padCells(text, 76) + '│';
      const head = `│ 文章代碼(AID): #${article.aid} (Test) [ptt.cc] `;
      return {
        [area > line ? line - 1 : line + 1]: '',
        [area]: '┌' + '─'.repeat(37) + '┐',
        [area + 1]: article.noAid ? content('│') : content(head + article.title.slice(0, 75 - cellWidth(head)) + ' '),
        [area + 2]: content(article.fn ? `│ 文章網址: https://www.ptt.cc/bbs/Test/${article.fn}.html` : '│ 本看板目前不提供文章網址 '),
        [area + 3]: content(`│ 這一篇文章值 ${article.push || 0} Ptt幣`),
        [area + 4]: '└' + '─'.repeat(24) + ' [再按 Q 切換價格列表]  ─┘'
      };
    };
    // board.c#bconfig_items as a reader without board permissions sees them
    // (bcfg_getter's read-only values).
    const boardInfoItems = [
      ['看板管理紀錄(自動公告)', '(尚無記錄)'], ['中文敘述', '測試 ◎Test board'],
      ['公開狀態 (是否隱形)', '公開'], ['隱板時進入十大排行榜', '不可'], ['非看板會員發文', '開放'],
      ['回應文章', '開放'], ['自刪文章', '開放'], ['推薦文章 (推文)', '開放'], ['修改或刪除自己的推文', '開放'],
      ['噓文', '開放'], ['快速連推文章', '限制 (間隔 5 秒)'], ['推文時記錄來源 IP', '不會記錄'],
      ['推文開頭自動對齊', '對齊'], ['板主刪除部份違規文字', '無法'], ['轉錄文章自動記錄', '會 (需發文權限)'],
      ['冷靜模式', '未設定'], ['未滿十八歲進入', '允許'], ['[發文條件] 登入次數', '300 次以上 (您: 1234 次)'],
      ['[發文條件] 退文篇數', '無限制'], ['個人發文推文權限', '具有發文與推文權限'],
      ['預設連署限制 (登入/退文)', '無特別限制'], ['[名單] 設定禁言名單(水桶)', '[唯讀檢視]'],
      ['[名單] 可見會員名單', '[唯讀檢視]'], ['[名單] 投票限制名單', '[唯讀檢視]'],
      ['[管理] 舉辦與管理投票', '[唯讀檢視]'], ['[管理] 處理檢舉', '[無未處理]'],
      ['[管理] 文章類別設定', '[唯讀檢視]'], ['[管理] 發文注意事項', '[唯讀檢視]'],
      ['[管理] 編輯進板畫面', '[唯讀檢視]'], ['[紀錄] 看板管理稽核紀錄', '(限管理人員)']
    ];
    // b_config's screen (psb.c): vs_draw_hdr2's title, bconfig_header's board
    // row, a page of bconfig_renderer rows (the page the cursor item is on,
    // its row marked with STR_CURSOR) and the PSB footer.
    const boardInfoRows = termRows => {
      const page = termRows - 3;
      const start = Math.floor(state.boardInfoAt / page) * page;
      const width = Math.max(...boardInfoItems.map(([label]) => cellWidth(label)));
      const rows = {
        0: ' 看板設定與管理  [唯讀檢視]',
        1: `名稱: ${state.board}  板主: test`,
        [termRows - 1]: ' 看板資訊  (l)管理紀錄 (PgUp)上頁 (PgDn)下頁 (1)跳號 (←)離開 (h)說明'
      };
      boardInfoItems.slice(start, start + page).forEach(([label, value], offset) => {
        const num = start + offset;
        rows[2 + offset] = (num === state.boardInfoAt ? '>' : ' ') + ' ' + String(num + 1).padStart(2) + '. ' +
          '   ' + padCells(label, width) + '  ' + value;
      });
      if (state.boardInfoGarbled) rows[4] = '  ??????';
      return rows;
    };
    // b_config's keys (psb.c): the page keys, and ← q Q to leave.
    const boardInfoKey = (rest, termRows) => {
      const page = termRows - 3;
      const total = boardInfoItems.length;
      const sequence = /^\x1b\[[0-9;]*[~A-Za-z]/.exec(rest);
      const key = sequence ? sequence[0] : rest[0];
      if (key === '\x1b[6~' || key === ' ' || key === 'N')
        state.boardInfoAt = state.boardInfoAt + page < total ? state.boardInfoAt + page : total - 1;
      else if (key === '\x1b[5~' || key === 'P')
        state.boardInfoAt = Math.floor(state.boardInfoAt / page) > 0 ? state.boardInfoAt - page : 0;
      else if (key === '\x1b[D' || key === 'q' || key === 'Q') state.surface = 'list';
      return rest.slice(key.length);
    };
    // b_notes's screens: the entry screen's own rows over a cleared screen,
    // with pmore's movie footer or pressanykey's bar on the last row.
    const NOTES_BAR = '\x1b[1;34;44m' + '▄'.repeat(15) + ' \x1b[37m請按任意鍵繼續\x1b[34m ' + '▄'.repeat(15) + '\x1b[m';
    const notesRows = termRows => {
      if (state.surface === 'notes' && state.notes === 'none')
        return { 4: ' '.repeat(20) + '本看板尚無進板畫面。', [termRows - 1]: NOTES_BAR };
      if (state.surface === 'notes')
        return {
          2: '\x1b[1;33m  Welcome to the Test board\x1b[m',
          4: '\x1b[32m  Please read the board rules first\x1b[m',
          6: '\x1b[1;31m  A red notice line\x1b[m',
          [termRows - 1]: NOTES_BAR
        };
      const rows = { 3: `\x1b[1;36m  Movie frame ${state.notesFrame}\x1b[m` };
      if (state.notesChoices.length) rows[5] = '  Choices made: ' + state.notesChoices.length;
      rows[termRows - 1] = state.surface === 'notesPause' ? NOTES_BAR
        : state.notes === 'interactive' ? ' >> 請輸入選項:  (互動式動畫播放中，可按 q 或 Ctrl-C 中斷)'
          : ' >>> 動畫播放中... 可按 q, Ctrl-C 或其它任意鍵停止';
      return rows;
    };
    // A playing movie draws its next frame by itself; after the last one PTT
    // waits in pressanykey.
    let notesTimer = null;
    const playNotes = () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => {
        notesTimer = null;
        if (state.surface !== 'notesMovie') return;
        if (state.notesFrame >= state.notesFrames) state.surface = 'notesPause';
        else state.notesFrame++;
        app.onData(frame());
        if (state.surface === 'notesMovie') playNotes();
      }, state.notesFrameMs);
    };
    const frame = (fullRepaint = false) => {
      const termRows = session.dynamicRows ? state.applicationRows : 24;
      const bodyRows = termRows - 4;
      let rows, cursor = [termRows, 80], inverse = [];
      if (state.surface === 'article') {
        rows = articleRows(state.open, termRows);
      } else if (state.surface === 'main') {
        rows = { 0: '【主功能表】', 3: '  (B)oard 看板列表', [termRows - 1]: '我是測試主選單' };
        if (session.homeMenu) rows[4] = '  (F)avorite 我 的 最愛';
        // PTT's menu title fills its row, as the app's menu screen expects.
        if (session.ptList) inverse = [0];
        cursor = [4, 1];
      } else if (state.surface === 'boardPrompt') {
        // CompleteBoard asks on row two; cancellation preserves this list.
        // state.selectTitle: PTT's own title row (MSG_SELECT_BOARD, bbs.c
        // do_select clears row 0), as the prompt shows over an article list.
        rows = { 0: state.selectTitle ? '【 選擇看板 】' : '【主功能表】', 1: '請輸入看板名稱(按空白鍵自動搜尋)：' };
        cursor = [2, 35];
      } else if (state.surface === 'boardPause') {
        rows = { 0: 'Board entry notice', [termRows - 1]: '                         請按任意鍵繼續' };
        inverse = [termRows - 1];
      } else if (state.surface === 'backPause') {
        // PTT answers Back from an article with a pause (#189): a message on a
        // cleared screen over pressanykey, or a vmsg banner over the article.
        const pause = state.pausing;
        if (pause.kind === 'vmsg') {
          rows = articleRows(state.open, termRows);
          rows[termRows - 1] = ` ◆ ${pause.message}                    [按任意鍵繼續]`;
        } else {
          rows = { [termRows - 1]: '                         請按任意鍵繼續' };
          if (pause.message) rows[Math.floor(termRows / 2)] = '  ' + pause.message;
        }
        inverse = [termRows - 1];
      } else if (state.surface === 'boardPager') {
        // PMORE_AUTO_EXIT leaves a multi-page note's footer blank.
        rows = { 0: 'Board entry notice', 1: 'Long notice content' };
      } else if (state.surface === 'boardMovie') {
        // An interactive movie may mask the backtick; q cannot be masked.
        rows = { 0: 'Board entry movie', [termRows - 1]: '互動式動畫播放中，可按 q 停止' };
      } else if (state.surface === 'query') {
        rows = queryRows(state.queryUser, termRows);
        inverse = [0];
      } else if (state.surface === 'boardInfo') {
        rows = boardInfoRows(termRows);
        inverse = [0];
        cursor = [3 + state.boardInfoAt % (termRows - 3), 1];
      } else if (['notes', 'notesMovie', 'notesPause'].includes(state.surface)) {
        rows = notesRows(termRows);
        cursor = [termRows, 1];
      } else {
        const entries = listed();
        rows = {
          0: `【板主：test】看板《${state.board}》`,
          1: '[←]離開 [→]閱讀 [^P]發表文章 [b]備忘錄',
          2: '  編號    日 期 作  者       文  章  標  題',
          [termRows - 1]: session.legacyCaptions ? ' 文章選讀 [←]離開 [→]閱讀'
            : (state.filter ? ' 系列文章 ' : ' 文章列表 ') +
              (session.ptList ? ' (^P)發表 (y)回應 (X)推文 (→)閱讀 (←)離開' : ' [←]離開 [→]閱讀')
        };
        inverse = [0, 2];
        const start = Math.max(0, Math.min(state.cursor - Math.floor(bodyRows / 2), entries.length - bodyRows));
        entries.slice(start, start + bodyRows).forEach((article, offset) => {
          const index = start + offset;
          const num = article.pinned ? '      ★' : String(state.filter ? index + 1 : 101 + index).padStart(7);
          // The current-generation cursor marker replaces the first column.
          const mark = index === state.cursor ? '>' : ' ';
          rows[3 + offset] = `${mark}${num.slice(1)}     9/01 ${article.author.padEnd(12)} □ ${article.title}`;
        });
        cursor = [4 + state.cursor - start, 1];
        if (state.surface === 'info') {
          // From the list the box sits under the cursor row (above it past
          // two thirds of the screen); from an article PTT asked for it at
          // b_lines-3, after read_post left the pager.
          const line = state.infoFrom === 'list' ? 3 + state.cursor - start : termRows - 1;
          Object.assign(rows, postInfoRows(state.infoOf, line, termRows));
          rows[termRows - 1] = '請按任意鍵繼續';
          cursor = [termRows, 1];
        } else if (state.surface === 'prompt') {
          rows[termRows - 1] = state.prompt.label;
          cursor = [termRows, state.prompt.label.length + 1];
        } else if (state.surface === 'empty') {
          rows[termRows - 1] = ' ◆ 找不到符合條件的文章。 [按任意鍵繼續]';
          cursor = [termRows, 1];
        } else if (state.surface === 'missing') {
          rows[termRows - 2] = '找不到這個文章代碼(AID)，可能是文章已消失，或是你找錯看板了';
          rows[termRows - 1] = '請按任意鍵繼續';
          cursor = [termRows, 1];
        }
      }
      if (session.dynamicRows) {
        storedScreen = { rows, cursor, inverse };
        return render(storedScreen, fullRepaint);
      }
      let data = '\x1b[2J';
      for (const [index, text] of Object.entries(rows)) {
        const encoded = encode(text);
        // Native title/header bars fill the whole row.
        data += `\x1b[${Number(index) + 1};1H` +
          (inverse.includes(Number(index)) ? `\x1b[7m${encoded.padEnd(80)}` : encoded) + '\x1b[0m';
      }
      return data + `\x1b[${cursor[0]};${cursor[1]}H`;
    };
    const newest = () => { state.cursor = Math.max(0, listed().length - 1); };
    const search = match => {
      const all = listed();
      const hits = all.filter(match);
      if (!hits.length) return void (state.surface = 'empty');
      const previous = state.filter;
      state.filter = { match: previous ? article => previous.match(article) && match(article) : match };
      state.surface = 'list';
      newest();
    };
    const leaveFilter = () => {
      const current = selected();
      state.filter = null;
      state.cursor = Math.max(0, listed().indexOf(current));
    };
    const enterBoard = () => {
      state.surface = session.boardEntry === 'pause' ? 'boardPause'
        : session.boardEntry === 'pager' ? 'boardPager'
          : session.boardEntry === 'movie' ? 'boardMovie' : 'list';
    };
    const step = rest => {
      if (state.surface === 'boardInfo') return boardInfoKey(rest, session.dynamicRows ? state.applicationRows : 24);
      // Any key leaves the query screen (one escape sequence is one key); PTT
      // sleeps before it draws the list again.
      if (state.surface === 'query') {
        state.surface = 'list';
        state.queryUser = null;
        state.sleepPending = state.querySleepMs;
        const sequence = /^\x1b\[[0-9;]*[~A-Za-z]/.exec(rest);
        return rest.slice(sequence ? sequence[0].length : 1);
      }
      // pressanykey after the entry screen: any one key draws the list.
      if (state.surface === 'notes' || state.surface === 'notesPause') {
        state.surface = 'list';
        const sequence = /^\x1b\[[0-9;]*[~A-Za-z]/.exec(rest);
        return rest.slice(sequence ? sequence[0].length : 1);
      }
      // A playing movie: q and Ctrl-C always stop it; any other key stops a
      // plain one and is an interactive one's choice.
      if (state.surface === 'notesMovie') {
        const sequence = /^\x1b\[[0-9;]*[~A-Za-z]/.exec(rest);
        const key = sequence ? sequence[0] : rest[0];
        if (state.notes === 'interactive' && key !== 'q' && key !== '\x03') state.notesChoices.push(key);
        else state.surface = state.notesStop === 'list' ? 'list' : 'notesPause';
        return rest.slice(key.length);
      }
      if (state.surface === 'boardPause' || state.surface === 'backPause') {
        state.surface = 'list';
        state.pausing = null;
        return rest.slice(1);
      }
      if (state.surface === 'boardPager') {
        if (rest.startsWith('\x1b[D')) {
          state.surface = 'boardPause';
          return rest.slice(3);
        }
        return rest.slice(1);
      }
      if (state.surface === 'boardMovie') {
        if (rest[0] === 'q') state.surface = 'list';
        return rest.slice(1);
      }
      if (state.surface === 'boardPrompt') {
        if (rest[0] === '\x03') {
          state.surface = 'list';
          return rest.slice(1);
        }
        const end = rest.indexOf('\r');
        if (end < 0) return '';
        // Board completion erases its preview before committing the name.
        state.board = [...rest.slice(0, end)].reduce((text, ch) =>
          ch === '\b' || ch === '\x7f' ? text.slice(0, -1) : text + ch, '');
        state.filter = null;
        enterBoard();
        return rest.slice(end + 1);
      }
      if (state.surface === 'prompt') {
        const end = rest.indexOf('\r');
        const text = rest.slice(0, end);
        const prompt = state.prompt;
        state.prompt = null;
        // An empty answer cancels the search (read.c#ask_filter_predicate).
        if (!text.trim()) {
          state.surface = 'list';
          return rest.slice(end + 1);
        }
        search(prompt.kind === 'author'
          ? article => article.author.toLowerCase().includes(text.toLowerCase())
          : prompt.kind === 'push'
            ? article => Number(text) > 0 ? article.push >= Number(text) : article.push <= Number(text)
            : article => article.title.toLowerCase().includes(text.toLowerCase()));
        return rest.slice(end + 1);
      }
      if (rest.startsWith('\x1b[D')) {
        if (state.surface === 'article' && state.backPause) {
          // One pause, then Back answers as usual again.
          state.pausing = state.backPause;
          state.backPause = null;
          state.surface = 'backPause';
        } else if (state.surface === 'article') state.surface = 'list';
        else if (state.filter) leaveFilter();
        else state.surface = 'main';
        return rest.slice(3);
      }
      // List navigation used by the easy-reading list: number jumps, Home,
      // End, paging and single-row moves. The default four articles still fit.
      const jump = /^(\d+)\r/.exec(rest);
      if (jump && state.surface === 'list') {
        const num = Number(jump[1]);
        const index = state.filter ? num - 1 : num - 101;
        state.cursor = Math.min(Math.max(0, index), listed().length - 1);
        return rest.slice(jump[0].length);
      }
      const nav = ['\x1b[1~', '\x1b[4~', '\x1b[5~', '\x1b[6~', '\x1b[A', '\x1b[B'].find(key => rest.startsWith(key));
      const lines = state.surface === 'article' && state.open.lines;
      // pmore's goto line (`:N`): line N at the top, at most the last page.
      const goto = /^:(\d+)\r/.exec(rest);
      if (goto && lines) {
        const page = (session.dynamicRows ? state.applicationRows : 24) - 1;
        state.line = Math.min(Math.max(1, Number(goto[1])), Math.max(1, lines - page + 1));
        return rest.slice(goto[0].length);
      }
      if ((nav || rest[0] === ' ') && lines) {
        const page = (session.dynamicRows ? state.applicationRows : 24) - 1;
        const last = Math.max(1, lines - page + 1);
        if (nav === '\x1b[1~') state.line = 1;
        else if (nav === '\x1b[4~') state.line = last;
        else if (nav === '\x1b[5~') state.line = Math.max(1, state.line - page);
        else if (nav === '\x1b[6~' || !nav) state.line = Math.min(last, state.line + page);
        return rest.slice(nav ? nav.length : 1);
      }
      if (nav && state.surface === 'list') {
        const last = listed().length - 1;
        if (nav === '\x1b[1~') state.cursor = 0;
        else if (nav === '\x1b[4~') state.cursor = last;
        else if (nav === '\x1b[5~') state.cursor = Math.max(0, state.cursor - (session.dynamicRows ? state.applicationRows - 4 : 20));
        else if (nav === '\x1b[6~') state.cursor = Math.min(last, state.cursor + (session.dynamicRows ? state.applicationRows - 4 : 20));
        else state.cursor = Math.min(Math.max(0, state.cursor + (nav === '\x1b[A' ? -1 : 1)), last);
        return rest.slice(nav.length);
      }
      const head = rest[0];
      if (head === ' ' && ['info', 'empty', 'missing'].includes(state.surface)) state.surface = 'list';
      else if (head === 'Q' && state.surface === 'article') {
        state.surface = 'info';
        state.infoFrom = 'article';
        state.infoOf = state.open;
      } else if (head === 'Q' && state.surface === 'list' && selected()) {
        state.surface = 'info';
        state.infoFrom = 'list';
        state.infoOf = selected();
      }
      else if ((head === 'i' || head === 'I') && state.surface === 'list') {
        if (!state.boardInfoFails) {
          state.surface = 'boardInfo';
          state.boardInfoAt = 0;
        }
      }
      else if (head === 'b' && state.surface === 'list') {
        if (state.notes === 'movie' || state.notes === 'interactive') {
          state.surface = 'notesMovie';
          state.notesFrame = 1;
          state.notesChoices = [];
          playNotes();
        } else state.surface = 'notes';
      }
      else if (head === '\x11' && state.surface === 'list') {
        const author = selected()?.author;
        if (author && !state.goneAuthors.has(author)) {
          state.surface = 'query';
          state.queryUser = author;
        }
      }
      else if (head === '\r' && state.surface === 'list') {
        state.open = selected();
        state.surface = 'article';
        state.line = 1;
      } else if (head === 'a' && state.surface === 'list' && !state.promptless) {
        state.surface = 'prompt';
        state.prompt = { kind: 'author', label: state.filter ? '增加條件 作者: ' : '搜尋作者: ' };
      } else if (head === '/' && state.surface === 'list') {
        state.surface = 'prompt';
        state.prompt = { kind: 'title', label: state.filter ? '增加條件 標題: ' : '搜尋標題: ' };
      } else if (head === 'Z' && state.surface === 'list') {
        state.surface = 'prompt';
        state.prompt = { kind: 'push', label: state.filter ? '增加條件 推文數: ' : '搜尋推文數高於多少: ' };
      } else if (head === 'S' && state.surface === 'list') {
        const wanted = subject(selected().title);
        search(article => subject(article.title) === wanted);
      } else if (head === 's' && !rest.includes('\r')) {
        // The name comes once the prompt is shown (the dashboard, the search sheet).
        state.surface = 'boardPrompt';
      } else if (head === 's' || head === '#') {
        const end = rest.indexOf('\r');
        const value = rest.slice(1, end);
        if (head === 's') {
          // From an article the board jump keeps its subset (aid_navigation).
          if (state.surface === 'main' || (session.ptList && state.surface === 'list')) state.filter = null;
          state.board = value;
          enterBoard();
        } else if (!state.filter) {
          const index = listed().findIndex(article => article.aid === value);
          if (index < 0) state.surface = 'missing';
          else state.cursor = index;
        }
        return rest.slice(end + 1);
      }
      return rest.slice(1);
    };
    window.__gestureSent = [];
    const replies = [];
    let delivering = false;
    const drain = () => {
      if (delivering || state.holdResponses || !replies.length) return;
      delivering = true;
      setTimeout(() => {
        // A hold also stops delivery already scheduled before it was enabled.
        if (state.holdResponses) { delivering = false; return; }
        app.onData(replies.shift());
        state.queuedResponses = replies.length;
        delivering = false;
        drain();
      }, state.replyDelayMs);
    };
    const respond = data => {
      replies.push(data);
      state.queuedResponses = replies.length;
      drain();
    };
    window.__stubWSSent = bytes => {
      window.__gestureSent.push(bytes);
      const naws = bytes.indexOf('\xff\xfa\x1f');
      if (session.dynamicRows && naws >= 0) {
        state.terminalRows = bytes.charCodeAt(naws + 5) * 256 + bytes.charCodeAt(naws + 6);
        state.sizeChanges.push(state.terminalRows);
        // NAWS only redraws stored cells; application pagination changes later.
        if (storedScreen) respond(render(storedScreen, true));
        return;
      }
      let rest = bytes.replace(/\f/g, '');
      const responds = rest.length > 0 || bytes.includes('\f');
      if (session.dynamicRows && rest) state.applicationRows = state.terminalRows;
      while (rest) rest = step(rest);
      if (responds) {
        if (session.dynamicRows) respond(bytes.replace(/\f/g, '') ? frame(bytes.includes('\f')) : render(storedScreen, true));
        // A hold queues the answer until releaseResponses, as the dynamic path.
        else if (state.holdResponses) respond(frame());
        else {
          const sleep = state.sleepPending;
          state.sleepPending = 0;
          setTimeout(() => app.onData(frame()), sleep);
        }
      }
    };
    window.__shortcutServer = {
      state, frame,
      releaseResponses() { state.holdResponses = false; drain(); }
    };
    app.onData(frame(true));
  }, {
    articles: [...leading, ...NESTED_ARTICLES.map(a => a.body === 'Alpha' && session.alphaLines ? { ...a, lines: session.alphaLines } : a),
      ...extras, ...(session.pinned ? [{
      aid: '1gIeu-3P', author: 'mod', title: '[Notice] Pinned rules', body: 'Rules', pinned: true
    }] : [])],
    session
  });
}

// Input is deliberately swallowed while a serialized navigation owns the
// connection; the next real gesture must wait until that operation ends.
// That includes an easy-reading list open: its article frames already paint
// before the settle hands the article over, and a Back in that window is
// swallowed (#43).
async function waitIdle(page) {
  await expect.poll(() => page.evaluate(() => {
    const app = window.__app;
    return !app.articleShortcutSearch.active && !app.aidNavigation.active && !app.searchInFlight &&
      app.listSession.state !== 'opening';
  })).toBe(true);
}

// The list is at rest once the background fill has found the top and no
// command is in flight, and the reserve above the first row has settled. Until
// then the list's own reads are still going out, so a byte count taken earlier
// would include them.
async function waitListAtRest(page) {
  await page.waitForFunction(() => {
    const app = window.__app;
    const screen = app.view.componentScreen;
    return app.listSession._edgeUp && app.commandQueue.idle &&
      !screen._listReserveTimer && !screen._listScrollBusy();
  });
}

// Distinct per-screen evidence: result articles and their lists share titles.
async function waitArticle(page, body) {
  await expect.poll(() => visibleText(page)).toContain(`${body} line 04:`);
  await waitIdle(page);
}

async function waitList(page, { has = [], lacks = [] } = {}) {
  await expect.poll(async () => {
    const text = await visibleText(page);
    // Native lists show the board caption; easy-reading list cards show a
    // board header above their own scrolling card view.
    const list = text.includes('看板《Test》') || await page.locator(`${SCREEN} .listBodyView`).isVisible();
    return list && !/ line 04:/.test(text) &&
      has.every(item => text.includes(item)) && !lacks.some(item => text.includes(item));
  }).toBe(true);
  await waitIdle(page);
}

// The first article row at the top of the reading viewport.
const topLine = page => page.evaluate(() => {
  const view = window.__app.view;
  const row = document.querySelector(`#mainContainer [type="bbsrow"][srow="${Math.floor(view.currentLineIndex())}"]`);
  return row ? row.textContent.trim().slice(0, 16) : null;
});

const scrollTop = page => page.locator(MAIN).evaluate(el => el.scrollTop);

// The reader scrolls the first nested article to its middle with a real touch
// drag. Holding still before release leaves no fling, so the position is
// deterministic once the browser's own scrolling settles. The drag starts
// above the comment bar, which covers the foot of the article, and travels
// half the reading area: a full one ends within the two rows the reading
// record already counts as the article's end.
async function readToMiddle(page) {
  const main = await page.locator(MAIN).boundingBox();
  const bar = await page.locator('#commentBar').boundingBox();
  const x = main.x + main.width / 2;
  const from = Math.min(main.y + main.height, bar ? bar.y : Infinity) - 20;
  const to = from - (from - main.y) / 2;
  const contact = await beginArticleTouch(page, { x, y: from });
  for (let step = 1; step <= 10; step++) await contact.move({ x, y: from + (to - from) * step / 10 });
  await contact.release();
  let last = -1;
  await expect.poll(async () => {
    const now = await scrollTop(page);
    const settled = now === last;
    last = now;
    if (!settled) await nextFrames(page, 4);
    return settled;
  }).toBe(true);
  await expect.poll(() => topLine(page)).toMatch(/^Alpha line (0[5-9]|1\d)/);
  return topLine(page);
}

// Tap a result card in the easy-reading list.
async function tapCard(page, title) {
  await expect(page.locator(`${SCREEN} .listBodyView`)).toBeVisible();
  await page.locator(`${SCREEN} .listCard`, { hasText: title }).locator('.listCardBody').tap();
}

// The connection drops; the reader taps Reconnect and logs in again.
async function disconnectAndReconnect(page, session = {}) {
  await page.evaluate(() => window.__stubWS.close());
  await page.locator('#reactAlert button', { hasText: 'Reconnect' }).tap();
  await waitConnected(page);
  await nestedSessionAfterLogin(page, session);
  // The old results can remain visible while the new main-menu frame is
  // settling. Wait for actual recovery, not the retained DOM from before close.
  await expect.poll(() => page.evaluate(() => {
    const app = window.__app;
    return !app.reconnectResume.hasPending() && !app.articleShortcutSearch.suspended &&
      !app.aidNavigation.active && !app.searchInFlight;
  }), { timeout: 15000 }).toBe(true);
}

async function tapShortcut(page, key) {
  await revealArticleDrawer(page);
  await page.locator(`[data-article-shortcut="${key}"]`).tap();
}

module.exports = {
  bootShortcutSearch, searchAuthor, nativeBack, openSearchResult, visibleText, waitSearchResults, hinted,
  bootNestedShortcutSearch, nestedSessionAfterLogin, waitArticle, waitList, waitIdle, waitListAtRest, tapShortcut, topLine, readToMiddle,
  tapCard, disconnectAndReconnect
};
