// @unit-env browser
// 已讀文章低亮（pref dimReadArticles）的渲染接線：
//   1. 標註層對已讀的列表列無條件標 listRead ⇒ 列帶 data-list-read，未讀不帶；
//   2. 容器 class dimReadList 只跟 pref 走，且切換當場生效（設定頁走 redraw(true)）；
//   3. 非列表列（表頭、footer）不帶屬性。
// 判定規則本身在 list_read.test.js。
import { mountScreen, unmountAll } from "./helpers/mount_screen";
import { row, seg } from "./helpers/screen_fixtures";

afterEach(unmountAll);

const listLine = (type, author, title) =>
  row(seg(` 350024 ${type} 2 6/14 ${(author + "            ").slice(0, 12)}${title}`));

const LINES = [
  row(seg("【板主:someone】     看板《Test》")),
  row(seg("[←]離開 [→]閱讀")),
  row(seg("   編號    日 期 作  者       文  章  標  題")),
  listLine(" ", "readuser", "□ [心得] 已讀文章"),
  listLine("+", "newuser", "□ [心得] 未讀文章"),
  listLine("~", "newpush", "R: [心得] 有新推文"),
  // 作者不是 userid（PttCurrent 的「系統」公告，2026-10-08 錄製檔）也要能低亮。
  row(seg("   1650     9/20 系統         □ [開發資訊] 請實作ECMA-48")),
  row(seg("   1651 +   9/20 系統         □ [開發資訊] 未讀")),
  row(seg("  文章選讀  (y)回應(X)推文(^X)轉錄")),
];

const props = (dimReadArticles, readContrastStyle) => ({
  lines: LINES,
  enableLinkInlinePreview: false,
  enableLinkHoverPreview: false,
  enhance: { pageState: 2, dimReadArticles, readContrastStyle },
});

const readRows = (m) =>
  [...m.container.querySelectorAll("[data-list-read]")].map((n) => n.getAttribute("srow"));

describe("已讀文章低亮", () => {
  test("只有已讀的列表列帶 data-list-read", () => {
    expect(readRows(mountScreen(props(true)))).toEqual(["3", "6"]);
  });

  test("pref 關 ⇒ 屬性照帶、容器不掛 dimReadList", () => {
    const m = mountScreen(props(false));
    expect(readRows(m)).toEqual(["3", "6"]);
    expect(m.container.classList.contains("dimReadList")).toBe(false);
  });

  test("pref 開 ⇒ 掛；切換當場生效", () => {
    const m = mountScreen(props(true));
    expect(m.container.classList.contains("dimReadList")).toBe(true);
    m.update(props(false));
    expect(m.container.classList.contains("dimReadList")).toBe(false);
    m.update(props(true));
    expect(m.container.classList.contains("dimReadList")).toBe(true);
  });
});

// #60: the read/unread treatment is one container class next to dimReadList.
describe("已讀／未讀樣式（readContrastStyle）", () => {
  const styleClasses = (m) => [...m.container.classList].filter((c) => c.startsWith("readStyle-"));

  test("掛 readStyle-<值>，切換當場換成新的那一個，不留舊的", () => {
    const m = mountScreen(props(true, "dim"));
    expect(styleClasses(m)).toEqual(["readStyle-dim"]);
    m.update(props(true, "brightUnreadBar"));
    expect(styleClasses(m)).toEqual(["readStyle-brightUnreadBar"]);
    m.update(props(true, "brightUnread"));
    expect(styleClasses(m)).toEqual(["readStyle-brightUnread"]);
  });

  test("沒有值 ⇒ 不掛任何 readStyle-", () => {
    const m = mountScreen(props(true, "brightUnread"));
    m.update(props(true, undefined));
    expect(styleClasses(m)).toEqual([]);
  });

  test("不重建列：切換前後是同一批列節點", () => {
    const m = mountScreen(props(true, "dim"));
    const before = m.container.querySelector('[srow="4"]');
    m.update(props(true, "brightUnread"));
    expect(m.container.querySelector('[srow="4"]')).toBe(before);
  });
});
