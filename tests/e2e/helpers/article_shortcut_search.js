const { expect } = require('@playwright/test');
const ptt = require('./ptt');
const { waitScreenSettled } = require('./replay');
const { bootGestureArticle, revealArticleDrawer } = require('./article_gestures');

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
    const state = { surface: 'source', filtered: !!options.filtered, selected: 'source', searched: false };
    const frame = () => {
      let rows = {}, cursor = [24, 80];
      if (state.surface === 'source' || state.surface === 'child') {
        const source = state.surface === 'source';
        rows = {
          0: '作者  test (Reader) 看板 Test',
          1: '標題  [Test] ' + (source ? 'Source article' : 'Result article'),
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
          4: '    102       9/01 test         □ [Test] Result article',
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
  try {
    await expect.poll(() => page.locator('body').innerText()).toContain('Same-author search results');
  } catch (error) {
    console.log('Shortcut replay state:', await page.evaluate(() => ({
      sent: window.__gestureSent,
      server: window.__shortcutServer.state,
      command: window.__app.commandQueue.inFlightKind,
      cursor: [window.__app.buf.cur_y, window.__app.buf.cur_x]
    })));
    throw error;
  }
  await expect.poll(() => visibleText(page)).toContain('Source article');
}

async function nativeBack(page) {
  await page.goBack();
}

async function openSearchResult(page) {
  await ptt.sendKey(page, 'Enter');
  await expect.poll(() => visibleText(page)).toContain('Result article');
  await expect(page.locator('.main')).toHaveClass(/articleHorizontalGestures/);
}

module.exports = { bootShortcutSearch, searchAuthor, nativeBack, openSearchResult, visibleText, waitSearchResults };
