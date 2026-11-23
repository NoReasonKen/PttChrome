// @unit-env browser
// PTT's `v` question on the article list (#299): the choice sheet is
// ContextMenu's MarkReadChoiceModal, opened by pttchrome.openMarkReadChoice.
// Nothing is sent until a pick; a pick goes to markAllRead.startAnswer.
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
  markAllRead: { startAnswer: vi.fn(() => true) },
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

const pick = (which) => document.querySelector(`[data-mark-read="${which}"]`);

const open = (pttchrome) => {
  let taken;
  act(() => {
    taken = pttchrome.openMarkReadChoice();
  });
  expect(taken).toBe(true);
};

beforeAll(() => setupI18n());
afterEach(() => window.localStorage.clear());

test("the sheet offers PTT's three answers and cancel, sends nothing, and counts as a modal", async () => {
  const pttchrome = makePttchrome();
  mount(pttchrome);
  open(pttchrome);
  await waitFor(() => expect(pick("U")).not.toBeNull());
  expect(pick("U").textContent).toBe(i18n("markReadChoice_allUnread"));
  expect(pick("V").textContent).toBe(i18n("markReadChoice_allRead"));
  expect(pick("W").textContent).toBe(i18n("markReadChoice_readBefore"));
  expect(pick("cancel").textContent).toBe(i18n("markReadChoice_cancel"));
  expect(pttchrome.setModalOpen).toHaveBeenLastCalledWith("contextMenu", true);
  expect(pttchrome.markAllRead.startAnswer).not.toHaveBeenCalled();
});

test("each pick goes to markAllRead.startAnswer and closes the sheet", async () => {
  for (const which of ["U", "V", "W"]) {
    const pttchrome = makePttchrome();
    const { unmount } = mount(pttchrome);
    open(pttchrome);
    await waitFor(() => expect(pick(which)).not.toBeNull());
    fireEvent.click(pick(which));
    expect(pttchrome.markAllRead.startAnswer).toHaveBeenCalledWith(which);
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
  expect(pttchrome.markAllRead.startAnswer).not.toHaveBeenCalled();
  expect(pttchrome.commandQueue.enqueue).not.toHaveBeenCalled();
});
