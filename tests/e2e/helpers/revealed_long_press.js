// Desktop Chromium does not normally generate contextmenu from CDP touch holds.
// Keep this real input boundary separate from tests that inject that event.
async function holdRevealed(page, locator, whileHeld) {
  const { x, y } = await locator.evaluate(el => {
    const content = el.matches('[data-stack-layer="article"]') ? el.querySelector('#mainContainer') || el : el;
    const bottom = Math.min(innerHeight, document.getElementById('mobileToolbar')?.getBoundingClientRect().top ?? innerHeight);
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        const x = rect.left + Math.min(8, rect.width / 2);
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (rect.width > 0 && x > 0 && x < innerWidth && y > 64 && y < bottom && hit && content.contains(hit)) return { x, y };
      }
    }
    throw new Error('Revealed target has no visible text under the touch point');
  });
  const hit = await locator.evaluate((el, point) => {
    const at = document.elementFromPoint(point.x, point.y);
    return !!at && (at === el || el.contains(at));
  }, { x, y });
  if (!hit) throw new Error('Revealed target is not under the touch point');
  await page.evaluate(() => {
    window.__holdEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'contextmenu']) {
      window.addEventListener(type, e => window.__holdEvents.push({ type, pointer: e.pointerType, trusted: e.isTrusted }), true);
    }
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  try {
    await whileHeld();
    await page.waitForTimeout(800); // sleep-ok: hold past the mobile long-press threshold
    const beforeRelease = await page.evaluate(() => window.__holdEvents.slice());
    if (!beforeRelease.some(e => e.type === 'pointerdown') || beforeRelease.some(e => e.type === 'pointerup' || e.type === 'pointercancel'))
      throw new Error('Contact did not remain down during the handoff');
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  }
  return page.evaluate(() => window.__holdEvents);
}
module.exports = { holdRevealed };
