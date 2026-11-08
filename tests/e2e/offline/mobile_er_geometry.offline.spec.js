// With easy reading on, the page's geometry follows the reader's settings and the
// device only (#157). PTT frames that arrive between two pages (the article's first
// page before it is joined, the search prompt, the jump by article code, the way
// back) are data: they never change the cell size or the page width, and never make
// inline previews forget the heights they measured.
//
// The scenario replays a real PTT session: search a board, open a result, jump by
// article code, go back.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { loadCassette, bootScenario, waitFed } = require('../helpers/replay');

const aidBackSearch = loadCassette('scn-aid-back-search');

const rawIndex = (cassette, k) =>
  cassette.steps.map((s, i) => (s.on === 'raw' ? i : -1)).filter((i) => i >= 0)[k];

async function listEngaged(page) {
  await page.waitForFunction(() => {
    const app = window.__app;
    return app.listSession.state === 'active' && app.buf.listRenderMode === 'buffer' && app.commandQueue.idle;
  });
}

const articleSettled = (page) =>
  page.waitForFunction(() => {
    const a = window.__app;
    return (
      a.buf.pageState === 3 &&
      a.view.useEasyReadingMode &&
      a.easyReading.easyReadingReachedPageEnd &&
      a.aidNavigation.active === false &&
      !a.buf.timerUpdate &&
      !a.buf._settleTimer
    );
  });

// Records every geometry change the page goes through: the cell size and page width
// the view lays the page out with, and each time inline previews are told the layout
// changed (which clears the heights they remembered).
async function watchGeometry(page) {
  await page.evaluate(() => {
    const view = window.__app.view;
    const screen = view.componentScreen;
    const geometry = () => `${view.chw}x${view.chh} width=${view.reflowWidth}`;
    const log = (window.__geometry = { start: geometry(), changes: [], layoutNotices: 0 });
    let last = log.start;
    const setTermFontSize = view.setTermFontSize;
    view.setTermFontSize = function (...args) {
      const result = setTermFontSize.apply(this, args);
      const now = geometry();
      if (now !== last) log.changes.push(`${last} → ${now} (${view.mobileSurface})`);
      last = now;
      return result;
    };
    const notifyLayoutChanged = screen.notifyLayoutChanged;
    screen.notifyLayoutChanged = function (...args) {
      log.layoutNotices += 1;
      return notifyLayoutChanged.apply(this, args);
    };
  });
}

test('search, open, jump by article code and back keep one geometry', async ({ page }) => {
  test.skip(!aidBackSearch, 'scn-aid-back-search is missing (yarn record:scenarios)');
  await bootScenario(page, ptt, aidBackSearch);
  await listEngaged(page);
  await watchGeometry(page);

  await ptt.sendKey(page, 'Slash');
  const box = page.locator('input[name="searchKeyword"]');
  await box.fill(aidBackSearch.meta.keyword);
  await box.press('Enter');
  await page.waitForFunction(() => window.__app.searchInFlight === false);
  await listEngaged(page);

  await ptt.sendKey(page, 'Enter');
  await waitFed(page, rawIndex(aidBackSearch, 0));
  await articleSettled(page);

  await page.evaluate(
    ([aid, board]) => window.__app.aidNavigation.start(aid, board),
    [aidBackSearch.meta.aid, aidBackSearch.meta.board]
  );
  await waitFed(page, rawIndex(aidBackSearch, 2));
  await articleSettled(page);

  await page.evaluate(() => window.__app.aidNavigation.back());
  await waitFed(page, aidBackSearch.steps.length);
  await articleSettled(page);

  const log = await page.evaluate(() => window.__geometry);
  expect(log.changes, `geometry at the start: ${log.start}`).toEqual([]);
  expect(log.layoutNotices).toBe(0);
});
