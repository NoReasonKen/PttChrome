// @unit-env browser
// 文章列表的「+N」（new_comments.listNewPush）在兩種列上的畫法：原生／桌機列疊在列尾的留白上
// Native rows overlay spare trailing cells; mobile cards place the badge before
// the read mark on the second line. Generated text stays out of copied content.
import "../../src/css/main.css";
import { buildRow } from "../../src/render/row";
import { buildListCard } from "../../src/render/list_card";
import { listRow, row, seg } from "./helpers/screen_fixtures";

let host;
afterEach(() => {
  if (host) host.remove();
  host = null;
});

function mount(node) {
  host = document.createElement("div");
  host.id = "mainContainer";
  host.style.cssText = "font: 16px monospace; position: absolute; left: 0; top: 0; white-space: pre;";
  host.appendChild(node);
  document.body.appendChild(host);
  return node;
}

describe("原生列", () => {
  test("列尾留白夠 ⇒ 疊在列尾，不撐寬、不進文字", () => {
    const chars = listRow("someone", "□ [心得] 短標題");
    const plain = mount(buildRow({ chars, row: 5, forceWidth: 16 }).node);
    const w0 = plain.getBoundingClientRect().width;
    const text0 = plain.textContent;
    host.remove();
    const node = mount(buildRow({ chars, row: 5, forceWidth: 16, listNewPush: 3 }).node);
    const badge = node.querySelector('[data-type="bbsline"] > .listNewPush');
    expect(badge).not.toBeNull();
    expect(badge.getAttribute("data-new-push")).toBe("+3");
    expect(getComputedStyle(badge, "::after").content).toBe('"+3"');
    expect(node.textContent).toBe(text0);
    expect(node.getBoundingClientRect().width).toBe(w0);
    // 落在列的右半（列尾），而且沒有超出列的右緣
    const line = node.querySelector('[data-type="bbsline"]').getBoundingClientRect();
    const b = badge.getBoundingClientRect();
    expect(b.left).toBeGreaterThan(line.left + line.width / 2);
    expect(b.right).toBeLessThanOrEqual(line.right + 0.5);
  });

  test("標題寫到最後幾格 ⇒ 不畫（不蓋字）", () => {
    const chars = row(seg(" 350024 + 2 6/14 someone      □ " + "x".repeat(80)));
    const node = mount(buildRow({ chars, row: 5, forceWidth: 16, listNewPush: 3 }).node);
    expect(node.querySelector(".listNewPush")).toBeNull();
  });

  test("沒有 listNewPush ⇒ 輸出跟原本一模一樣（golden 不受影響）", () => {
    const chars = listRow("someone", "□ [心得] 短標題");
    const a = buildRow({ chars, row: 5, forceWidth: 16 }).node.outerHTML;
    const b = buildRow({ chars, row: 5, forceWidth: 16, listNewPush: undefined }).node.outerHTML;
    expect(b).toBe(a);
  });
});

describe("手機卡片", () => {
  test("the badge precedes the read mark and date without changing title alignment or copied text", () => {
    const chars = listRow("someone", "□ [心得] 手機卡片測試");
    const plain = buildListCard({ chars, row: 5, kind: "article", forceWidth: 16 }).node;
    const node = buildListCard({ chars, row: 5, kind: "article", forceWidth: 16, listNewPush: 12 }).node;
    const info = node.querySelector(".listCardMeta .listCardInfo");
    expect([...info.children].map((child) => child.className)).toEqual([
      "listNewPush", "listCardMark", "listCardDate",
    ]);
    expect(info.firstChild.getAttribute("data-new-push")).toBe("+12");
    expect(node.querySelector(".listCardTitle").outerHTML).toBe(plain.querySelector(".listCardTitle").outerHTML);
    expect(node.textContent).toBe(plain.textContent);
  });

  test.each([240, 320, 412])("a %ipx card truncates the author before its badge, mark and date", (width) => {
    const chars = listRow("LongAuthorID", "□ [心得] A long article title");
    const node = mount(buildListCard({ chars, row: 5, kind: "article", forceWidth: 16, listNewPush: 98 }).node);
    node.style.cssText = `display: block; width: ${width}px; white-space: pre;`;
    const main = node.querySelector(".listCardMeta .listCardMain");
    const info = node.querySelector(".listCardMeta .listCardInfo");
    const parts = [...info.children].map((el) => el.getBoundingClientRect());
    expect(info.firstChild.className).toBe("listNewPush");
    expect(main.getBoundingClientRect().right).toBeLessThan(parts[0].left);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].left).toBeGreaterThanOrEqual(parts[i - 1].right);
      expect(Math.abs(parts[i].top - parts[0].top)).toBeLessThan(4);
    }
    expect(parts.at(-1).right).toBeLessThanOrEqual(node.getBoundingClientRect().right);
    expect(getComputedStyle(info.firstChild, "::after").content).toBe('"+98"');
    expect(parseFloat(getComputedStyle(info.firstChild, "::after").fontSize)).toBeCloseTo(12);
    if (width === 240) expect(main.scrollWidth).toBeGreaterThan(main.clientWidth);
  });

  test("看板列表的卡片不畫", () => {
    const chars = listRow("someone", "□ [心得] 手機卡片測試");
    const node = buildListCard({ chars, row: 5, kind: "board", forceWidth: 16, listNewPush: 2 }).node;
    expect(node.querySelector(".listNewPush")).toBeNull();
  });
});
