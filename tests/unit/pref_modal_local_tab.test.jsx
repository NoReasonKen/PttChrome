// @unit-env browser
// 設定「本機」分頁的搜尋紀錄入口（#70）：管理視窗從這裡打開，也要從設定搜尋找得到。
// 管理視窗本身的行為守在 search_history_manager.test.jsx。
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

test("「管理搜尋紀錄」打開管理視窗，「完成」關回設定", async () => {
  render(
    <MantineProvider>
      <PrefModal
        show
        onSave={() => {}}
        onReset={() => {}}
        debugMode={false}
        onDebugModeChange={() => {}}
      />
    </MantineProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: i18n("options_local") }));
  expect(document.querySelector("[data-search-history-manager]")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: i18n("searchHistoryManager_title") }),
  );
  await waitFor(() =>
    expect(document.querySelector("[data-search-history-manager]")).not.toBeNull(),
  );
  fireEvent.click(document.querySelector("[data-manager-done]"));
  await waitFor(() =>
    expect(document.querySelector("[data-search-history-manager]")).toBeNull(),
  );
  expect(screen.getByRole("tab", { name: i18n("options_local") })).toBeTruthy();
});

test("管理視窗開著時關掉設定，下次打開設定不會再冒出管理視窗", async () => {
  const modal = (show) => (
    <MantineProvider>
      <PrefModal
        show={show}
        onSave={() => {}}
        onReset={() => {}}
        debugMode={false}
        onDebugModeChange={() => {}}
      />
    </MantineProvider>
  );
  const { rerender } = render(modal(true));
  fireEvent.click(screen.getByRole("tab", { name: i18n("options_local") }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n("searchHistoryManager_title") }),
  );
  await waitFor(() =>
    expect(document.querySelector("[data-search-history-manager]")).not.toBeNull(),
  );
  rerender(modal(false));
  rerender(modal(true));
  // 關閉動畫結束後就不在了；沒有重設的話會一直開著。
  await waitFor(() =>
    expect(document.querySelector("[data-search-history-manager]")).toBeNull(),
  );
  expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
});

test("設定搜尋找得到它，跳到本機分頁", () => {
  const hit = searchPrefSettings(i18n("searchHistoryManager_title")).find(
    (h) => h.key === "ui:searchHistoryManager",
  );
  expect(hit).toBeTruthy();
  expect(hit.tab).toBe("local");
});
