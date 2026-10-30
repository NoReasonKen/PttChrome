// 閱讀紀錄（docs/reading-record.md）：手機換行版面下，文章重讀後的還原要回到同一列。
//
// 斷線重連、AID 返回、長推文取消這些路徑都是「離開文章 → 從頭重讀 → 累積到那一列時
// 一次性捲過去」（easy_reading.requestScrollRestore → term_view.pageRowTop）。手機跟
// 桌機的差別全在版面：一列會折成好幾行、長頁分塊沒渲染過的塊以 100lh 估高（換行後
// 實際高好幾倍），所以採樣與還原都只能量節點。這裡用合成長文（多個分塊、有換行、
// 有圖）在 offline-mobile 走完整條：讀到中段 → 重新開機重讀 → 還原 → 預覽載完之後
// 視窗頂端仍是同一列的同一處。
// 內容全部合成（helpers/pmore_sim.js），不含任何真實文章。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { waitPreviewsSettled } = require('../helpers/layout');
const { touchDrag, nextFrames } = require('../helpers/real_input');

const SIM_SRC = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'pmore_sim.js'), 'utf8');
const TOTAL = 600;

// 內文前 120 行是會在手機寬度換行的長列（每 30 行一張圖），之後是推文（每 40 則一張圖）。
async function installSim(page, total) {
  await page.evaluate(
    ({ src, total }) => {
      const module = { exports: {} };
      new Function('module', 'exports', src)(module, module.exports);
      const { createPmoreSim } = module.exports;
      const authors = ['alice', 'bob', 'carol', 'dave', 'erin'];
      const lineText = (n) => {
        if (n < 120) {
          if (n % 30 === 10) return `https://i.imgur.com/restore${n}.png`;
          return (`內文第 ${n} 行 ` + '測試文字'.repeat(n % 4 === 0 ? 16 : 3)).slice(0, 78);
        }
        const who = authors[Math.floor(n / 3) % authors.length];
        const body = n % 40 === 0 ? `https://i.imgur.com/restore${n}.png` : `comment ${n} ` + '推文內容'.repeat(n % 5);
        return `${n % 3 === 0 ? '推' : '→'} ${who}: ${body}`.padEnd(66) + '09/25 10:00';
      };
      const sim = createPmoreSim({ total, rows: window.__app.buf.rows, lineText });
      const u2b = (str) => {
        let out = '';
        for (const ch of str) {
          const c = ch.charCodeAt(0);
          if (c < 0x80) { out += ch; continue; }
          out += String.fromCharCode(window.lib.u2bArray[2 * c]) + String.fromCharCode(window.lib.u2bArray[2 * c + 1]);
        }
        return out;
      };
      const encode = (f) => {
        let d = '\x1b[H\x1b[2J';
        f.texts.forEach((t, i) => { if (t) d += '\x1b[' + (i + 1) + ';1H' + u2b(t); });
        return d + '\x1b[' + (f.cursor.y + 1) + ';' + (f.cursor.x + 1) + 'H';
      };
      const KEYS = /^(\x1b\[[1456]~|:\d+\r)$/;
      const wire = [];
      window.__stubWSSent = (s) => {
        if (!KEYS.test(s)) return;
        wire.push(s);
        setTimeout(() => {
          const resp = sim.press(wire.shift());
          if (resp) resp.frames.forEach((f) => window.__app.onData(encode(f)));
        }, 5);
      };
      window.__app.onData(encode(sim.screen()));
    },
    { src: SIM_SRC, total }
  );
}

// 視窗頂端：閱讀紀錄記的列索引，以及那一列節點相對視窗頂端的位置（px）。
const topOfView = (page) =>
  page.evaluate(() => {
    const v = window.__app.view;
    const d = v.mainDisplay;
    const li = v.currentLineIndex();
    const el = document.querySelector('#mainContainer [type="bbsrow"][srow="' + Math.floor(li) + '"]');
    return {
      li,
      reflow: v.reflow,
      chunks: document.querySelectorAll('#mainContainer > .screenChunk').length,
      top: el ? Math.round(el.getBoundingClientRect().top - d.getBoundingClientRect().top) : null,
      text: el ? el.textContent.slice(0, 24) : null,
    };
  });

// 開機 → 進好讀 → 預讀到文末。restoreLi：進好讀的同一刻掛上還原請求（＝重讀）。
async function openAndRead(page, restoreLi) {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReadingList: false, enableEasyReading: true });
  await installSim(page, TOTAL);
  await page.waitForFunction(() => window.__app.buf.pageState === 3);
  await page.evaluate((li) => {
    window.__app.easyReading.enterEasyReading();
    if (li != null) window.__app.easyReading.requestScrollRestore(li);
  }, restoreLi);
  await page.waitForFunction(() => window.__app.easyReading.easyReadingReachedPageEnd, null, { timeout: 120000 });
  await waitPreviewsSettled(page);
}

for (const frac of [0.25, 0.5, 0.8]) {
  test(`重讀後還原：讀到 ${frac * 100}% 處離開，回來仍是同一列同一處`, async ({ page }) => {
    test.setTimeout(180000);
    await openAndRead(page, null);
    await page.evaluate((f) => {
      const d = window.__app.view.mainDisplay;
      d.scrollTop = Math.round((d.scrollHeight - d.clientHeight) * f);
      // A top that falls in the spacing between two rows is recorded as the next row
      // (fraction 0) and restored flush to it: start inside a row so the 2px check holds.
      const top = d.getBoundingClientRect().top;
      const row = [...document.querySelectorAll('#mainContainer [type="bbsrow"][srow]')].find(
        (el) => el.offsetParent !== null && el.getBoundingClientRect().bottom > top + 1
      );
      const gap = row ? row.getBoundingClientRect().top - top : 0;
      if (gap > 0) d.scrollTop += Math.ceil(gap) + 1;
    }, frac);
    await waitPreviewsSettled(page);
    const before = await topOfView(page);
    expect(before.reflow).toBe(true);
    expect(before.chunks).toBeGreaterThan(2);
    expect(before.li).toBeGreaterThan(0);

    await openAndRead(page, before.li);
    const after = await topOfView(page);
    expect(after.text).toBe(before.text);
    expect(after.li).toBeCloseTo(before.li, 2);
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2);
  });
}

for (const input of ['wheel', 'touch', 'key', 'pointer']) {
  test(`restored article position yields to reader ${input} input before later preview growth`, async ({ page }) => {
    await openAndRead(page, 201.5);
    await expect.poll(async () => (await topOfView(page)).li).toBeCloseTo(201.5, 2);
    const point = { x: 206, y: 190 };
    if (input === 'wheel') {
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, 100);
    } else if (input === 'touch') {
      await touchDrag(page, point, { x: point.x, y: point.y - 70 });
    } else if (input === 'key') {
      await page.keyboard.press('Shift');
    } else {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
    }
    await nextFrames(page);
    // Move the fixture away from the restored row without another input event.
    // A surviving follower would pull it back when that row's real layout grows.
    await page.evaluate(() => {
      const view = window.__app.view;
      view.mainDisplay.scrollTop = view.pageRowTop(230);
    });
    await waitPreviewsSettled(page);
    const before = await topOfView(page);
    expect(before.li).toBeGreaterThan(220);
    await page.evaluate(() => {
      const image = document.querySelector('[type="bbsrow"][srow="201"] img');
      image.style.maxHeight = 'none';
      image.style.height = '600px';
    });
    await waitPreviewsSettled(page);
    expect((await topOfView(page)).li).toBe(before.li);
    if (input === 'touch') await page.screenshot({ path: test.info().outputPath('reader-takeover.png') });
    if (input === 'pointer') await page.mouse.up();
  });
}
