// @unit-env browser
// 設定「本機」分頁的搜尋紀錄入口（#70）：管理頁是本機設定底下的一頁，跟分類一樣
// 一層層蓋上去；返回（頁內的返回、系統返回）回到本機設定，不關設定。也要從設定搜尋
// 找得到。管理頁本身的行為守在 search_history_manager.test.jsx。
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { PrefModal } from "../../src/components/ContextMenu/PrefModal";
import { setupI18n, i18n } from "../../src/js/i18n";
import { searchPrefSettings } from "../../src/js/pref_search";

beforeAll(() => {
  setupI18n();
});
beforeEach(() => {
  localStorage.clear();
});

const modal = (show, registerBack) => (
  <MantineProvider>
    <PrefModal
      show={show}
      onSave={() => {}}
      onReset={() => {}}
      debugMode={false}
      onDebugModeChange={() => {}}
      registerBack={registerBack}
    />
  </MantineProvider>
);
const manager = () => document.querySelector("[data-search-history-manager]");
const localContent = () => document.querySelector('input[name="imageUploadToken"]');

async function openManager() {
  fireEvent.click(screen.getByRole("tab", { name: i18n("options_local") }));
  fireEvent.click(document.querySelector('[data-pref-subpage="searchHistory"]'));
  await waitFor(() => expect(manager()).not.toBeNull());
}

test("入口是整列可點的項目；點進去整頁換成管理頁，返回回到本機設定", async () => {
  render(modal(true));
  fireEvent.click(screen.getByRole("tab", { name: i18n("options_local") }));
  const row = document.querySelector('[data-pref-subpage="searchHistory"]');
  expect(row.textContent).toContain(i18n("searchHistoryManager_title"));
  expect(row.textContent).toContain(i18n("tooltip_searchHistoryManager"));
  expect(manager()).toBeNull();
  await openManager();
  expect(localContent()).toBeNull();
  fireEvent.click(document.querySelector("[data-pref-subpage-back]"));
  await waitFor(() => expect(manager()).toBeNull());
  expect(localContent()).not.toBeNull();
  expect(document.querySelector(".PrefModal")).not.toBeNull();
});

test("系統返回：在管理頁＝回到本機設定，不關設定", async () => {
  let back = null;
  const registerBack = vi.fn((fn) => {
    back = fn;
    return () => {};
  });
  render(modal(true, registerBack));
  await openManager();
  back();
  await waitFor(() => expect(manager()).toBeNull());
  expect(localContent()).not.toBeNull();
});

test("管理頁開著時關掉設定，下次打開設定不會停在管理頁", async () => {
  const { rerender } = render(modal(true));
  await openManager();
  rerender(modal(false));
  rerender(modal(true));
  await waitFor(() => expect(manager()).toBeNull());
  expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
});

test("設定搜尋找得到它，跳到本機分頁", () => {
  const hit = searchPrefSettings(i18n("searchHistoryManager_title")).find(
    (h) => h.key === "ui:searchHistoryManager",
  );
  expect(hit).toBeTruthy();
  expect(hit.tab).toBe("local");
});
