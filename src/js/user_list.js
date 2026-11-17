// PTT's online user list (#199): reading its screens. Pure functions over a
// TermBuf or a row of cells, no DOM and no state.
//
// The list (talk.c's user list, 【休閒聊天】 or 【好友列表】) is a list easy
// reading holds like an article list (list_session.classifyUserListScreen);
// this module is what the presentation around it reads (docs/easy-reading.md
// 「線上使用者（#199）」).
//
// A user row, by cell (0-based, end exclusive):
//   [0]      cursor mark `>`
//   [1,7)    number, right-aligned; numbers run from 1 without gaps
//   [8]      pager / state character (not presented)
//   [10,22)  user ID (at most 12 characters; cell 22 is always blank)
//   [23,41)  nickname
//   [41,58)  home / description / record column (`S` switches it; not presented)
//   [58,75)  activity (動態)
//   [75,80)  idle time, right-aligned
// A friend's ID cells are bright cyan; nothing else on the row is coloured.
// A user who logged off between PTT's count and its paint shows
// `< 離站中..>` in place of the ID (read from talk.c's format, not seen on
// screen).

import { rowHasTitle, userListViewOfRow } from './screen_titles';
import { userListFooterRow } from './screen_captions';
import { OWNER_ARTICLE_LIST } from './list_render_owner';
import { rowToText } from './comment_parse';

export const USER_ID_COL_START = 10;
export const USER_ID_COL_END = 22;
// Bright cyan (getFg: 6 + 8).
const FRIEND_FG = 14;
const USER_ID_RE = /^[A-Za-z][A-Za-z0-9]{1,11}$/;
const GONE_MARK = '離站中';

// The text of cells [start, end): both ends fall between characters on a
// user row (the number and ID cells are ASCII, cell 40 is blank).
function cellsText(chars, start, end) {
  return rowToText(chars.slice(start, end));
}

// One user row's identity: { id, friend, gone }. `id` is null on a row whose
// user logged off (`gone`). Returns null for a row that is not a user row.
export function parseUserListRow(chars) {
  if (!chars || chars.length < USER_ID_COL_END) return null;
  if (!/^[>\s]*\d+\s/.test(cellsText(chars, 0, 8))) return null;
  if (cellsText(chars, 8, 41).indexOf(GONE_MARK) >= 0) return { id: null, friend: false, gone: true };
  const id = cellsText(chars, USER_ID_COL_START, USER_ID_COL_END).trim();
  if (!USER_ID_RE.test(id)) return null;
  const first = chars[USER_ID_COL_START];
  const friend = !!(first && typeof first.getFg === 'function' && first.getFg() === FRIEND_FG);
  return { id: id, friend: friend, gone: false };
}

function rowTexts(buf) {
  const out = [];
  for (let r = 0; r < buf.rows; ++r) out.push(buf.getRowText(r, 0, buf.cols));
  return out;
}

// userListView over the screen's row texts.
export function userListViewOfTexts(texts) {
  const view = userListViewOfRow((texts && texts[0]) || '');
  if (!view) return null;
  const header = texts[2] || '';
  if (header.indexOf('編號') < 0 || header.indexOf('代號') < 0) return null;
  return userListFooterRow(texts) >= 0 ? view : null;
}

// Which view of the user list `buf` shows: 'all' (【休閒聊天】, every user),
// 'friends' (【好友列表】, friends only), or null when it is not the user list
// (the help screen and the query screen keep the title, but not the column
// header and the footer).
export function userListView(buf) {
  if (!buf || !buf.rows) return null;
  return userListViewOfTexts(rowTexts(buf));
}

// The view the friends/all toggle (`f`) would show from this screen, for the
// toolbar entries: 'friends' over the list of all users, 'all' over the
// friends view, null when easy reading does not hold the user list or a
// prompt is open. `facts` is article_search.searchGateFacts' shape.
export function userListToggleTarget(facts) {
  if (!facts || facts.inputField || facts.listOwner !== OWNER_ARTICLE_LIST) return null;
  const view = userListViewOfTexts(facts.rowTexts || []);
  return view === 'all' ? 'friends' : view === 'friends' ? 'all' : null;
}

// The i18n key of the toggle entries' label, which names the view it shows:
// 只看好友 toward the friends view, 顯示全部使用者 toward every user.
export function userListToggleLabel(target) {
  return target === 'friends' ? 'userList_showFriends' : 'userList_showAll';
}

// The user ID of the user list's selected card, or null: the list held is not
// the user list, nothing is selected, or the selected user logged off.
// `core` is the app (core.listSession).
export function selectedUserId(core) {
  const ls = core && core.listSession;
  if (!ls || !ls.isUserList || !ls.isUserList()) return null;
  const user = parseUserListRow(ls.selectedListRow());
  return user ? user.id : null;
}

// The labels of PTT's user query screen (talk.c's my_query): each is `《` +
// four full-width characters + `》`, from col 0 (left column) or col 40.
const QUERY_ID_LABEL = '《ＩＤ暱稱》';
const QUERY_LABELS = ['《登入次數》', '《目前動態》', '《上次上站》'];

// The query screen of one user, after `q` on the list or `Q` and an ID: a row
// that starts with 《ＩＤ暱稱》 and, under it, one of the rows that follow it
// (登入次數, 目前動態, 上次上站). PTT draws it over the list from row 1 without
// clearing row 0, and its 請按任意鍵繼續 bar comes later on PTT's last row; a
// redraw after a resize leaves the bar out. Neither row 0 nor the bar is read.
export function isUserQueryScreen(buf) {
  if (!buf || !buf.rows) return false;
  const texts = rowTexts(buf);
  for (let r = 0; r < texts.length; ++r) {
    if ((texts[r] || '').indexOf(QUERY_ID_LABEL) !== 0) continue;
    for (let k = r + 1; k < texts.length; ++k) {
      const t = texts[k] || '';
      for (let j = 0; j < QUERY_LABELS.length; ++j) if (t.indexOf(QUERY_LABELS[j]) === 0) return true;
    }
    return false;
  }
  return false;
}

export const USER_QUERY_TITLE = '查詢網友';
const QUERY_PROMPT = '請輸入使用者代號:';

// The `Q` prompt over the user list: title 【查詢網友】 on row 0 and
// 「請輸入使用者代號: 」 with its input field on row 1, the rest blank.
export function isUserQueryPrompt(buf) {
  if (!buf || !buf.rows || buf.rows < 2) return false;
  return (
    rowHasTitle(buf.getRowText(0, 0, buf.cols), USER_QUERY_TITLE) &&
    buf.getRowText(1, 0, buf.cols).indexOf(QUERY_PROMPT) === 0
  );
}
