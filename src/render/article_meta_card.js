// 手機好讀文章的檔頭（docs/mobile.md「收起終端機標頭／狀態列」）。只在
// enhance.commentCards（＝手機換行版面＋穩定列，term_view._renderScreenLines）時由
// render/screen.js#_renderRow 取代 buildRow；桌機零改動（golden 快照不經過這裡）。
//
// pmore 的檔頭（mbbsd/pmore.c `_fh_disp_heads` ＝ 作者／標題／時間／轉信，最多
// FH_HEADERS=4 列）之後，第 fh.lines 列是整列 `─` 的分隔線（同檔 "header separator
// line"，bpref.rawmode＝MFDISP_RAW_NA 時才畫）。手機上每一列都收起
// （render/collapsed_row.js）：標題、看板、時間、作者已經在三行的 App Bar 上（#66），
// 收起的列各帶 `articleMeta--<種類>` class。
// 判斷**只看該列自己**（列號 ＜ ARTICLE_META_MAX_ROWS ＋ 該列文字的形狀）⇒ dirty-row
// patch 的列獨立前提不破。反向讀取／從中段開始時第 0 列不是檔頭，形狀不吻合就照舊畫。
// 開燈的純文字模式（`作者: x (y) 看板: z`）同樣吃得下（parseArticleHeader 的冒號形狀）。
//
// 保留的外部契約：外層 span[type=bbsrow][srow]、內層 [data-type=bbsline][data-row]
// （選取複製反查；整篇複製讀的是 buffer，檔頭照樣在）。
import { buildCollapsedRow } from "./collapsed_row";
import {
  rowToText,
  parseArticleHeader,
  parseArticleTitle,
} from "../js/comment_parse";

// 檔頭最多 4 列＋分隔線 1 列。
export const ARTICLE_META_MAX_ROWS = 5;

const TIME_RE = /^\s*(時間|轉信)[:：]?\s+(.*?)\s*$/;
const RULE_RE = /^\s*─{8,}\s*$/;

// 該列是檔頭的哪一種（不是回 null）。
export function articleMetaKind(chars, row) {
  if (!(row >= 0 && row < ARTICLE_META_MAX_ROWS) || !chars) return null;
  const text = rowToText(chars);
  if (row === 0) return parseArticleHeader(text) ? "author" : null;
  if (parseArticleTitle(text)) return "title";
  if (TIME_RE.test(text)) return "time";
  if (RULE_RE.test(text)) return "rule";
  return null;
}

// 檔頭列 → 收起的節點；不是檔頭回 null（呼叫端照舊 buildRow）。
export function buildArticleMetaRow(chars, row) {
  const kind = articleMetaKind(chars, row);
  return kind ? buildCollapsedRow(row, "articleMeta--" + kind) : null;
}
