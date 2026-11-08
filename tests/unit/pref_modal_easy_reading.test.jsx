// @unit-env browser
// The settings page has one easy-reading switch. What easy reading does is
// part of easy reading and has no switch of its own; a remaining sub-setting
// is disabled while easy reading is off and keeps its value.
// The read side is guarded in tests/unit/easy_reading_switch.test.js.
// Template from pref_modal_bell.test.jsx.
import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { PrefModal } from "../../src/components/ContextMenu/PrefModal";
import { setupI18n, i18n } from "../../src/js/i18n";
import { DEFAULT_PREFS } from "../../src/js/pref_storage";

const PREF_KEY = "pttchrome.pref.v1";

// The switches easy reading replaced, the removed safe mode and End switch.
const REMOVED_SWITCHES = [
  "articleHorizontalGestures",
  "enableEasyReadingList",
  "enableBoardListSmoothScroll",
  "enableListNativeAutoResume",
  "skipBoardEntryScreen",
  "enableHelpMenuPopup",
  "reconnectResume",
  "resumeLastPlace",
  "enableHomeDashboard",
  "enableSplitReading",
  "enableNextArticleCard",
  "endTurnsOnLiveUpdate",
  "refreshKeyIntercept",
  "searchKeyOpensModal",
  "enableLongPush",
  "pushKeyOpensLongPush",
  "enableCommentBar",
  "easyReadingBrowserFind",
  "easyReadingEndSwitchNative",
  "easyReadingEndSwitchKey",
  "nativeSafeMode",
];

const openGeneralTab = (prefs = {}, onSave = () => {}) => {
  window.localStorage.setItem(
    PREF_KEY,
    JSON.stringify({ values: { ...DEFAULT_PREFS, ...prefs } }),
  );
  render(
    <MantineProvider>
      <PrefModal
        show
        onSave={onSave}
        onReset={() => {}}
        debugMode={false}
        onDebugModeChange={() => {}}
      />
    </MantineProvider>,
  );
  const tab = screen.getByRole("tab", { name: i18n("options_general") });
  fireEvent.click(tab);
  return document.getElementById(tab.getAttribute("aria-controls"));
};

const closeModal = () =>
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

const field = (root, name) => root.querySelector(`[name="${name}"]`);

beforeAll(() => setupI18n());
beforeEach(() => window.localStorage.clear());

describe("settings page: one easy-reading switch", () => {
  test("the general tab has the switch and no switch for what easy reading does", () => {
    const panel = openGeneralTab();
    expect(field(panel, "enableEasyReading")).toBeChecked();
    for (const key of REMOVED_SWITCHES)
      expect(field(document, key), key).toBeNull();
  });

  test("turning it off disables the sub-settings and keeps their values", () => {
    const onSave = vi.fn();
    const panel = openGeneralTab({}, onSave);
    expect(field(panel, "commentReplyMenu")).toBeEnabled();
    fireEvent.click(field(panel, "enableEasyReading"));
    expect(field(panel, "commentReplyMenu")).toBeDisabled();
    expect(field(panel, "commentReplyMenu")).toBeChecked();
    closeModal();

    const stored = JSON.parse(window.localStorage.getItem(PREF_KEY)).values;
    expect(stored.enableEasyReading).toBe(false);
    expect(stored.commentReplyMenu).toBe(true);
    expect(onSave.mock.calls[0][0]).toMatchObject({ enableEasyReading: false });
  });
});
