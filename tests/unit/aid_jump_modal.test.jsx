// @unit-env browser
// The article-code input (#253) takes what a paste takes (#281): a code in
// any of PTT's spellings, and a whole PTT article link typed into it.
// real-input: tests/e2e/offline/article_aid_jump.offline.spec.js
import { render, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { AidJumpModal } from "../../src/components/ContextMenu/AidJumpModal";
import { setupI18n } from "../../src/js/i18n";

// The longest article link PTT has: a board name of IDLEN (12) characters.
const LINK = "https://www.ptt.cc/bbs/Abcdefghijkl/M.1783270974.A.0CA.html";

beforeAll(() => setupI18n());

function mount() {
  const onConfirm = vi.fn();
  render(
    <MantineProvider>
      <AidJumpModal show onHide={() => {}} onConfirm={onConfirm} />
    </MantineProvider>,
  );
  const input = document.querySelector('input[name="aidCode"]');
  const confirm = document.querySelector('[data-aid-jump] button[type="submit"]');
  return { input, confirm, onConfirm };
}

describe("AidJumpModal", () => {
  test("has room for a whole article link", () => {
    const { input } = mount();
    expect(input.maxLength).toBeGreaterThanOrEqual(LINK.length);
  });

  test("confirms a typed article link as it is", () => {
    const { input, confirm, onConfirm } = mount();
    fireEvent.change(input, { target: { value: LINK } });
    expect(confirm).not.toBeDisabled();
    fireEvent.submit(input.form);
    expect(onConfirm).toHaveBeenCalledWith(LINK);
  });

  test("confirms a code in PTT's spellings, and nothing else", () => {
    const { input, confirm, onConfirm } = mount();
    for (const text of ["#1AbCdEfG", "#1AbCdEfG (Test)", "Test #1AbCdEfG"]) {
      fireEvent.change(input, { target: { value: text } });
      expect(confirm).not.toBeDisabled();
    }
    for (const text of ["hello", "https://www.ptt.cc/bbs/Test/index.html", "https://example.com/bbs/Test/M.1783270974.A.0CA.html"]) {
      fireEvent.change(input, { target: { value: text } });
      expect(confirm).toBeDisabled();
      fireEvent.submit(input.form);
    }
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
