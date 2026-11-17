// @unit-env browser
// Reordering the favorites (#221): `S` on the easy-reading favorites opens a
// confirmation sheet first (ContextMenu's FavSortModal). It warns that the
// favorites' current order is overwritten and cannot be undone; a pick goes
// to boardListSession.reorderFavorites, cancel sends nothing.
import { render, act, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import ContextMenu from "../../src/components/ContextMenu";
import { setupI18n, i18n } from "../../src/js/i18n";
import { DEFAULT_PREFS } from "../../src/js/pref_storage";

vi.mock("../../src/js/pref_sync", () => ({
  canSync: vi.fn(() => false),
  savePrefs: vi.fn(),
  signIn: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  onAuthState: vi.fn(() => () => {}),
}));

const makePttchrome = () => ({
  buf: { pageState: 0, rows: 24, cols: 80, startedEasyReading: true, getRowText: () => "" },
  view: { flashListHint: vi.fn() },
  boardListSession: { reorderFavorites: vi.fn(() => true) },
  commandQueue: { enqueue: vi.fn() },
  searchInFlight: false,
  longPush: { start: vi.fn(), cancel: vi.fn(), disarm: vi.fn() },
  imageUpload: { setInsertTarget: vi.fn(), clearInsertTarget: vi.fn() },
  setModalOpen: vi.fn(),
  onDebugRecordDownloaded: () => () => {},
  contextMenuShown: false,
});

const mount = (pttchrome) => {
  document.body.innerHTML = '<div id="BBSWindow"></div>';
  window.localStorage.setItem("pttchrome.pref.v1", JSON.stringify({ values: { ...DEFAULT_PREFS } }));
  return render(
    <MantineProvider>
      <ContextMenu pttchrome={pttchrome} />
    </MantineProvider>,
  );
};

const pick = (which) => document.querySelector(`[data-fav-sort="${which}"]`);

const open = (pttchrome) => {
  let taken;
  act(() => {
    taken = pttchrome.openFavSortChoice();
  });
  expect(taken).toBe(true);
};

beforeAll(() => setupI18n());
afterEach(() => window.localStorage.clear());

test("the sheet warns before anything is sent, and counts as a modal", async () => {
  const pttchrome = makePttchrome();
  mount(pttchrome);
  open(pttchrome);
  await waitFor(() => expect(pick("name")).not.toBeNull());
  const sheet = document.querySelector("[data-fav-sort-choice]");
  expect(sheet.textContent).toContain(i18n("favSort_warning"));
  expect(pick("name").textContent).toBe(i18n("favSort_byName"));
  expect(pick("class").textContent).toBe(i18n("favSort_byClass"));
  expect(pick("cancel").textContent).toBe(i18n("favSort_cancel"));
  expect(pttchrome.setModalOpen).toHaveBeenLastCalledWith("contextMenu", true);
  expect(pttchrome.boardListSession.reorderFavorites).not.toHaveBeenCalled();
});

test("a pick reorders through the session; the sheet closes", async () => {
  for (const which of ["name", "class"]) {
    const pttchrome = makePttchrome();
    const { unmount } = mount(pttchrome);
    open(pttchrome);
    await waitFor(() => expect(pick(which)).not.toBeNull());
    fireEvent.click(pick(which));
    expect(pttchrome.boardListSession.reorderFavorites).toHaveBeenCalledWith(which);
    await waitFor(() => expect(pttchrome.setModalOpen).toHaveBeenLastCalledWith("contextMenu", false));
    unmount();
  }
});

test("cancel sends nothing", async () => {
  const pttchrome = makePttchrome();
  mount(pttchrome);
  open(pttchrome);
  await waitFor(() => expect(pick("cancel")).not.toBeNull());
  fireEvent.click(pick("cancel"));
  await waitFor(() => expect(pttchrome.setModalOpen).toHaveBeenLastCalledWith("contextMenu", false));
  expect(pttchrome.boardListSession.reorderFavorites).not.toHaveBeenCalled();
  expect(pttchrome.commandQueue.enqueue).not.toHaveBeenCalled();
});

test("a pick that finds no favorites list says nothing was reordered", async () => {
  const pttchrome = makePttchrome();
  pttchrome.boardListSession.reorderFavorites = vi.fn(() => false);
  mount(pttchrome);
  open(pttchrome);
  await waitFor(() => expect(pick("name")).not.toBeNull());
  fireEvent.click(pick("name"));
  expect(pttchrome.boardListSession.reorderFavorites).toHaveBeenCalledWith("name");
  expect(pttchrome.view.flashListHint).toHaveBeenCalledWith(i18n("favSort_gone"), 4000, "error");
});

test("a pick that is taken shows no hint", async () => {
  const pttchrome = makePttchrome();
  mount(pttchrome);
  open(pttchrome);
  await waitFor(() => expect(pick("class")).not.toBeNull());
  fireEvent.click(pick("class"));
  expect(pttchrome.view.flashListHint).not.toHaveBeenCalled();
});
