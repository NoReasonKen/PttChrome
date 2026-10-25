const { expect } = require('@playwright/test');
const ptt = require('./ptt');
const { waitScreenSettled } = require('./replay');
const { bootGestureArticle, revealArticleDrawer, beginArticleTouch } = require('./article_gestures');
const { nextFrames } = require('./real_input');

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
      else if (command) return;
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
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
}

async function searchAuthor(page) {
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="author"]').tap();
}

const visibleText = page => page.locator('#mainContainer').innerText();

async function waitSearchResults(page) {
  await expect.poll(() => page.locator('body').innerText()).toContain('Same-author search results');
  await expect.poll(() => visibleText(page)).toContain('Source article');
}

async function nativeBack(page) {
  await page.goBack();
}

async function openSearchResult(page, { thread = false } = {}) {
  await ptt.sendKey(page, 'Enter');
  await expect.poll(() => visibleText(page)).toContain(thread ? 'Re: [Test] Source article' : 'Result article');
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
}

// A small controlled board for chained searches. Same protocol sources as
// above: Q leaves an info box over the list, `s<board>` from a result article
// keeps that subset, Left leaves a subset for the full list, #AID selects in
// the full list only, author search is case-insensitive substring matching,
// native S is case-insensitive equality of the reply-stripped subject, and a
// new result list selects its newest entry.
const NESTED_ARTICLES = [
  { aid: '1gIeu-3A', author: 'alice', title: '[Talk] Alpha topic', body: 'Alpha', push: 10 },
  { aid: '1gIeu-3B', author: 'alice', title: '[Talk] Beta topic', body: 'Beta', push: 20 },
  { aid: '1gIeu-3C', author: 'bob', title: 'Re: [Talk] Beta topic', body: 'Charlie', push: 30 },
  { aid: '1gIeu-3D', author: 'bob', title: '[Talk] Delta topic', body: 'Delta', push: 40 }
];

// options.easyList: the reader's default list owner (cards).
// options.loggedIn: this connection first passes the main menu, as a real
//   login does, so reconnect/open resume may capture and store a plan.
// options.resumeLastPlace: reloads resume the last place (the product default).
async function bootNestedShortcutSearch(page, { easyList = false, loggedIn = false, resumeLastPlace = false, legacyCaptions = false } = {}) {
  await bootGestureArticle(page, { resumeLastPlace });
  // The image-article boot disables the easy-reading list; the reader's
  // default enables it before any list from this server is seen.
  if (easyList) await ptt.applyPrefs(page, { enableEasyReadingList: true });
  await installNestedServer(page, { surface: loggedIn ? 'main' : 'article', legacyCaptions });
  if (loggedIn) {
    await waitScreenSettled(page, { 0: '主功能表' });
    await page.evaluate(() => {
      const server = window.__shortcutServer;
      server.state.surface = 'article';
      window.__app.onData(server.frame());
    });
  }
  await waitScreenSettled(page, { 1: 'Alpha topic' });
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
}

// A new PTT session on the same board data: it starts at the main menu after
// login with a fresh cursor and no search. `deleted` carries over.
async function nestedSessionAfterLogin(page, { deleted = [], legacyCaptions = false } = {}) {
  await installNestedServer(page, { surface: 'main', deleted, legacyCaptions });
}

async function installNestedServer(page, session) {
  await page.evaluate(({ articles, session }) => {
    const app = window.__app;
    const encode = text => [...text].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    const subject = title => title.replace(/^(?:(?:Re|Fw):\s*)+/i, '').toLowerCase();
    // surface: article | list | info | prompt | empty | missing | main
    const state = {
      surface: session.surface, board: 'Test', filter: null, cursor: 0, open: articles[0],
      deleted: new Set(session.deleted || []), prompt: null
    };
    const listed = () => {
      const all = articles.filter(article => !state.deleted.has(article.aid));
      return state.filter ? all.filter(state.filter.match) : all;
    };
    const selected = () => listed()[state.cursor];
    const articleRows = article => {
      const rows = {
        0: `作者  ${article.author} (${article.author}) 看板 Test`,
        1: '標題  ' + article.title,
        2: '時間  Mon Sep  1 12:00:00 2025',
        23: '  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~23 行  (y)回應(X%)推文(h)說明(←)離開 '
      };
      // Long rows wrap on a phone, so the article scrolls and has a position.
      for (let row = 4; row < 22; row++) {
        rows[row] = `${article.body} line ${String(row).padStart(2, '0')}: ` + 'reading text '.repeat(5);
      }
      return rows;
    };
    const frame = () => {
      let rows, cursor = [24, 80], inverse = [];
      if (state.surface === 'article') rows = articleRows(state.open);
      else if (state.surface === 'main') {
        rows = { 0: '【主功能表】', 3: '  (B)oard 看板列表', 23: '我是測試主選單' };
        cursor = [4, 1];
      } else {
        const entries = listed();
        rows = {
          0: `【板主：test】看板《${state.board}》`,
          1: '[←]離開 [→]閱讀 [^P]發表文章 [b]備忘錄',
          2: '  編號    日 期 作  者       文  章  標  題',
          23: session.legacyCaptions ? ' 文章選讀 [←]離開 [→]閱讀'
            : state.filter ? ' 系列文章  [←]離開 [→]閱讀' : ' 文章列表  [←]離開 [→]閱讀'
        };
        inverse = [0, 2];
        entries.forEach((article, index) => {
          const num = String(state.filter ? index + 1 : 101 + index).padStart(7);
          // The current-generation cursor marker replaces the first column.
          const mark = index === state.cursor ? '>' : ' ';
          rows[3 + index] = `${mark}${num.slice(1)}     9/01 ${article.author.padEnd(12)} □ ${article.title}`;
        });
        cursor = [4 + state.cursor, 1];
        if (state.surface === 'info') {
          rows[18] = `│ 文章代碼(AID): #${state.open.aid} (Test) [ptt.cc] ${state.open.title}`;
          rows[23] = '請按任意鍵繼續';
          cursor = [24, 1];
        } else if (state.surface === 'prompt') {
          rows[23] = state.prompt.label;
          cursor = [24, state.prompt.label.length + 1];
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
    const step = rest => {
      if (state.surface === 'prompt') {
        const end = rest.indexOf('\r');
        const text = rest.slice(0, end);
        const prompt = state.prompt;
        state.prompt = null;
        search(prompt.kind === 'author'
          ? article => article.author.toLowerCase().includes(text.toLowerCase())
          : prompt.kind === 'push'
            ? article => Number(text) > 0 ? article.push >= Number(text) : article.push <= Number(text)
            : article => article.title.toLowerCase().includes(text.toLowerCase()));
        return rest.slice(end + 1);
      }
      if (rest.startsWith('\x1b[D')) {
        if (state.surface === 'article') state.surface = 'list';
        else if (state.filter) leaveFilter();
        else state.surface = 'main';
        return rest.slice(3);
      }
      // List navigation used by the easy-reading list: number jumps, Home,
      // End, paging and single-row moves (four articles fit on one page).
      const jump = /^(\d+)\r/.exec(rest);
      if (jump && state.surface === 'list') {
        const num = Number(jump[1]);
        const index = state.filter ? num - 1 : num - 101;
        state.cursor = Math.min(Math.max(0, index), listed().length - 1);
        return rest.slice(jump[0].length);
      }
      const nav = ['\x1b[1~', '\x1b[4~', '\x1b[5~', '\x1b[6~', '\x1b[A', '\x1b[B'].find(key => rest.startsWith(key));
      if (nav && state.surface === 'list') {
        const last = listed().length - 1;
        if (nav === '\x1b[1~' || nav === '\x1b[5~') state.cursor = 0;
        else if (nav === '\x1b[4~' || nav === '\x1b[6~') state.cursor = last;
        else state.cursor = Math.min(Math.max(0, state.cursor + (nav === '\x1b[A' ? -1 : 1)), last);
        return rest.slice(nav.length);
      }
      const head = rest[0];
      if (head === ' ' && ['info', 'empty', 'missing'].includes(state.surface)) state.surface = 'list';
      else if (head === 'Q' && state.surface === 'article') state.surface = 'info';
      else if (head === '\r' && state.surface === 'list') {
        state.open = selected();
        state.surface = 'article';
      } else if (head === 'a' && state.surface === 'list') {
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
      } else if (head === 's' || head === '#') {
        const end = rest.indexOf('\r');
        const value = rest.slice(1, end);
        if (head === 's') {
          // From an article the board jump keeps its subset (aid_navigation).
          if (state.surface === 'main') state.filter = null;
          state.board = value;
          state.surface = 'list';
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
    window.__stubWSSent = bytes => {
      window.__gestureSent.push(bytes);
      let rest = bytes.replace(/\f/g, '');
      const responds = rest.length > 0 || bytes.includes('\f');
      while (rest) rest = step(rest);
      if (responds) setTimeout(() => app.onData(frame()), 0);
    };
    window.__shortcutServer = { state, frame };
    app.onData(frame());
  }, { articles: NESTED_ARTICLES, session });
}

// Input is deliberately swallowed while a serialized navigation owns the
// connection; the next real gesture must wait until that operation ends.
async function waitIdle(page) {
  await expect.poll(() => page.evaluate(() => {
    const app = window.__app;
    return !app.articleShortcutSearch.active && !app.aidNavigation.active && !app.searchInFlight;
  })).toBe(true);
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
    const list = text.includes('看板《Test》') || await page.locator('#mainContainer .listBodyView').isVisible();
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

const scrollTop = page => page.locator('.main').evaluate(el => el.scrollTop);

// The reader scrolls the first nested article to its middle with a real touch
// drag. Holding still before release leaves no fling, so the position is
// deterministic once the browser's own scrolling settles.
async function readToMiddle(page) {
  const main = await page.locator('.main').boundingBox();
  const x = main.x + main.width / 2;
  const from = main.y + main.height - 20;
  const to = main.y + 20;
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

async function tapShortcut(page, key) {
  await revealArticleDrawer(page);
  await page.locator(`[data-article-shortcut="${key}"]`).tap();
}

module.exports = {
  bootShortcutSearch, searchAuthor, nativeBack, openSearchResult, visibleText, waitSearchResults,
  bootNestedShortcutSearch, nestedSessionAfterLogin, waitArticle, waitList, waitIdle, tapShortcut, topLine, readToMiddle
};
