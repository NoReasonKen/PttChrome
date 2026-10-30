// @unit-env browser
// 手機好讀文章的檔頭（render/article_meta_card.js、docs/mobile.md「收起終端機標頭／狀態列」）。
// 鎖：pmore 檔頭（mbbsd/pmore.c _fh_disp_heads＋header separator line）的每一列都收起（#66：
// 資訊在三行 App Bar）、只看該列自己（非檔頭形狀照舊）、外部契約保留、只在 enhance.commentCards 時才取代 buildRow。
import {
  articleMetaKind,
  buildArticleMetaRow,
  ARTICLE_META_MAX_ROWS,
} from "../../src/render/article_meta_card";
import { mountScreen, unmountAll } from "./helpers/mount_screen";
import { row, seg, color, SCENARIOS } from "./helpers/screen_fixtures";

afterEach(() => unmountAll());

const AUTHOR = row(seg(" 作者 ", color(4, 7)), seg(" jason050117 (阿傑)                         看板 ask"));
const AUTHOR_RAW = row(seg("作者: jason050117 (阿傑) 看板: ask"));
const TITLE = row(seg(" 標題 ", color(4, 7)), seg(" Re: [請問] 網頁版PTT 游標 怎麼變回 圓點?"));
const TIME = row(seg(" 時間 ", color(4, 7)), seg(" Wed Aug 12 00:19:48 2026"));
const RULE = row(seg("─".repeat(39), color(6, 0)));
const BODY = row(seg("作者  這行其實是內文，不在第 0 列"));

describe("articleMetaKind（只看列號＋該列文字）", () => {
  test("檔頭四種", () => {
    expect(articleMetaKind(AUTHOR, 0)).toBe("author");
    expect(articleMetaKind(AUTHOR_RAW, 0)).toBe("author");
    expect(articleMetaKind(TITLE, 1)).toBe("title");
    expect(articleMetaKind(TIME, 2)).toBe("time");
    expect(articleMetaKind(RULE, 3)).toBe("rule");
  });

  test("作者只認第 0 列；超出檔頭範圍一律不是", () => {
    expect(articleMetaKind(BODY, 2)).toBe(null);
    expect(articleMetaKind(TITLE, ARTICLE_META_MAX_ROWS)).toBe(null);
    expect(articleMetaKind(RULE, 9)).toBe(null);
    expect(articleMetaKind(row(seg("一般內文")), 1)).toBe(null);
  });
});

// #66: the App Bar now carries the board, time and author, so on the phone every
// header row collapses, like the separator line already did.
describe("buildArticleMetaRow", () => {
  const contract = (node, r) => {
    expect(node.getAttribute("type")).toBe("bbsrow");
    expect(node.getAttribute("srow")).toBe(String(r));
    expect(node.querySelector(`[data-type="bbsline"][data-row="${r}"]`)).not.toBe(null);
  };

  test("檔頭每一列都收起（契約保留），各帶自己的種類 class", () => {
    for (const [chars, r, kind] of [
      [AUTHOR, 0, "author"],
      [AUTHOR_RAW, 0, "author"],
      [TITLE, 1, "title"],
      [TIME, 2, "time"],
      [RULE, 3, "rule"],
    ]) {
      const n = buildArticleMetaRow(chars, r);
      contract(n, r);
      expect(n.classList.contains("mobileCollapsedRow")).toBe(true);
      expect(n.classList.contains(`articleMeta--${kind}`)).toBe(true);
    }
  });

  test("不是檔頭 ⇒ null（呼叫端照舊 buildRow）", () => {
    expect(buildArticleMetaRow(BODY, 2)).toBe(null);
  });
});

describe("ScreenController：只在 enhance.commentCards 時收起檔頭", () => {
  const easy = SCENARIOS.find((s) => s.name === "article_easy_reading");
  const props = (commentCards) => ({ ...easy, enhance: { ...easy.enhance, commentCards } });
  const node = (m, r) => m.container.querySelector(`[type="bbsrow"][srow="${r}"]`);

  test("手機換行版面：第 0、1 列收起，內文照舊", () => {
    const m = mountScreen(props(true));
    expect(node(m, 0).classList.contains("mobileCollapsedRow")).toBe(true);
    expect(node(m, 1).classList.contains("mobileCollapsedRow")).toBe(true);
    expect(node(m, 4).classList.contains("mobileCollapsedRow")).toBe(false);
  });

  test("桌機（沒有 commentCards）：一列都不換", () => {
    const m = mountScreen(props(undefined));
    expect(m.container.querySelector(".mobileCollapsedRow")).toBe(null);
  });
});
