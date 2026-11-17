// A controlled PTT online user list for offline e2e (#199): the main menu, the
// user list in its two views, the query screen and the `Q` prompt, answering
// the keys the app sends. The frames follow a real user-list frame (the
// layout notes of #199), and every ID, nickname and place is invented:
//   main menu   helpers/main_menu.js; Ctrl+Z u opens the user list.
//   user list   row 0 the blue title bar 【休閒聊天】 (all users) or 【好友列表】
//               (friends only), the BBS name bright yellow, cell 79 default;
//               row 1 the sort and counts; row 2 the black-on-white column
//               header (編號 P 代號 暱稱 故鄉 動態 發呆) across the row; user rows
//               with `>` in cell 0, the number right-aligned in cells 1-6, the
//               pager in cell 8, the ID from cell 10 (a friend's ID cells bright
//               cyan), the nickname from 23, the home from 41, the activity
//               from 58 and the idle time in 75-79. A user who logs off between
//               two reads is a `< 離站中..>` row without an ID. The footer on
//               PTT's last row: the caption 「 休閒聊天 」 blue on cyan, then
//               black-on-white hints with red key labels; a list with no user
//               (the friends view with no friend online) has a footer of its
//               own. A page is rows-4 users; the last page is short.
//   keys        arrows (and j/k/n/p), PgUp/PgDn (the cursor on the first user
//               of the page), Home/End, digits⏎ jump (clamped), `f`/`F` toggle
//               the view (back to user 1), `q` the query screen of the user
//               under the cursor (any key back), `Q` the 【查詢網友】 prompt (an
//               ID⏎ shows its query screen, an empty ⏎ or an ID nobody online
//               has goes back), ← / e / E the main menu. Every key sequence
//               ending in `\f` repaints the whole screen. The view is an
//               account flag (UF_FRIEND): Ctrl+Z u shows the view the list was
//               left in, from user 1.
//               `window.__userListServer.refuseUsers = true` plays a guest
//               (no PERM_LOGINOK): Ctrl+Z u redraws the main menu.
//   query       (#199 phase 2) the fields from row 1, the plan of a user from
//               row 7 (`plans`) or the 「目前沒有名片」 line, the 請按任意鍵繼續
//               bar on the last row. The key leaving it is answered after
//               `sleepMs` more (PTT sleeps before it draws the list again).
//   alert       `state.flood` ('denied' or 'slowed', one query): ID⏎ draws the
//               usage-limit alert ( 使用限制 , the status, a reason) instead;
//               its key goes back to the list (denied) or on to the query
//               screen (slowed).
// Not observed, built from the layout notes alone: the number jump, the
// arrows and PgUp/PgDn at the list's ends (clamped here), where PTT parks
// the cursor on an empty view (row 3 here) and the form of a `< 離站中..>`
// row.
const ptt = require('./ptt');
const { bootOffline } = require('./replay');
const { ART, MAIN_MENU, FIRST_ITEM_ROW } = require('./main_menu');

// Boot easy reading on the main menu of a site with `count` users online.
// `friends`: the numbers (in the all-users view) of the users who are friends,
// bright cyan there and the only users of the friends view; none by default,
// so the friends view is empty. `gone`: the number of a user who logged off.
// `delay`: how long the server takes to answer. `plans`: { number: lines } of
// the users with a plan. `sleepMs`: PTT's sleep after the key on the query
// screen, before the list.
async function bootUserList(page, { count = 60, friends = [], gone = 0, delay = 40, plans = {}, sleepMs = 0, prefs = {} } = {}) {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true, ...prefs });
  await page.evaluate(({ count, friends, gone, delay, plans, sleepMs, ART, MAIN_MENU, FIRST_ITEM_ROW }) => {
    const app = window.__app;
    const encode = text => [...text].map(ch => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    const width = s => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x80 ? 1 : 2), 0);
    const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
    const padLeft = (s, n) => ' '.repeat(Math.max(0, n - width(s))) + s;
    const at = (row, col = 0) => '\x1b[' + (row + 1) + ';' + (col + 1) + 'H';
    const PLACES = ['某地', '*', '東區網路', '西岸'];
    const ACTS = ['閱讀文章', '看板列表', '主選單', '使用者名單'];
    const IDLES = ['3h06', "0'03", '13h37', '', "35'16"];
    const users = [];
    for (let n = 1; n <= count; n++) {
      users.push({
        id: 'user' + String(n).padStart(3, '0'),
        nick: n % 5 === 0 ? '' : '暱稱' + n,
        place: PLACES[n % PLACES.length],
        act: ACTS[n % ACTS.length],
        idle: IDLES[n % IDLES.length],
        pager: n % 3 === 0 ? '-' : ' ',
        friend: friends.includes(n),
        gone: n === gone,
        plan: plans[n] || null,
      });
    }
    const ROWS = app.buf.rows;
    const PAGE = ROWS - 4;
    const state = { surface: 'menu', view: 'all', cursor: 1, typed: '', query: null, flood: null, alert: null };
    const shown = () => state.view === 'friends' ? users.filter(u => u.friend) : users;
    const SGR = '\x1b[m';
    const menuFrame = () => {
      let s = at(0) + '\x1b[7m' + pad('【主功能表】', 80) + SGR;
      ART.forEach((t, i) => { s += at(i + 1) + t; });
      MAIN_MENU.items.forEach((t, i) => {
        s += at(FIRST_ITEM_ROW + i) + ' '.repeat(20) + (i === MAIN_MENU.cursor ? '>' : ' ') + ' ' + t;
      });
      s += at(ROWS - 1) + '\x1b[7m' + pad(MAIN_MENU.status, 79 - width(MAIN_MENU.right)) + MAIN_MENU.right + SGR;
      return s + at(FIRST_ITEM_ROW + MAIN_MENU.cursor, 20);
    };
    const titleBar = title => '\x1b[1;37;44m' + pad(title, 33) + '\x1b[33m批踢踢實業坊\x1b[37m' +
      pad('', 4) + pad('看板《SomeBoard》', 30) + SGR + ' ';
    const userRow = (u, num, cursor) => {
      const lead = (cursor ? '>' : ' ') + padLeft(String(num), 6) + ' ' + u.pager + ' ';
      if (u.gone) return lead + '< 離站中..>';
      const id = u.friend ? '\x1b[1;36m' + pad(u.id, 13) + SGR : pad(u.id, 13);
      return lead + id + pad(u.nick, 18) + pad(u.place, 17) + pad(u.act, 17) + padLeft(u.idle, 5);
    };
    const footer = hints => {
      let s = '\x1b[34;46m 休閒聊天 \x1b[30;47m ';
      for (const [k, label] of hints) s += '\x1b[31m(' + k + ')\x1b[30m' + label;
      return s + SGR;
    };
    const HINTS = [['w', '丟水球 '], ['q', '查詢 '], ['→', '聊天 '], ['m', '寄信 '], ['Tab', '排序       '], ['←', '離開 '], ['h', '說明  ']];
    const EMPTY_HINTS = [['Tab', '排序 '], ['f', '好友 '], ['s', '搜尋 '], ['b', '廣播 '], ['S', '顯示切換      '], ['←', '離開 '], ['h', '說明  ']];
    const listFrame = () => {
      const list = shown();
      const top = Math.floor((state.cursor - 1) / PAGE) * PAGE + 1;
      let s = at(0) + titleBar(state.view === 'friends' ? '【好友列表】' : '【休閒聊天】');
      s += at(1) + ' 排序:[朋友] 站上:' + (count + 40) + ' \x1b[1;32m朋友:' + friends.length +
        ' \x1b[33m與我為友:0 \x1b[36m板友:0 \x1b[31m壞人:0' + SGR;
      s += at(2) + '\x1b[30;47m' +
        pad('   編號 P 代號         暱稱              故鄉             動態              發呆', 80) + SGR;
      for (let i = 0; i < PAGE && top + i <= list.length; i++)
        s += at(3 + i) + userRow(list[top + i - 1], top + i, top + i === state.cursor);
      s += at(ROWS - 1) + footer(list.length ? HINTS : EMPTY_HINTS);
      return s + (list.length ? at(3 + state.cursor - top) : at(3));
    };
    // The query screen: drawn from row 1 over the list, row 0 kept, the
    // 請按任意鍵繼續 bar on the last row.
    const queryFrame = () => {
      const u = state.query;
      const lines = [
        pad('《ＩＤ暱稱》' + u.id + ' (' + (u.nick || u.id) + ')', 40) + '《經濟狀況》清寒',
        pad('《登入次數》12 次 (同天內只計一次)', 40) + '《有效文章》3 篇 (退:0)',
        pad('《目前動態》' + u.act, 40) + '《私人信箱》最近無新信件',
        pad('《上次上站》01/02/2026 03:04:05 Fri', 40) + '《上次故鄉》' + u.place,
        pad('《 五子棋 》    0 勝     0 敗     0 和', 40) + '《象棋戰績》    0 勝     0 敗     0 和',
        '',
      ];
      if (u.plan) lines.push(...u.plan);
      else lines.push('《個人名片》' + u.id + ' 目前沒有名片');
      let s = at(0) + titleBar(state.view === 'friends' ? '【好友列表】' : '【休閒聊天】');
      lines.forEach((t, i) => { s += at(1 + i) + t; });
      s += at(ROWS - 1) + '\x1b[1;34;44m' + '▄'.repeat(15) + ' \x1b[37m請按任意鍵繼續\x1b[34m ' + '▄'.repeat(15) + SGR;
      return s + at(ROWS - 1, 79);
    };
    // The `Q` prompt: 【查詢網友】 over the title, the prompt and its 13-cell
    // reverse field on row 1, every other row blank.
    const promptFrame = () =>
      at(0) + '\x1b[1;37;44m【查詢網友】' + SGR + at(1) + '請輸入使用者代號: \x1b[30;47m' +
      pad(state.typed, 13) + SGR + at(1, 18 + state.typed.length);
    // The usage-limit alert (talk.c#alert_screen): its status on the blue row
    // 0, the reason below, the 請按任意鍵繼續 bar.
    const alertFrame = () =>
      at(0) + '\x1b[1;37;44m 使用限制 \x1b[33m ' + (state.alert === 'denied' ? '查詢' : '限速中') + ' ' + SGR +
      at(2) + '  \x1b[1;31m操作過於頻繁，請稍後再試' + SGR +
      at(ROWS - 1) + '\x1b[1;34;44m' + '▄'.repeat(15) + ' \x1b[37m請按任意鍵繼續\x1b[34m ' + '▄'.repeat(15) + SGR +
      at(ROWS - 1, 79);
    const frame = () => {
      const s = state.surface === 'list' ? listFrame() : state.surface === 'query' ? queryFrame()
        : state.surface === 'prompt' ? promptFrame() : state.surface === 'alert' ? alertFrame() : menuFrame();
      return '\x1b[H\x1b[2J' + encode(s);
    };
    const move = to => {
      const last = shown().length;
      state.cursor = last ? Math.min(Math.max(1, to), last) : 1;
    };
    const TOKEN = /\x1b\[[0-9;]*[A-Za-z~]|\x1a[\s\S]|\d+\r|[\s\S]/g;
    const apply = token => {
      if (state.surface === 'menu') {
        if (token === '\x1au' && !window.__userListServer.refuseUsers) {
          state.surface = 'list';
          state.cursor = 1;
        }
        return;
      }
      if (state.surface === 'query') {
        state.surface = 'list';
        state.slept = true;
        return;
      }
      if (state.surface === 'alert') {
        state.surface = state.alert === 'slowed' && state.query ? 'query' : 'list';
        state.alert = null;
        return;
      }
      if (state.surface === 'prompt') {
        const enter = token.endsWith('\r');
        if (/^\d+\r$/.test(token)) state.typed += token.slice(0, -1);
        else if (token === '\x7f' || token === '\b') state.typed = state.typed.slice(0, -1);
        else if (!enter && token.length === 1 && token >= ' ') state.typed = (state.typed + token).slice(0, 12);
        if (!enter) return;
        const u = state.typed && users.find(x => !x.gone && x.id.toLowerCase() === state.typed.toLowerCase());
        state.typed = '';
        state.query = u || null;
        state.surface = u ? 'query' : 'list';
        if (state.flood) {
          state.alert = state.flood;
          state.flood = null;
          state.surface = 'alert';
        }
        return;
      }
      const PAGE_TOP = () => Math.floor((state.cursor - 1) / PAGE) * PAGE + 1;
      if (['\x1b[D', 'e', 'E'].includes(token)) state.surface = 'menu';
      else if (/^\d+\r$/.test(token)) move(parseInt(token, 10));
      else if (token === 'f' || token === 'F') {
        state.view = state.view === 'all' ? 'friends' : 'all';
        state.cursor = 1;
      } else if (token === 'q') {
        const u = shown()[state.cursor - 1];
        if (u && !u.gone) {
          state.query = u;
          state.surface = 'query';
        }
      } else if (token === 'Q') state.surface = 'prompt';
      else if (['\x1b[A', 'k', 'p'].includes(token)) move(state.cursor - 1);
      else if (['\x1b[B', 'j', 'n'].includes(token)) move(state.cursor + 1);
      else if (['\x1b[5~', 'P'].includes(token)) move(PAGE_TOP() - PAGE);
      else if (['\x1b[6~', ' ', 'N'].includes(token)) {
        if (PAGE_TOP() + PAGE <= shown().length) move(PAGE_TOP() + PAGE);
      } else if (['\x1b[1~', '\x1b[H'].includes(token)) move(1);
      else if (['\x1b[4~', '\x1b[F', '$'].includes(token)) move(shown().length);
    };
    window.__userListSent = [];
    window.__stubWSSent = bytes => {
      window.__userListSent.push(bytes);
      state.slept = false;
      for (const token of bytes.match(TOKEN) || []) if (token !== '\f') apply(token);
      setTimeout(() => app.onData(frame()), delay + (state.slept ? sleepMs : 0));
    };
    window.__userListServer = { state, users, frame, PAGE };
    app.onData(frame());
  }, { count, friends, gone, delay, plans, sleepMs, ART, MAIN_MENU, FIRST_ITEM_ROW });
  await page.waitForFunction(() => window.__app.homeDashboard.state.visible);
}

// Sends `keys` to PTT as they are, past easy reading's key policy and the
// home dashboard's entrance (the reader's way in is the dashboard's 線上使用者
// button, mobile_user_list_entry.offline.spec.js).
const sendRaw = (page, keys) => page.evaluate(k => window.__app.conn.send(k), keys);

// The list easy reading took the user list over and is idle.
const userListActive = page => page.waitForFunction(() => {
  const app = window.__app;
  return app.buf.pageState === 2 && app.listSession.state === 'active' && app.listSession.isUserList() &&
    app.buf.listRenderMode === 'buffer' && app.commandQueue.idle && !app.buf._settleTimer;
});

const userListSurface = page => page.evaluate(() => {
  const { surface, view } = window.__userListServer.state;
  return surface === 'list' ? surface + ':' + view : surface;
});

module.exports = { bootUserList, sendRaw, userListActive, userListSurface };
