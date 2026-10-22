const { expect } = require('@playwright/test');
const ptt = require('./ptt');
const { bootOffline, waitScreenSettled } = require('./replay');
const { waitPreviewsSettled, waitRectStable } = require('./layout');

const PREVIEW = '#mainContainer img.hyperLinkPreview';
const VIEWER = '.pswp[role="dialog"][aria-label="Image viewer"]';
const VIEWER_IMAGE = `${VIEWER} .pswp__img:not(.pswp__img--placeholder)`;

async function feedScreen(page, rows) {
  await page.evaluate((rows) => {
    const encode = (str) => [...str].map((ch) => {
      const c = ch.charCodeAt(0);
      return c < 128 ? ch : String.fromCharCode(window.lib.u2bArray[2 * c], window.lib.u2bArray[2 * c + 1]);
    }).join('');
    let bytes = '\x1b[2J';
    for (const [row, text] of Object.entries(rows)) bytes += `\x1b[${Number(row) + 1};1H${encode(text)}`;
    window.__app.onData(`${bytes}\x1b[24;80H`);
  }, rows);
}

async function bootImageArticle(page, opts = {}) {
  await bootOffline(page, ptt, opts);
  if (opts.imageResponse) {
    await page.route('**/viewer-*.png', (route) => route.fulfill(opts.imageResponse));
  }
  await ptt.applyPrefs(page, {
    enableEasyReading: true,
    enableEasyReadingList: false,
    enablePicPreview: true,
    useMouseBrowsing: true,
    mouseLeftClick: true,
  });
  await feedScreen(page, {
    0: '【板主：test】看板《Test》',
    1: '[←]離開 [→]閱讀 [^P]發表文章 [b]備忘錄',
    2: '  編號    日 期 作  者       文  章  標  題',
    3: '    101       9/01 test         □ [Test] Image viewing',
    23: ' 文章選讀  (y)回應(X)推文(^X)轉錄 ',
  });
  await waitScreenSettled(page, { 2: '編號', 23: '文章選讀' });
  await feedScreen(page, {
      0: '作者  test (Reader) 看板 Test',
      1: '標題  [Test] Image viewing',
      2: '時間  Mon Sep  1 12:00:00 2025',
      4: 'https://i.urusai.cc/viewer-one.png',
      6: 'Article text between image previews.',
      8: 'https://i.urusai.cc/viewer-two.png',
      22: '推 reader: Final comment                                      09/01 12:34',
      23: '  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 01~23 行  (y)回應(X%)推文(h)說明(←)離開 ',
  });
  await waitScreenSettled(page, { 0: '作者', 23: '瀏覽' });
  // Match replayCassette: offline article data does not pass through a live navigation edge.
  await page.evaluate(() => window.__app.easyReading.enterEasyReading());
  await waitPreviewsSettled(page);
  await expect(page.locator(PREVIEW).first()).toBeVisible();
}

async function openPreviewViewer(page, { touch = false } = {}) {
  const image = page.locator(PREVIEW).first();
  await image.scrollIntoViewIfNeeded();
  await waitPreviewsSettled(page);
  await waitRectStable(page, PREVIEW);
  if (touch) await image.tap();
  else await image.click();
  await expect(page.locator(VIEWER)).toBeVisible();
  await expect(page.locator(VIEWER_IMAGE)).toBeVisible();
  await waitRectStable(page, VIEWER_IMAGE);
}

const articleGeometry = (page) => page.evaluate(() => {
  const scroller = document.querySelector('.main');
  const article = document.querySelector('#mainContainer');
  return {
    scrollTop: scroller.scrollTop,
    articleHeight: article.getBoundingClientRect().height,
    images: [...article.querySelectorAll('img.hyperLinkPreview')].map((img) => {
      const r = img.getBoundingClientRect();
      return { width: r.width, height: r.height, top: r.top };
    }),
  };
});

async function collectSent(page) {
  await page.evaluate(() => {
    window.__imageViewerSent = [];
    window.__stubWSSent = (bytes) => window.__imageViewerSent.push(bytes);
  });
}

const sentText = (page) => page.evaluate(() => (window.__imageViewerSent || []).join(''));

module.exports = {
  PREVIEW, VIEWER, VIEWER_IMAGE, bootImageArticle, openPreviewViewer,
  articleGeometry, collectSent, sentText,
};
