// installReplay 掛的 ResizeObserver loop 守護（tests/e2e/helpers/resize_observer_guard.js）
// 自身的判定：真的製造一次 RO loop，確認「沒送到的目標」與 observer 來源分類正確。
// 不 boot app：只要一個乾淨文件跑 init script，所以用 route 供一頁空白 HTML。
const { test, expect } = require('@playwright/test');
const { installResizeObserverGuard } = require('../helpers/resize_observer_guard');

const BLANK = 'http://ro-guard.test/';

async function openBlank(page) {
  await installResizeObserverGuard(page, { failOnOwnLoop: false });
  await page.route(BLANK, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto(BLANK);
}

// 回呼裡把自己的目標加寬 ⇒ 同深度目標在同一幀又變了 ⇒ 必定報 loop。
// sourceURL 決定 stack frame 顯示的位置，用來扮演「本專案 /src/ 建的 observer」。
const LOOP_SCRIPT = (sourceURL, height = 10) => `
  (() => {
    const el = document.createElement('div');
    el.className = 'ro-guard-probe';
    el.style.cssText = 'width:100px;height:${height}px';
    document.body.appendChild(el);
    let grown = 0;
    const ro = new ResizeObserver(() => {
      if (grown++ < 3) el.style.width = (el.offsetWidth + 10) + 'px';
    });
    ro.observe(el);
  })();
  ${sourceURL ? '//# sourceURL=' + sourceURL : ''}
`;

async function loopsAfter(page, script) {
  await page.addScriptTag({ content: script });
  await expect.poll(() => page.evaluate(() => window.__roGuard.loops.length)).toBeGreaterThan(0);
  return page.evaluate(() => window.__roGuard.loops);
}

test.describe('ResizeObserver loop 守護', () => {
  test('skipped article chunks do not implicate an unchanged preview in another observer loop', async ({ page }) => {
    await openBlank(page);
    await page.addScriptTag({ content: `
      const chunk = document.createElement('div');
      chunk.style.cssText = 'position:absolute;top:100000px;width:412px;content-visibility:auto;contain-intrinsic-size:auto 1000px';
      const content = document.createElement('div');
      content.className = 'inlinePreviewContent';
      chunk.appendChild(content);
      document.body.appendChild(chunk);
      window.previewDeliveries = [];
      new ResizeObserver(entries => {
        window.previewDeliveries.push(entries.map(e => [e.contentRect.width, e.contentRect.height]));
      }).observe(content);
      window.previewContent = content;
      //# sourceURL=http://ro-guard.test/src/unchanged_preview.js
    ` });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const probe = await page.evaluate(() => ({
      deliveries: window.previewDeliveries,
      visible: window.previewContent.checkVisibility({ contentVisibilityAuto: true }),
      hasBox: window.previewContent.checkVisibility(),
      width: window.previewContent.offsetWidth,
      height: window.previewContent.offsetHeight,
    }));
    expect(probe).toEqual({ deliveries: [], visible: false, hasBox: true, width: 412, height: 0 });
    const loops = await loopsAfter(page, LOOP_SCRIPT(null));
    expect(loops.flat().some(p => p.origin === 'other')).toBe(true);
    expect(loops.flat().filter(p => p.origin === 'own')).toEqual([]);

    // The same target must resume observation when its chunk is rendered.
    await page.evaluate(() => { window.previewContent.parentElement.style.contentVisibility = 'visible'; });
    await expect.poll(() => page.evaluate(() => window.previewDeliveries)).toEqual([[[412, 0]]]);

    // Native observation pauses while the same, previously delivered target is
    // skipped again; the cached box must not become a pending zero-size change.
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      window.previewContent.parentElement.style.contentVisibility = 'auto';
    });
    await expect.poll(() => page.evaluate(() => window.previewContent.checkVisibility({ contentVisibilityAuto: true }))).toBe(false);
    expect(await page.evaluate(() => window.previewDeliveries)).toEqual([[[412, 0]]]);
    await page.evaluate(() => { window.__roGuard.loops = []; });
    const skippedAgainLoops = await loopsAfter(page, LOOP_SCRIPT(null));
    expect(skippedAgainLoops.flat().filter(p => p.origin === 'own')).toEqual([]);
  });

  test('a rendered zero-height target still exposes a real own width loop', async ({ page }) => {
    await openBlank(page);
    const loops = await loopsAfter(page, LOOP_SCRIPT('http://ro-guard.test/src/zero_height_loop.js', 0));
    expect(loops[0]).toContainEqual(expect.objectContaining({
      origin: 'own', target: 'div.ro-guard-probe', from: '100x0', to: '110x0',
    }));
  });

  test('a newly observed rendered target is still reported before its first delivery', async ({ page }) => {
    await openBlank(page);
    await page.addScriptTag({ content: `
      window.observeOwnTarget = target => new ResizeObserver(() => {}).observe(target);
      //# sourceURL=http://ro-guard.test/src/initial_observation.js
    ` });
    const loops = await loopsAfter(page, `
      const trigger = document.createElement('div');
      trigger.style.cssText = 'width:100px;height:10px';
      document.body.appendChild(trigger);
      let created = false;
      new ResizeObserver(() => {
        if (created) return;
        created = true;
        const target = document.createElement('div');
        target.className = 'newly-observed';
        target.style.cssText = 'width:100px;height:0';
        document.body.appendChild(target);
        window.observeOwnTarget(target);
        target.style.width = '110px';
      }).observe(trigger);
    `);
    expect(loops[0]).toContainEqual(expect.objectContaining({
      origin: 'own', target: 'div.newly-observed', from: 'unsent', to: '110x0',
    }));
  });

  test('hiding a rendered own target still exposes its pending zero-size delivery', async ({ page }) => {
    await openBlank(page);
    const loops = await loopsAfter(page, `
      const target = document.createElement('div');
      target.className = 'hidden-by-callback';
      target.style.cssText = 'width:100px;height:10px';
      document.body.appendChild(target);
      new ResizeObserver(() => { target.style.display = 'none'; }).observe(target);
      //# sourceURL=http://ro-guard.test/src/hide_observer.js
    `);
    expect(loops[0]).toContainEqual(expect.objectContaining({
      origin: 'own', target: 'div.hidden-by-callback', from: '100x10', to: '0x0',
    }));
  });

  test('/src/ 建的 observer 沒送到 → 分類 own，記下目標與尺寸變化', async ({ page }) => {
    await openBlank(page);
    const own = [];
    page.on('console', (m) => {
      if (m.text().startsWith('[ro-guard:own-loop] ')) own.push(m.text());
    });
    const loops = await loopsAfter(page, LOOP_SCRIPT('http://ro-guard.test/src/fake_observer.js'));
    const pending = loops[0];
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ origin: 'own', target: 'div.ro-guard-probe', from: '100x10', to: '110x10' });
    expect(pending[0].caller).toContain('/src/fake_observer.js');
    // 報給 Node 端的通道（installReplay 據此 expect.soft 讓 test 紅）。
    await expect.poll(() => own.length).toBeGreaterThan(0);
  });

  test('非本專案的 observer（測試自建）沒送到 → 不算 own，不報', async ({ page }) => {
    await openBlank(page);
    const own = [];
    let fenced = false;
    page.on('console', (m) => {
      if (m.text().startsWith('[ro-guard:own-loop] ')) own.push(m.text());
      if (m.text() === 'ro-guard-fence') fenced = true;
    });
    const loops = await loopsAfter(page, LOOP_SCRIPT(null));
    expect(loops[0]).toHaveLength(1);
    expect(loops[0][0]).toMatchObject({ origin: 'other', target: 'div.ro-guard-probe' });
    // 柵欄：console 依序送回 Node，自己的記號到了＝前面的 console 都已送達。
    await page.evaluate(() => console.log('ro-guard-fence'));
    await expect.poll(() => fenced).toBe(true);
    expect(own).toEqual([]);
  });
});
