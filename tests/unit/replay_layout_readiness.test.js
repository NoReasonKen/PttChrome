import { waitRectStable } from '../e2e/helpers/layout.js';

const rect = { top: 20, left: 0, width: 412, height: 280 };

test.each(['top', 'left', 'width', 'height'])('full rectangle readiness waits for %s to stop changing', async property => {
  const readings = [0, 10, 20, 20, 20].map(offset => ({ ...rect, [property]: rect[property] + offset }));
  const page = { evaluate: vi.fn(async () => readings.shift()) };
  await waitRectStable(page, '.main', { fullRect: true, samples: 3, interval: 0 });
  expect(page.evaluate).toHaveBeenCalledTimes(5);
});

test('existing top-only readiness remains unchanged unless full rectangle checks are requested', async () => {
  let width = 400;
  const page = { evaluate: vi.fn(async () => ({ ...rect, width: width++ })) };
  await waitRectStable(page, '.main', { samples: 3, interval: 0 });
  expect(page.evaluate).toHaveBeenCalledTimes(3);
});
