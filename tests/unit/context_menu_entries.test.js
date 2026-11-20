// 右鍵／長按選單的項目清單（components/ContextMenu/context_menu_entries.js）。
// 鎖：「設為全部已讀」只在桌機右鍵選單；手機長按選單不放全選／圖片上傳／設為全部已讀
// （改在工具列「更多」，tests/unit/mobile_toolbar.test.jsx），且不留連續的分隔線。
import { buildContextMenuEntries } from "../../src/components/ContextMenu/context_menu_entries";
import { i18n, setupI18n } from "../../src/js/i18n";

beforeAll(() => setupI18n());

const BASE = {
  normalEnabled: true,
  selEnabled: false,
  urlEnabled: false,
  imageUploadEnabled: true,
  markAllReadEnabled: true,
  onMenuSelect: () => {},
};
const keys = (p) => buildContextMenuEntries(p).map((e) => e.key);
const MOVED = ["selectAll", "uploadImage", "uploadHistory", "markAllRead"];

test("桌機：文章列表有「設為全部已讀」，點下去走 onMenuSelect('markAllRead')", () => {
  const calls = [];
  const entries = buildContextMenuEntries({
    ...BASE,
    onMenuSelect: (k) => calls.push(k),
  });
  const item = entries.find((e) => e.key === "markAllRead");
  expect(item).toBeDefined();
  item.onClick({});
  expect(calls).toEqual(["markAllRead"]);
  for (const k of MOVED) expect(keys(BASE)).toContain(k);
});

test("桌機：不在文章列表（markAllReadEnabled 假）就沒有", () => {
  expect(keys({ ...BASE, markAllReadEnabled: false })).not.toContain(
    "markAllRead",
  );
});

// #199: the online user list's friends/all toggle, labelled with the view it shows.
test("桌機：線上使用者列表有好友／全部切換，標籤是切過去的視圖", () => {
  const calls = [];
  const on = (target) =>
    buildContextMenuEntries({
      ...BASE,
      markAllReadEnabled: false,
      userListToggle: target,
      onMenuSelect: (k) => calls.push(k),
    }).find((e) => e.key === "userListToggle");
  const friends = on("friends");
  expect(friends).toBeDefined();
  expect(friends.label).toBe(i18n("userList_showFriends"));
  expect(on("all").label).toBe(i18n("userList_showAll"));
  expect(friends.label).not.toBe(on("all").label);
  friends.onClick({});
  expect(calls).toEqual(["userListToggle"]);
  expect(keys({ ...BASE, userListToggle: null })).not.toContain("userListToggle");
  // The phone has it in the toolbar's More sheet.
  expect(keys({ ...BASE, mobile: true, userListToggle: "friends" })).not.toContain("userListToggle");
});

test("查詢網友（#199）：桌機右鍵在線上使用者列表才有；手機在工具列「更多」", () => {
  const calls = [];
  const p = {
    ...BASE,
    markAllReadEnabled: false,
    userQueryEnabled: true,
    onMenuSelect: (k) => calls.push(k),
  };
  const item = buildContextMenuEntries(p).find((e) => e.key === "userQuery");
  expect(item.label).toBe(i18n("userQuery_title"));
  item.onClick({});
  expect(calls).toEqual(["userQuery"]);
  expect(keys({ ...p, userQueryEnabled: false })).not.toContain("userQuery");
  expect(keys({ ...p, mobile: true })).not.toContain("userQuery");
});

test("手機：全選／圖片上傳／設為全部已讀都不在長按選單", () => {
  const k = keys({ ...BASE, mobile: true });
  for (const m of MOVED) expect(k).not.toContain(m);
  expect(k).toContain("paste");
  expect(k).toContain("settings");
});

test("看板列表「<板名> 設為已讀」：桌機與手機長按都在（要指定是哪一列）", () => {
  const calls = [];
  const p = {
    ...BASE,
    markAllReadEnabled: false,
    boardMarkReadTarget: { num: 5, name: "C_Chat" },
    onMenuSelect: (k) => calls.push(k),
  };
  for (const mobile of [false, true]) {
    const item = buildContextMenuEntries({ ...p, mobile }).find(
      (e) => e.key === "boardMarkRead",
    );
    expect(item).toBeDefined();
    expect(item.label).toContain("C_Chat");
    item.onClick({});
  }
  expect(calls).toEqual(["boardMarkRead", "boardMarkRead"]);
  expect(keys({ ...p, boardMarkReadTarget: null })).not.toContain(
    "boardMarkRead",
  );
});

test("回覆這則：有目標才出現（推文段最前面），標題帶帳號，點下去走 onMenuSelect('replyComment')", () => {
  const calls = [];
  const entries = buildContextMenuEntries({
    ...BASE,
    mobile: true,
    replyCommentTarget: "abc123",
    previews: { copyComment: "abc123: 推文" },
    onMenuSelect: (k) => calls.push(k),
  });
  const ks = entries.map((e) => e.key);
  expect(ks.indexOf("replyComment")).toBe(ks.indexOf("copyComment") - 1);
  const item = entries.find((e) => e.key === "replyComment");
  expect(item.label).toContain("abc123");
  item.onClick({});
  expect(calls).toEqual(["replyComment"]);
  expect(keys(BASE)).not.toContain("replyComment");
});

test("沒有連續的分隔線（手機工具段搬空時）", () => {
  for (const p of [BASE, { ...BASE, mobile: true }]) {
    const types = buildContextMenuEntries(p).map((e) => e.type);
    for (let i = 1; i < types.length; ++i)
      expect(types[i] === "divider" && types[i - 1] === "divider").toBe(false);
  }
});

// 手機推文卡片：長按就能「複製這則推文」（推文第一個字貼著螢幕左緣，拉不到選取把手）。
// 出現條件＝預覽算得出來，與連結旗標無關（長按推文裡的網址也要給）。
describe("複製推文", () => {
  test("有預覽才出現，點下去走 onMenuSelect 帶 key，預覽畫在第二行", () => {
    const calls = [];
    const entries = buildContextMenuEntries({
      ...BASE,
      mobile: true,
      normalEnabled: false,
      urlEnabled: true,
      previews: { copyComment: "這則", copyCommentAll: "這則\n下一則" },
      onMenuSelect: (k) => calls.push(k),
    });
    const one = entries.find((e) => e.key === "copyComment");
    const all = entries.find((e) => e.key === "copyCommentAll");
    expect(one.preview).toBe("這則");
    expect(all.preview).toBe("這則\n下一則");
    one.onClick({});
    all.onClick({});
    expect(calls).toEqual(["copyComment", "copyCommentAll"]);
  });

  test("沒有預覽（不在推文卡片上／桌機）⇒ 不出現", () => {
    expect(keys({ ...BASE, previews: {} })).not.toContain("copyComment");
    expect(keys({ ...BASE, previews: {} })).not.toContain("copyCommentAll");
  });
});

test("board list view switches (#221): desktop only, the first label follows the view", () => {
  const calls = [];
  const p = { ...BASE, markAllReadEnabled: false, onMenuSelect: (k) => calls.push(k) };
  const at = (toggles, mobile = false) =>
    buildContextMenuEntries({ ...p, boardToggles: toggles, mobile });
  const numbered = at({ counts: false, sort: "switch" });
  expect(numbered.find((e) => e.key === "boardCounts").label).toBe("Show article counts");
  expect(numbered.find((e) => e.key === "boardSort").label).toBe("Switch sort (by name / by class)");
  expect(at({ counts: true, sort: "switch" }).find((e) => e.key === "boardCounts").label).toBe("Show board numbers");
  // The favorites: the sort entry reorders them; the class root has neither entry.
  expect(at({ counts: false, sort: "favorites" }).find((e) => e.key === "boardSort").label).toBe("Reorder favorites");
  expect(at({ counts: false, sort: false }).map((e) => e.key)).not.toContain("boardSort");
  expect(at({ counts: null, sort: false }).map((e) => e.key)).not.toContain("boardCounts");
  expect(at({ counts: null, sort: false }).map((e) => e.key)).not.toContain("boardSort");
  numbered.find((e) => e.key === "boardCounts").onClick({});
  numbered.find((e) => e.key === "boardSort").onClick({});
  expect(calls).toEqual(["boardCounts", "boardSort"]);
  for (const k of ["boardCounts", "boardSort"]) {
    expect(keys({ ...p, boardToggles: null })).not.toContain(k);
    expect(keys({ ...p, boardToggles: { counts: false, sort: "switch" }, mobile: true })).not.toContain(k);
  }
});

// #254: 查詢作者 on an article row, on the desktop menu and the phone's sheet
// alike, right after the author's blacklist entry and before the divider.
test("文章列：查詢作者帶作者 ID，桌機手機都有，點下去走 onMenuSelect('queryAuthor')", () => {
  for (const mobile of [false, true]) {
    const calls = [];
    const entries = buildContextMenuEntries({
      ...BASE,
      mobile,
      authorBlacklistId: "bob",
      authorQueryTarget: { num: 103, pinnedKey: null, author: "bob" },
      onMenuSelect: (k) => calls.push(k),
    });
    const at = entries.findIndex((e) => e.key === "queryAuthor");
    expect(at).toBe(entries.findIndex((e) => e.key === "addAuthorBlacklist") + 1);
    expect(entries[at].label).toBe(`${i18n("authorQuery_title")} 'bob'`);
    entries[at].onClick({});
    expect(calls).toEqual(["queryAuthor"]);
  }
  expect(keys({ ...BASE, authorQueryTarget: null })).not.toContain("queryAuthor");
  expect(keys({ ...BASE, normalEnabled: false, authorQueryTarget: { author: "bob" } })).not.toContain("queryAuthor");
  // Alone it still gets its divider.
  const only = buildContextMenuEntries({ ...BASE, markAllReadEnabled: false, authorQueryTarget: { author: "bob" } });
  const at = only.findIndex((e) => e.key === "queryAuthor");
  expect(only[at + 1]).toMatchObject({ type: "divider", key: "d-blacklist" });
});

// #261: article information. On a list row, desktop and mobile alike, after the
// author query; over an article, desktop only (mobile has it in More).
test("文章列：文章資訊在查詢作者之後，桌機手機都有，點下去走 onMenuSelect('postInfo')", () => {
  for (const mobile of [false, true]) {
    const calls = [];
    const entries = buildContextMenuEntries({
      ...BASE,
      mobile,
      authorQueryTarget: { num: 103, pinnedKey: null, author: "bob" },
      postInfoTarget: { num: 103, pinnedKey: null, title: "[問題] 一篇" },
      onMenuSelect: (k) => calls.push(k),
    });
    const at = entries.findIndex((e) => e.key === "postInfo");
    expect(at).toBe(entries.findIndex((e) => e.key === "queryAuthor") + 1);
    expect(entries[at].label).toBe(i18n("postInfo_title"));
    entries[at].onClick({});
    expect(calls).toEqual(["postInfo"]);
  }
  expect(keys({ ...BASE, postInfoTarget: null })).not.toContain("postInfo");
  expect(keys({ ...BASE, normalEnabled: false, postInfoTarget: { num: 1 } })).not.toContain("postInfo");
  const only = buildContextMenuEntries({ ...BASE, markAllReadEnabled: false, postInfoTarget: { num: 1 } });
  const at = only.findIndex((e) => e.key === "postInfo");
  expect(only[at + 1]).toMatchObject({ type: "divider", key: "d-blacklist" });
});

test("文章：文章資訊在複製本篇文章連結之後，桌機右鍵與手機長按都有", () => {
  for (const mobile of [false, true]) {
    const calls = [];
    const entries = buildContextMenuEntries({
      ...BASE,
      mobile,
      articleLinkEnabled: true,
      articlePostInfoEnabled: true,
      onMenuSelect: (k) => calls.push(k),
    });
    const at = entries.findIndex((e) => e.key === "articlePostInfo");
    expect(at).toBe(entries.findIndex((e) => e.key === "copyArticleLink") + 1);
    expect(entries[at].label).toBe(i18n("postInfo_title"));
    entries[at].onClick({});
    expect(calls).toEqual(["articlePostInfo"]);
  }
  expect(keys({ ...BASE, articlePostInfoEnabled: false })).not.toContain("articlePostInfo");
});
