// 搜尋種類切換列（標題／作者／推文數／看板，SearchKindControl.jsx）的版面檢查：
// 搜尋視窗與管理搜尋紀錄頁共用。
const { expect } = require('@playwright/test');

// 每一格的字都完整顯示、整列不超出：英文比較長，放不下就在格子裡換行。
async function expectKindLabelsFit(control) {
  const overflow = await control.evaluate((root) =>
    [root, ...root.querySelectorAll('.mantine-SegmentedControl-label')]
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => el.textContent),
  );
  expect(overflow).toEqual([]);
}

module.exports = { expectKindLabelsFit };
