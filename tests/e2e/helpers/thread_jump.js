const { expect } = require('@playwright/test');
const ptt = require('./ptt');
const { bootOffline, waitScreenSettled } = require('./replay');

// Controlled PTT boundary for same-thread jumps (#65), derived from upstream
// mbbsd/read.c: thread() scans at most THREAD_SEARCH_RANGE (500) records from
// the cursor and keeps the cursor when it finds nothing; from inside an article
// `[` and `=` then read the same article again and `]` returns to the list.
// select_read (`S`) lists the thread with the cursor on its last entry,
// read_cmd_quit (`←`) leaves the results with the cursor on the same article,
// and every key sequence ending in `\f` repaints the whole screen. The
// application, its parsers, rendering, command queue and input stay real.
const THREAD = '[Talk] Far topic';
const FAR_BOARD = [
  { num: 1, author: 'alice', title: THREAD, date: '9/01' },
  { num: 40, author: 'bob', title: 'Re: ' + THREAD, date: '9/10' },
  { num: 600, author: 'carol', title: 'Re: ' + THREAD, date: '10/20' },
  { num: 1150, author: 'dave', title: 'Re: ' + THREAD, date: '11/30' }
];

// The same thread with a reply 30 records before its last one: from there,
// PTT's first-in-thread jump lands on that reply, the nearest reply it passes
// with the original beyond its range.
const NEAR_REPLY_BOARD = [...FAR_BOARD, { num: 1120, author: 'erin', title: 'Re: ' + THREAD, date: '11/29' }];

// Boot easy reading on article `open` of a 1200-article board 'Test', whose
// thread articles are `thread`.
// `delay`: how long the server takes to answer, so intermediate states last.
// `fromList`: start on the article list, the cursor on `open`, and open it
// from there with article-list easy reading, so the list is its lower page.
async function bootThreadBoard(page, { open = 600, delay = 80, size = 1200, fromList = false, thread = FAR_BOARD } = {}) {
  await bootOffline(page, ptt, {});
  await ptt.applyPrefs(page, {
    enableEasyReading: true, enableEasyReadingList: fromList, articleHorizontalGestures: true
  });
  await page.evaluate(({ thread, size, open, delay, fromList }) => {
    const app = window.__app;
    const encode = text => [...text].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    const articles = [];
    for (let num = 1; num <= size; num++) {
      articles.push(thread.find(a => a.num === num) ||
        { num, author: 'filler', title: '[Talk] Filler ' + num, date: '10/01' });
    }
    const subject = title => title.replace(/^(?:Re: )+/, '');
    const PAGE = 20;
    // surface: article | list; `filter`: the subject the results show.
    const state = {
      surface: fromList ? 'list' : 'article', filter: null, cursor: open, open: articles[open - 1],
      currtitle: articles[open - 1].title
    };
    const view = () => state.filter == null ? articles : articles.filter(a => subject(a.title) === state.filter);
    const threadMove = (key) => {
      const list = view();
      const pos = state.cursor;
      const step = key === ']' ? 1 : -1;
      const want = subject(state.currtitle);
      let jump = 500, amatch = -1, ln;
      for (ln = pos + step; ln > 0 && ln <= list.length && --jump > 0; ln += step) {
        const title = list[ln - 1].title;
        if (key === '=') {
          if (title === want) break;
          if (title.slice(4) === want) { amatch = ln; jump = 500; }
        } else if (subject(title) === want) break;
      }
      if (jump <= 0 || ln <= 0 || ln > list.length) ln = amatch === -1 ? pos : amatch;
      return ln;
    };
    const openCursor = () => {
      state.open = view()[state.cursor - 1];
      state.currtitle = state.open.title;
      state.surface = 'article';
    };
    const listRow = (article, index, cursor) => {
      const num = String(state.filter == null ? article.num : index).padStart(7);
      const glyph = article.title.startsWith('Re: ') ? 'R: ' + subject(article.title) : '□ ' + article.title;
      const text = `${num} +  ${article.date.padStart(5)} ${article.author.padEnd(13)}${glyph}`;
      return cursor ? '>' + text.slice(1) : text;
    };
    const frame = () => {
      let rows, cursor = [24, 80];
      if (state.surface === 'article') {
        const a = state.open;
        const status = '  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~23 行  (y)回應(X%)推文(h)說明(←)離開 ';
        // `headerless`: the author removed the header rows; the body starts on top.
        rows = a.headerless ? { 0: `Body of article ${a.num} by ${a.author}.`, 23: status } : {
          0: `作者  ${a.author} (${a.author}) 看板 Test`,
          1: `標題  ${a.title}`,
          2: `時間  Mon Sep  1 12:00:00 2025 #${a.num}`,
          4: `Body of article ${a.num} by ${a.author}.`,
          23: status
        };
      } else {
        const list = view();
        const top = Math.floor((state.cursor - 1) / PAGE) * PAGE + 1;
        rows = {
          0: '【板主：test】' + (state.filter == null ? '看板《Test》' : '系列《Test》'),
          1: '[←]離開 [→]閱讀 [^P]發表文章 [b]備忘錄',
          2: '  編號    日 期 作  者       文  章  標  題',
          23: (state.filter == null ? ' 文章列表 ' : ' 系列文章 ') + ' (y)回應 (X)推文 (←)離開 '
        };
        for (let i = 0; i < PAGE && top + i <= list.length; i++) {
          rows[3 + i] = listRow(list[top + i - 1], top + i, top + i === state.cursor);
        }
        cursor = [4 + state.cursor - top, 1];
      }
      let data = '\x1b[2J';
      for (const [index, text] of Object.entries(rows)) {
        const inverse = state.surface === 'list' && [0, 2].includes(Number(index));
        const encoded = encode(text);
        data += `\x1b[${Number(index) + 1};1H${inverse ? '\x1b[7m' + encoded.padEnd(80) : encoded}\x1b[0m`;
      }
      return data + `\x1b[${cursor[0]};${cursor[1]}H`;
    };
    const TOKEN = /\x1b\[[0-9;]*[A-Za-z~]|\d+\r|[\s\S]/g;
    const apply = token => {
      const list = view();
      if (state.surface === 'article') {
        if (token === '\x1b[D') state.surface = 'list';
        else if ('[]='.includes(token)) {
          const ln = threadMove(token);
          if (ln !== state.cursor) { state.cursor = ln; openCursor(); }
          else if (token === ']') state.surface = 'list';
          else openCursor();
        }
        return;
      }
      if (token === '\x1b[D') {
        if (state.filter == null) return;
        const article = list[state.cursor - 1];
        state.filter = null;
        state.cursor = article.num;
      } else if (token === 'S') {
        state.filter = subject(list[state.cursor - 1].title);
        state.cursor = view().length;
      } else if (/^\d+\r$/.test(token)) {
        state.cursor = Math.min(Math.max(1, parseInt(token, 10)), list.length);
      } else if ('[]='.includes(token)) state.cursor = threadMove(token);
      else if (token === '\r') openCursor();
      else if (token === '\x1b[5~') state.cursor = Math.max(1, state.cursor - PAGE);
      else if (token === '\x1b[6~') state.cursor = Math.min(list.length, state.cursor + PAGE);
      else if (token === '\x1b[A') state.cursor = Math.max(1, state.cursor - 1);
      else if (token === '\x1b[B') state.cursor = Math.min(list.length, state.cursor + 1);
    };
    window.__threadSent = [];
    window.__stubWSSent = bytes => {
      window.__threadSent.push(bytes);
      for (const token of bytes.match(TOKEN) || []) if (token !== '\f') apply(token);
      setTimeout(() => app.onData(frame()), delay);
    };
    window.__threadServer = { state, frame };
    app.onData(frame());
  }, { thread, size, open, delay, fromList });
  if (fromList) {
    await listActive(page);
    await ptt.sendKey(page, 'Enter');
    await expect.poll(() => page.locator('.main').first().innerText()).toContain(`Body of article ${open} by`);
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
  } else {
    await waitScreenSettled(page, thread.find(a => a.num === open)?.headerless ? { 0: `Body of article ${open} by` } : { 2: '#' + open });
    await page.evaluate(() => window.__app.easyReading.enterEasyReading());
  }
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
}

const listActive = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 2 && app.listSession.state === 'active' && app.commandQueue.idle && !app.buf._settleTimer;
});

// What the reader sees on every frame: the App Bar title, the progress bar,
// and the text of the topmost screen at the middle of the reading area.
async function watchScreen(page) {
  await page.evaluate(() => {
    const seen = window.__threadSeen = [];
    const sample = () => {
      const main = document.querySelector('.main');
      const box = main?.getBoundingClientRect();
      // A layer revealed under a sliding page and the underlay are inert, and
      // the underlay takes no pointer, which hit testing passes through; both
      // still cover what lies below them.
      const inert = [...document.querySelectorAll('[data-stack-layer][inert], .stackUnderlay[inert]')];
      const underlays = [...document.querySelectorAll('.stackUnderlay')];
      inert.forEach(el => { el.inert = false; });
      underlays.forEach(el => { el.style.pointerEvents = 'auto'; });
      // The real screen slides sideways on its way out: the middle of the window.
      const top = box && document.elementFromPoint(window.innerWidth / 2, box.top + box.height / 2);
      inert.forEach(el => { el.inert = true; });
      underlays.forEach(el => { el.style.pointerEvents = ''; });
      // The drawer closing over the screen is not the screen.
      if (top?.closest('[data-article-drawer]')) return requestAnimationFrame(sample);
      const entry = {
        title: document.querySelector('#mobileAppBar .mobileAppBarTitle')?.textContent || '',
        busy: !!document.querySelector('[data-key="__busy"]'),
        // Text content: a screen just attached skips its chunks
        // (content-visibility) until its first rendering, before any paint.
        screen: (top?.closest('.main')?.textContent || '').slice(0, 400),
        // A live layer of the page stack, or the real screen.
        layer: top?.closest('[data-stack-layer]')?.dataset.stackLayer || (top?.closest('.stackUnderlay') ? 'underlay' : null),
        cards: !!top?.closest('.main:not([data-stack-layer])')?.querySelector('.listCard')
      };
      const last = seen[seen.length - 1];
      if (!last || ['title', 'busy', 'screen', 'layer', 'cards'].some(key => last[key] !== entry[key])) seen.push(entry);
      if (!window.__threadSeenStop) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

// Stops after the next two frames, so the frame that shows the last change
// is sampled.
async function stopWatching(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    window.__threadSeenStop = true;
    return window.__threadSeen;
  });
}

const sent = page => page.evaluate(() => window.__threadSent);
const server = page => page.evaluate(() => ({ ...window.__threadServer.state, open: window.__threadServer.state.open.num }));

module.exports = { THREAD, FAR_BOARD, NEAR_REPLY_BOARD, bootThreadBoard, listActive, watchScreen, stopWatching, sent, server };
