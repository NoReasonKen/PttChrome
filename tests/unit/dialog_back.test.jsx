// @unit-env browser
// real-input: tests/e2e/offline/mobile_dialog_back.offline.spec.js
import { act, render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { App } from "../../src/js/pttchrome";
import TitleBlacklistModal from "../../src/components/ContextMenu/TitleBlacklistModal";
import LongPushErrorModal from "../../src/components/ContextMenu/LongPushErrorModal";
import LongPushProgressModal from "../../src/components/ContextMenu/LongPushProgressModal";
import PasteShortcutAlert from "../../src/components/PasteShortcutAlert";
import { setupI18n } from "../../src/js/i18n";

beforeAll(() => setupI18n());

const dialogs = [
  ["title blacklist", (opened, props) => (
    <TitleBlacklistModal show={opened} draft="Title" onConfirm={vi.fn()} {...props} />
  )],
  ["long-comment error", (opened, props) => (
    <LongPushErrorModal
      error={opened ? { phase: "sending", message: "Not sent", rest: "Draft", sent: 0 } : null}
      onCopy={vi.fn()}
      {...props}
    />
  )],
  ["long-comment progress", (opened, props) => (
    <LongPushProgressModal progress={opened ? { index: 1, total: 2 } : null} {...props} />
  )],
  ["paste shortcut", (opened, props) => <PasteShortcutAlert opened={opened} {...props} />],
];

describe.each(dialogs)("%s Back ownership", (name, dialog) => {
  test("registers only while open and releases on close and unmount", () => {
    const app = Object.create(App.prototype);
    const close = vi.fn();
    const cancel = vi.fn();
    const props = { pttchrome: app, onHide: close, onClose: close, onCancel: cancel };
    const ui = (opened) => <MantineProvider>{dialog(opened, props)}</MantineProvider>;
    const view = render(ui(false));
    expect(app.dismissTopSheet()).toBe(false);

    view.rerender(ui(true));
    expect(app._sheetDismissers).toHaveLength(1);
    act(() => expect(app.dismissTopSheet()).toBe(true));
    expect(close).toHaveBeenCalledTimes(name === "long-comment progress" ? 0 : 1);
    expect(cancel).not.toHaveBeenCalled();

    view.rerender(ui(false));
    expect(app.dismissTopSheet()).toBe(false);
    view.rerender(ui(true));
    expect(app._sheetDismissers).toHaveLength(1);
    view.unmount();
    expect(app.dismissTopSheet()).toBe(false);
  });

  test("updates its close handler without overtaking a newer overlay", () => {
    const app = Object.create(App.prototype);
    const first = vi.fn();
    const latest = vi.fn();
    const top = vi.fn();
    const ui = (close) => (
      <MantineProvider>{dialog(true, { pttchrome: app, onHide: close, onClose: close })}</MantineProvider>
    );
    const view = render(ui(first));
    const releaseTop = app.registerSheetDismiss(top);
    view.rerender(ui(latest));
    expect(app._sheetDismissers).toHaveLength(2);
    act(() => app.dismissTopSheet());
    expect(top).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    releaseTop();
    act(() => app.dismissTopSheet());
    expect(latest).toHaveBeenCalledTimes(name === "long-comment progress" ? 0 : 1);
    expect(first).not.toHaveBeenCalled();
    view.unmount();
    expect(app.dismissTopSheet()).toBe(false);
  });
});
