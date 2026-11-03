// @unit-env browser
// Restore defaults (設回預設值) wipes every preference, so it asks first, and on
// narrow screens it appears once, at the end of About, rather than in every category.
// Mantine and PrefModal CSS are injected so the narrow layout and colours are real.
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { page } from "vitest/browser";
import mantineCss from "@mantine/core/styles.css?raw";
import prefModalCss from "../../src/components/ContextMenu/PrefModal.css?raw";
import { PrefModal, PREF_CATEGORIES } from "../../src/components/ContextMenu/PrefModal";
import { setupI18n, i18n } from "../../src/js/i18n";
import { DEFAULT_PREFS, readValuesWithDefault } from "../../src/js/pref_storage";

const PREF_KEY = "pttchrome.pref.v1";

let style;
beforeAll(() => {
  setupI18n();
  style = document.createElement("style");
  style.textContent = mantineCss + "\n" + prefModalCss;
  document.head.appendChild(style);
});
afterAll(() => style.remove());
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    PREF_KEY,
    JSON.stringify({ values: { ...DEFAULT_PREFS, fontSize: DEFAULT_PREFS.fontSize + 4 } }),
  );
});
afterEach(() => page.viewport(1024, 768));

const openModal = () => {
  const onReset = vi.fn();
  let back = null;
  const registerBack = (fn) => {
    back = fn;
    return () => { if (back === fn) back = null; };
  };
  render(
    <MantineProvider>
      <PrefModal
        show
        onSave={() => {}}
        onReset={onReset}
        debugMode={false}
        onDebugModeChange={() => {}}
        registerBack={registerBack}
      />
    </MantineProvider>,
  );
  return { onReset, back: () => act(() => back()) };
};

const settings = () => document.querySelector(".PrefModal");
const resetButtons = () =>
  within(settings()).queryAllByRole("button", { name: i18n("options_reset"), exact: true });
const confirmation = () => screen.queryByRole("dialog", { name: i18n("options_reset") });
const isRed = (button) => {
  const [r, g] = getComputedStyle(button).backgroundColor.match(/\d+/g).map(Number);
  return r > g * 1.5;
};
const customized = () => readValuesWithDefault().fontSize === DEFAULT_PREFS.fontSize + 4;

test("restoring defaults changes nothing until the confirmation is accepted", async () => {
  const { onReset } = openModal();
  const [reset] = resetButtons();
  expect(isRed(reset)).toBe(true);

  fireEvent.click(reset);
  const dialog = await screen.findByRole("dialog", { name: i18n("options_reset") });
  expect(within(dialog).getByText(i18n("options_resetConfirm"))).toBeInTheDocument();
  const cancel = within(dialog).getByRole("button", { name: i18n("options_resetCancel") });
  await vi.waitFor(() => expect(document.activeElement).toBe(cancel));
  fireEvent.click(cancel);
  await vi.waitFor(() => expect(confirmation()).toBeNull());
  expect(onReset).not.toHaveBeenCalled();
  expect(customized()).toBe(true);

  fireEvent.click(resetButtons()[0]);
  const again = await screen.findByRole("dialog", { name: i18n("options_reset") });
  const confirm = within(again).getByRole("button", { name: i18n("options_reset") });
  expect(isRed(confirm)).toBe(true);
  fireEvent.click(confirm);
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(customized()).toBe(false);
  expect(readValuesWithDefault().fontSize).toBe(DEFAULT_PREFS.fontSize);
});

test("system Back and Escape cancel the confirmation and keep Settings open", async () => {
  const { onReset, back } = openModal();
  fireEvent.click(resetButtons()[0]);
  await screen.findByRole("dialog", { name: i18n("options_reset") });
  back();
  await vi.waitFor(() => expect(confirmation()).toBeNull());
  expect(settings()).not.toBeNull();

  fireEvent.click(resetButtons()[0]);
  const dialog = await screen.findByRole("dialog", { name: i18n("options_reset") });
  fireEvent.keyDown(within(dialog).getByRole("button", { name: i18n("options_resetCancel") }), { key: "Escape" });
  await vi.waitFor(() => expect(confirmation()).toBeNull());
  expect(settings()).not.toBeNull();
  expect(onReset).not.toHaveBeenCalled();
  expect(customized()).toBe(true);
});

test("narrow Settings shows the reset only at the end of About", async () => {
  await page.viewport(390, 800);
  openModal();
  await vi.waitFor(() => expect(settings()).not.toBeNull());
  for (const { value } of PREF_CATEGORIES) {
    const row = document.querySelector(`[data-pref-category="${value}"]`);
    if (!row) {
      fireEvent.click(document.querySelector("[data-pref-category-back]"));
    }
    fireEvent.click(document.querySelector(`[data-pref-category="${value}"]`));
    const visible = resetButtons().filter((b) => b.getClientRects().length > 0);
    expect(visible, value).toHaveLength(value === "about" ? 1 : 0);
  }
  const [reset] = resetButtons();
  expect(reset.closest(".PrefModal__about-selectable")).not.toBeNull();
  expect(isRed(reset)).toBe(true);
});
