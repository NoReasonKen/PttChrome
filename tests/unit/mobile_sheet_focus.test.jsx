// @unit-env browser
// real-input: tests/e2e/offline/mobile_sheet.offline.spec.js
import { act, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MobileSheet } from '../../src/components/MobileSheet';
import { App } from '../../src/js/pttchrome';

let terminal;
let outside;
beforeEach(() => {
  terminal = document.createElement('input');
  outside = document.createElement('input');
  document.body.append(terminal, outside);
});
afterEach(() => {
  terminal.remove();
  outside.remove();
});

function setup() {
  const core = Object.assign(Object.create(App.prototype), {
    _openModals: new Set(), modalShown: false, inputArea: terminal,
  });
  const content = (first, second = false) => (
    <MantineProvider>
      <MobileSheet pttchrome={core} opened={first} onClose={() => {}} sheetKey="first">
        <input data-autofocus aria-label="First search" />
      </MobileSheet>
      <MobileSheet pttchrome={core} opened={second} onClose={() => {}} sheetKey="second">
        <input data-autofocus aria-label="Second search" />
      </MobileSheet>
    </MantineProvider>
  );
  const view = render(content(true));
  return { core, change: (first, second) => view.rerender(content(first, second)) };
}

test('an outgoing sheet does not steal focus from another open sheet', async () => {
  const { core, change } = setup();
  await vi.waitFor(() => expect(document.querySelector('[data-sheet="first"] input')).toHaveFocus());
  change(false, true);
  await vi.waitFor(() => expect(document.querySelector('[data-sheet="second"] input')).toHaveFocus());
  await vi.waitFor(() => expect(document.querySelector('[data-sheet="first"]')).toBeNull());
  await act(async () => {});
  expect(core.modalShown).toBe(true);
  expect(document.querySelector('[data-sheet="second"] input')).toHaveFocus();
  expect(terminal).not.toHaveFocus();
});

test('an outgoing sheet preserves an explicitly focused outside input', async () => {
  const { change } = setup();
  await vi.waitFor(() => expect(document.querySelector('[data-sheet="first"] input')).toHaveFocus());
  change(false);
  outside.focus();
  expect(outside.matches(':focus-visible')).toBe(true);
  await vi.waitFor(() => expect(document.querySelector('[data-sheet="first"]')).toBeNull());
  await act(async () => {});
  expect(outside).toHaveFocus();
  expect(terminal).not.toHaveFocus();
});
