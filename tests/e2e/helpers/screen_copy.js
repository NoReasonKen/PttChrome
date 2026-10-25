// A copy of the screen with the same structure and ids, inserted before the
// app's own screen, as a stacked-page layer will be (#25, #26). Specs use it to
// prove that nothing which belongs to the active screen is captured by the copy.
const SCREEN_COPY = '[data-test-copy]';
const ACTIVE_MAIN = '.main:not([data-test-copy])';

async function addScreenCopy(page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const copy = document.createElement('div');
      copy.className = 'main';
      copy.setAttribute('data-test-copy', '');
      copy.style.cssText = 'position:fixed;left:-10000px;top:0;width:300px;height:300px;overflow:auto';
      copy.innerHTML = '<div id="mainContainer"><span type="bbsrow" srow="0">copy</span>' +
        '<div style="height:2000px"></div></div>';
      document.body.prepend(copy);
    });
  });
}

module.exports = { SCREEN_COPY, ACTIVE_MAIN, addScreenCopy };
