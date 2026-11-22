// Board information (#288): reading PTT's 看板資訊 screen, the `i` of the
// article list (mbbsd/bbs.c bbs_cmd_config → board.c#b_config). Pure: screen
// row texts in, plain data out.
//
// b_config is a PSB list (psb.c) with two header rows and one footer row, so a
// page holds `rows - 3` items (21 on a 24-row screen):
//   row 0      vs_draw_hdr2: " 看板設定與管理  [唯讀檢視]" (an editor reads
//              "[唯讀模式 (按 Ctrl-P 編輯)]")
//   row 1      bconfig_header: "名稱: <board>  板主: <moderators> <notes>",
//              or "板主: (無)"
//   rows 2..   bconfig_renderer: "  " + "%2d" + ". " + "   " + desc + pad +
//              "  " + value; the cursor row starts with ">" (STR_CURSOR) or
//              "●" (UF_CURSOR_LEGACY) in the first columns
//   last row   vs_cmd_bar: caption " 看板資訊 " (" 看板設定 " for an editor)
// The items (board.c#bconfig_items) run past one page: the rest is read with
// PgDn, which moves the page by its height, or to the last item when that
// would run past the end — the last page is drawn again (psb_cmd_pgdn).
// docs/pttbbs-screen-protocol.md §11.10.

const TITLE = '看板設定與管理';
const CAPTIONS = ['看板資訊', '看板設定'];
const BOARD_ROW_RE = /^名稱:\s*(\S+)\s+板主:\s*(.*)$/;
const ITEM_ROW_RE = /^(?:>|●)?\s*(\d+)\.\s+(.*)$/;
// The value is printed two columns past the widest description; a short
// description is padded up to that width.
const VALUE_GAP_RE = /\s{2,}/;

// Whether the screen is PTT's board information (its title row), whatever
// its rows hold. Only this screen is ever left with ← (the PSB's quit key).
export function isBoardInfoScreen(rowTexts) {
  return !!rowTexts && String(rowTexts[0] || '').trim().startsWith(TITLE);
}

// One page of the screen as { board, moderators, items: [{ num, label,
// value }], firstNum, capacity }, or null when the screen is not the board
// information or a row does not read as PTT prints it.
export function parseBoardInfoPage(rowTexts) {
  if (!isBoardInfoScreen(rowTexts)) return null;
  const rows = rowTexts.length;
  if (rows < 4) return null;
  const footer = String(rowTexts[rows - 1] || '').trim().split(/\s+/)[0];
  if (CAPTIONS.indexOf(footer) < 0) return null;
  const head = BOARD_ROW_RE.exec(String(rowTexts[1] || '').trim());
  if (!head) return null;
  const items = [];
  for (let r = 2; r < rows - 1; ++r) {
    const text = String(rowTexts[r] || '').replace(/\s+$/, '');
    if (!text.trim()) continue;
    const m = ITEM_ROW_RE.exec(text.trimStart());
    if (!m) return null;
    const num = Number(m[1]);
    // Items are numbered in order down the page, without gaps.
    if (items.length && num !== items[items.length - 1].num + 1) return null;
    const rest = m[2];
    const gap = VALUE_GAP_RE.exec(rest);
    const label = (gap ? rest.slice(0, gap.index) : rest).trim();
    const value = gap ? rest.slice(gap.index + gap[0].length).trim() : '';
    if (!label) return null;
    items.push({ num, label, value });
  }
  if (!items.length) return null;
  const moderators = head[2].trim();
  return {
    board: head[1],
    moderators: moderators === '(無)' ? '' : moderators,
    items,
    firstNum: items[0].num,
    capacity: rows - 3
  };
}

// The pages read so far ({ board, moderators, items }, null before the first)
// with `page` added, as { info, more }: `more` is whether another PgDn is
// needed. A page that is not full is the last; so is a page with nothing new
// (PgDn on a last page that is full draws it again). null when the page skips
// items or names another board: the rows read cannot be put together.
export function mergeBoardInfoPage(info, page) {
  const full = page.items.length >= page.capacity;
  if (!info) {
    if (page.firstNum !== 1) return null;
    return { info: { board: page.board, moderators: page.moderators, items: page.items.slice() }, more: full };
  }
  if (page.board !== info.board) return null;
  const last = info.items[info.items.length - 1].num;
  const fresh = page.items.filter((item) => item.num > last);
  if (!fresh.length) return { info, more: false };
  if (fresh[0].num !== last + 1) return null;
  return { info: { board: info.board, moderators: info.moderators, items: info.items.concat(fresh) }, more: full };
}
