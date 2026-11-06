const { test, expect } = require('@playwright/test');
const { assertScrollCapacity } = require('../helpers/layout');

test('scroll preconditions reject content that would clamp the old position', async ({ page }) => {
  await page.setContent('<div id="reader" style="height:100px;overflow:auto"><div style="height:150px"></div></div>');
  await expect(assertScrollCapacity(page, '#reader', 200)).rejects.toThrow('cannot retain 200px');
  await expect(assertScrollCapacity(page, '#missing', 200)).rejects.toThrow('geometry=null');
  await expect(assertScrollCapacity(page, '#reader', 0)).rejects.toThrow('positive source offset');
});

test('scroll preconditions accept real overflow without moving the reader', async ({ page }) => {
  await page.setContent('<div id="reader" style="height:100px;overflow:auto"><div style="height:400px"></div></div>');
  await page.locator('#reader').evaluate(el => { el.scrollTop = 200; });
  expect(await assertScrollCapacity(page, '#reader', 200)).toEqual({ top: 200, height: 100, content: 400 });
  expect(await page.locator('#reader').evaluate(el => el.scrollTop)).toBe(200);
});
