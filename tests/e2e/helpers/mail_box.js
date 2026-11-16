// A controlled PTT mailbox for offline e2e (#196): the main menu, the mail
// list and a mail, answering the keys the app sends. No recording of the mail
// list or an open mail exists, so every screen here is laid out from the
// pttbbs source, not observed:
//   main menu   helpers/main_menu.js (menu.c#domenu); with new mail its title
//               row carries menu.c#redraw_title's 你有新信件.
//   Ctrl+Z m    menu.c ZA_Enter 'm' → mail.c#m_read: no mail → vmsg("您沒有來信")
//               over the main menu, any key clears it; else i_read(RMAIL).
//   mail list   mail.c#mailtitle → redraw_title("郵件選單") (the board last
//               visited stays on the right), the i_read sub-header with the
//               keys (row 1), the column header from mail_coldefs with
//               "[外信:開] (容量:n/200篇)" on the right (row 2), painted as
//               real PTT paints it: the 30;47 bar with its capacity tag on 42
//               green, so the bar is not one colour to the row's end; the
//               title row on 44 blue and the caption on 34;46. maildoent rows
//               (cursor cell, "%5d %c " number and read mark, %-6s date,
//               sender in 15 cells, ◇ / R: title) and the footer caption
//               read.c#i_read_caption gives RMAIL (信件列表; legacy 鴻雁往返).
//   a mail      mail.c#mail_read → more(): the 作者/標題/時間 header without a
//               看板 field, the body and pmore's status row. Reading it clears
//               its unread mark ('+' → ' ', 'M' → 'm', 'R' → 'r').
// Keys on the list follow read.c#read_nav_cmds (digits⏎ jump, arrows, PgUp/PgDn,
// Home/End, ← q e leave) and mail.c#mail_comms (Enter → r l L read). Every key
// sequence ending in `\f` repaints the whole screen. Senders and subjects are
// invented.
const ptt = require('./ptt');
const { bootOffline } = require('./replay');
const { ART, MAIN_MENU, FIRST_ITEM_ROW } = require('./main_menu');

const MAILS = [
  { from: 'alice', date: '10/28', title: '週末聚餐的時間', mark: ' ' },
  { from: 'bob', date: '10/30', title: 'Re: 週末聚餐的時間', mark: 'r' },
  { from: 'carol', date: '11/02', title: '社團的會議記錄', mark: 'm' },
  { from: 'dave', date: '11/05', title: '[轉錄] 好用的工具', mark: ' ' },
  { from: 'erin', date: '11/12', title: '借書的事情', mark: '+' },
];

// Boot easy reading on the main menu of an account whose mailbox holds `mails`
// (oldest first; the list opens on the newest). `count`: fill the mailbox up to
// this many mails. `delay`: how long the server takes to answer. `legacy`: the
// mail list under the legacy caption 鴻雁往返.
async function bootMailbox(page, { mails = MAILS, count = 0, delay = 40, legacy = false, prefs = {} } = {}) {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true, ...prefs });
  await page.evaluate(({ mails, count, delay, legacy, ART, MAIN_MENU, FIRST_ITEM_ROW }) => {
    const app = window.__app;
    const encode = text => [...text].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    const width = s => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x80 ? 1 : 2), 0);
    const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
    const box = mails.map(m => ({ ...m }));
    for (let n = box.length + 1; n <= count; n++)
      box.unshift({ from: 'frank', date: '9/01', title: '舊信 ' + n, mark: ' ' });
    const ROWS = app.buf.rows;
    const PAGE = ROWS - 4;
    const UNREAD = { '+': ' ', M: 'm', R: 'r' };
    const state = { surface: 'menu', cursor: box.length, line: 1, open: null };
    const newMail = () => box.some(m => m.mark in UNREAD);
    // Each surface as { row: [text, inverse] } and the cursor position.
    const menuRows = () => {
      const title = newMail() ? '【主功能表】     你有新信件     【批踢踢實業坊】' : '【主功能表】';
      const rows = { 0: [pad(title, 80), true] };
      ART.forEach((t, i) => { rows[i + 1] = [t]; });
      MAIN_MENU.items.forEach((t, i) => {
        rows[FIRST_ITEM_ROW + i] = [' '.repeat(20) + (i === MAIN_MENU.cursor ? '>' : ' ') + ' ' + t];
      });
      rows[ROWS - 1] = [pad(MAIN_MENU.status, 79 - width(MAIN_MENU.right)) + MAIN_MENU.right, true];
      return { rows, cursor: [FIRST_ITEM_ROW + MAIN_MENU.cursor + 1, 21] };
    };
    const mailRow = (m, num, cursor) => {
      const mark = m.title.startsWith('Re: ') ? 'R: ' + m.title.slice(4) : '◇ ' + m.title;
      return (cursor ? '>' : ' ') + String(num).padStart(5) + ' ' + m.mark + ' ' + m.date.padEnd(6) + m.from.padEnd(15) + mark;
    };
    const listRows = () => {
      const top = Math.floor((state.cursor - 1) / PAGE) * PAGE + 1;
      const right = '(容量:' + box.length + '/200篇) ';
      const rows = {
        0: [pad('【郵件選單】' + ' '.repeat(14) + '批踢踢實業坊' + ' '.repeat(16) + '看板《Test》', 80), '\x1b[1;37;44m'],
        1: ['[←]離開 [→]閱讀 [R]回信 [x]轉寄 [d]刪除 [^P]寄信 [h]說明'],
        2: [[
          ['\x1b[30;47m', pad('  編號   日 期 作 者          信  件  標  題', 80 - width(right) - 10) + '[外信:開] '],
          ['\x1b[42m', right],
        ]],
        [ROWS - 1]: [[
          ['\x1b[34;46m', legacy ? ' 鴻雁往返 ' : ' 信件列表 '],
          ['\x1b[30;47m', pad(' (R)回信 (x)站內轉寄 (d)刪信 (^P)寄發新信', 60) + '(h)說明 '],
        ]],
      };
      for (let i = 0; i < PAGE && top + i <= box.length; i++)
        rows[3 + i] = [mailRow(box[top + i - 1], top + i, top + i === state.cursor)];
      return { rows, cursor: [4 + state.cursor - top, 1] };
    };
    const mailRows = () => {
      const m = state.open;
      const body = [
        '作者  ' + m.from + ' (' + m.from + ')',
        '標題  ' + m.title,
        '時間  Thu Nov 12 10:00:00 2026',
        '',
        'Mail body from ' + m.from + '.',
        '',
        '--',
      ];
      const rows = {};
      body.forEach((t, i) => { rows[i] = [t]; });
      rows[ROWS - 1] = ['  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~07 行  (R)回信 (h)說明 (←)離開 '];
      return { rows, cursor: [ROWS, 80] };
    };
    const frame = () => {
      const s = state.surface === 'list' ? listRows() : state.surface === 'mail' ? mailRows() : menuRows();
      if (state.surface === 'nomail') {
        s.rows[ROWS - 1] = [pad(' ◆ 您沒有來信', 64) + '[按任意鍵繼續] '];
        s.cursor = [ROWS, 80];
      }
      // A row is [text, style]: style true is inverse video, or an SGR of its
      // own; text can be [sgr, text] segments instead.
      const paint = (text, style) => Array.isArray(text)
        ? text.map(([sgr, t]) => sgr + encode(t)).join('')
        : (style === true ? '\x1b[7m' : style || '') + encode(text);
      let data = '\x1b[H\x1b[2J';
      for (const [row, [text, style]] of Object.entries(s.rows))
        data += '\x1b[' + (Number(row) + 1) + ';1H' + paint(text, style) + '\x1b[0m';
      return data + '\x1b[' + s.cursor[0] + ';' + s.cursor[1] + 'H';
    };
    const read = () => {
      state.open = box[state.cursor - 1];
      if (state.open.mark in UNREAD) state.open.mark = UNREAD[state.open.mark];
      state.surface = 'mail';
    };
    const TOKEN = /\x1b\[[0-9;]*[A-Za-z~]|\x1a[\s\S]|\d+\r|[\s\S]/g;
    const apply = token => {
      if (state.surface === 'nomail') return void (state.surface = 'menu');
      if (state.surface === 'menu') {
        if (token === '\x1am') state.surface = box.length ? 'list' : 'nomail';
        return;
      }
      if (state.surface === 'mail') {
        if (['\x1b[D', 'q'].includes(token)) state.surface = 'list';
        return;
      }
      if (['\x1b[D', 'q', 'e'].includes(token)) state.surface = 'menu';
      else if (/^\d+\r$/.test(token)) state.cursor = Math.min(Math.max(1, parseInt(token, 10)), box.length);
      else if (['\r', '\x1b[C', 'r', 'l', 'L'].includes(token)) read();
      else if (['\x1b[A', 'k', 'p'].includes(token)) state.cursor = Math.max(1, state.cursor - 1);
      else if (['\x1b[B', 'j', 'n'].includes(token)) state.cursor = Math.min(box.length, state.cursor + 1);
      else if (['\x1b[5~', 'P'].includes(token)) state.cursor = Math.max(1, state.cursor - PAGE);
      else if (['\x1b[6~', ' ', 'N'].includes(token)) state.cursor = Math.min(box.length, state.cursor + PAGE);
      else if (['\x1b[1~', '\x1b[H'].includes(token)) state.cursor = 1;
      else if (['\x1b[4~', '\x1b[F', '$'].includes(token)) state.cursor = box.length;
    };
    window.__mailSent = [];
    window.__stubWSSent = bytes => {
      window.__mailSent.push(bytes);
      for (const token of bytes.match(TOKEN) || []) if (token !== '\f') apply(token);
      setTimeout(() => app.onData(frame()), delay);
    };
    window.__mailServer = { state, box, frame };
    app.onData(frame());
  }, { mails, count, delay, legacy, ART, MAIN_MENU, FIRST_ITEM_ROW });
  await page.waitForFunction(() => window.__app.homeDashboard.state.visible);
}

// The list easy reading took the mail list over and is idle.
const mailListActive = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 2 && app.listSession.state === 'active' &&
    app.buf.listRenderMode === 'buffer' && app.commandQueue.idle && !app.buf._settleTimer;
});

const mailSurface = page => page.evaluate(() => window.__mailServer.state.surface);

module.exports = { MAILS, bootMailbox, mailListActive, mailSurface };
