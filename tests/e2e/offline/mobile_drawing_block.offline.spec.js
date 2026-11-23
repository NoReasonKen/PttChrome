// Drawing blocks on the phone (#295, docs/mobile.md "Drawing blocks"): in the easy-reading
// article a drawing (colour art, a box frame) is drawn on PTT's 80-column grid, its rows not
// wrapped, at a cell that fits 80 columns in the page width; prose, a drawing that already
// fits, the header and the comments keep the reading layout.
// The article is synthetic (helpers/pmore_sim.js), with SGR colours in its rows.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootOffline } = require('../helpers/replay');
const { waitPreviewsSettled } = require('../helpers/layout');

const SIM_SRC = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'pmore_sim.js'), 'utf8');

const RESET = '\x1b[m';
const PROSE = '今天去了一趟市場，買了很多東西回家，結果發現忘記買最重要的醬油，只好再出門一次。';
// CI's fonts have no CJK glyphs (their advance is not the 1em a phone's CJK font gives), so the
// layout is asserted on ASCII prose and on the cells the renderer sizes itself (.wpadding).
const PROSE_ASCII = 'Went to the market today and bought many things, then found I forgot the soy.';
// Columns on PTT's screen (a full-width character takes two).
const colsOf = (s) => [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
const padCols = (s, cols) => s + ' '.repeat(Math.max(0, cols - colsOf(s)));
const head = (label, value, cols) => `\x1b[34;47m ${label} \x1b[37;44m ${padCols(value, cols - 1)}`;

// Line n (1-based) of the article; the accumulated page's row is n - 1.
function lineText(n) {
  if (n === 1) return head('作者', 'poster (暱稱)', 54) + head('看板', 'Test', 12) + RESET;
  if (n === 2) return head('標題', '[繪圖] 測試', 72) + RESET;
  if (n === 3) return head('時間', 'Sun Nov 22 10:00:00 2026', 72) + RESET;
  if (n === 4) return `\x1b[36m${'─'.repeat(39)}${RESET}`;
  // Colour art, 76 columns: lines 16-21.
  if (n >= 16 && n <= 21) {
    const k = n - 16;
    return (
      `  \x1b[44m${'　'.repeat(8 + (k % 3))}` +
      `\x1b[33;40m▆▅▄▃▂▁` +
      `\x1b[47m${'　'.repeat(16 - (k % 3))}` +
      `\x1b[41m${'　'.repeat(7)}${RESET}`
    );
  }
  // A box frame, 76 columns, one blank line under the art: lines 23-26.
  if (n === 23) return `┌${'─'.repeat(36)}┐`;
  if (n === 24) return `│${padCols(' a box keeps its edges in line', 72)}│`;
  if (n === 25) return `│${padCols(' frame row two', 72)}│`;
  if (n === 26) return `└${'─'.repeat(36)}┘`;
  // A small drawing that fits at the reading size: lines 36-38.
  if (n >= 36 && n <= 38) return `  \x1b[42m${'　'.repeat(5)}\x1b[43m${'　'.repeat(5)}${RESET}`;
  if (n === 15 || n === 22 || n === 27 || n === 35 || n === 39) return '';
  // Prose, 78 columns: wraps at the reading size.
  if (n === 6) return PROSE_ASCII;
  if (n < 51) return PROSE.slice(0, 39);
  if (n === 51) return '--';
  return padCols(`${n % 2 ? '推' : '→'} user${n % 5}: comment ${n} 推文內容`, 67) + '11/22 10:00';
}
const TOTAL = 70;
const LINES = Array.from({ length: TOTAL }, (_, i) => lineText(i + 1));
const DRAWING_ROWS = Array.from({ length: 11 }, (_, i) => 15 + i); // lines 16-26
const ART_ROWS = DRAWING_ROWS.slice(0, 6);
const FRAME_ROWS = [22, 23, 24, 25];
const SMALL_ROWS = [35, 36, 37];
const PROSE_ROW = 5;

async function openArticle(page) {
  await bootOffline(page, ptt);
  await ptt.applyPrefs(page, { enableEasyReading: true });
  await page.evaluate(
    ({ src, lines }) => {
      const module = { exports: {} };
      new Function('module', 'exports', src)(module, module.exports);
      const { createPmoreSim } = module.exports;
      const sim = createPmoreSim({ total: lines.length, rows: window.__app.buf.rows, lineText: (n) => lines[n - 1] });
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
    { src: SIM_SRC, lines: LINES }
  );
  await page.waitForFunction(() => window.__app.buf.pageState === 3);
  await page.evaluate(() => window.__app.easyReading.enterEasyReading());
  await page.waitForFunction(() => window.__app.easyReading.easyReadingReachedPageEnd, null, { timeout: 60000 });
  await waitPreviewsSettled(page);
}

// Every rendered row of the page, with what its layout shows.
const measure = (page) =>
  page.evaluate(() => {
    const v = window.__app.view;
    const d = v.mainDisplay;
    const cs = getComputedStyle(d);
    const rows = {};
    for (const el of document.querySelectorAll('#mainContainer [type="bbsrow"][srow]')) {
      const r = el.getBoundingClientRect();
      const rcs = getComputedStyle(el);
      const colored = [...el.querySelectorAll('*')].some(
        (c) => getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)'
      );
      const boxes = el.querySelectorAll('.wpadding');
      const edge = (i) => (boxes.length ? boxes[i < 0 ? boxes.length - 1 : i].getBoundingClientRect() : null);
      rows[el.getAttribute('srow')] = {
        drawing: el.classList.contains('drawingRow'),
        text: el.textContent,
        height: r.height,
        lines: Math.round(r.height / parseFloat(rcs.lineHeight)),
        // The row's left edge, and the left of its first and the right of its last full-width box.
        left: r.left,
        firstBox: boxes.length ? edge(0).left : null,
        lastBox: boxes.length ? edge(-1).right : null,
        fontSize: parseFloat(rcs.fontSize),
        colored,
      };
    }
    return {
      rows,
      cell: parseFloat(cs.getPropertyValue('--drawing-cell')),
      drawingCols: v.drawingCols,
      chh: v.chh,
      textScale: v.textScale,
      clientWidth: d.clientWidth,
      scrollWidth: d.scrollWidth,
      cards: document.querySelectorAll('#mainContainer .commentCard').length,
    };
  });

test('a drawing is drawn on the 80-column grid at the page width; prose and comments keep wrapping', async ({ page }) => {
  test.setTimeout(120000);
  await openArticle(page);
  const m = await measure(page);

  // The geometry: 80 columns of the drawing cell fit the page; the reading cell is larger.
  expect(m.drawingCols).toBeGreaterThan(0);
  expect(m.drawingCols).toBeLessThan(80);
  expect(m.cell).toBeGreaterThan(0);
  expect(m.cell).toBeLessThan(m.chh);
  expect(m.cell * 40).toBeLessThanOrEqual(m.clientWidth + 0.5);

  // Only the drawing's rows are marked: not the header, the prose, the small drawing or comments.
  const marked = Object.keys(m.rows).filter((r) => m.rows[r].drawing).map(Number).sort((a, b) => a - b);
  expect(marked).toEqual(DRAWING_ROWS);
  expect(m.rows[ART_ROWS[0]].text).toContain('▆');
  expect(m.rows[FRAME_ROWS[0]].text).toContain('┌');

  for (const r of DRAWING_ROWS) {
    const row = m.rows[r];
    if (!row.text.trim() && !row.colored) continue; // the blank line inside the block
    // One line, at the drawing cell, inside the page.
    expect(row.lines, `row ${r}`).toBe(1);
    expect(row.height, `row ${r}`).toBeLessThan(m.chh * 1.5);
    if (row.lastBox != null) expect(row.lastBox, `row ${r}`).toBeLessThanOrEqual(m.clientWidth + 1);
  }
  expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);

  // On the grid: column c starts c half cells from the row's left, so the frame's edges line up.
  // Half-width text's advance may be hinted to a whole px at a small size (docs/mobile.md
  // "測試": tolerances by column count), so a row with 72 columns of it gets that much more.
  const HINTING_PX_PER_COL = 0.05;
  for (const r of FRAME_ROWS) {
    const row = m.rows[r];
    const halfWidthCols = r === FRAME_ROWS[1] || r === FRAME_ROWS[2] ? 72 : 0;
    expect(Math.abs(row.firstBox - row.left), `row ${r}`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(row.lastBox - row.left - 38 * m.cell), `row ${r}`).toBeLessThanOrEqual(
      1 + halfWidthCols * HINTING_PX_PER_COL
    );
  }
  // The art's ▁ ends at column 30 + 2k, after 2 spaces, 8 + k full-width spaces and 6 blocks.
  ART_ROWS.forEach((r, i) => {
    const row = m.rows[r];
    expect(Math.abs(row.lastBox - row.left - ((30 + 2 * (i % 3)) * m.cell) / 2), `row ${r}`).toBeLessThanOrEqual(
      1 + 2 * HINTING_PX_PER_COL
    );
  });
  // The colours stay.
  for (const r of ART_ROWS) expect(m.rows[r].colored, `row ${r}`).toBe(true);

  // Prose still wraps at the reading size.
  expect(m.rows[PROSE_ROW].drawing).toBe(false);
  expect(m.rows[PROSE_ROW].lines).toBeGreaterThanOrEqual(2);
  expect(m.rows[PROSE_ROW].fontSize).toBeCloseTo(m.chh / m.textScale, 1);
  // A drawing that fits keeps the reading size, on one line.
  for (const r of SMALL_ROWS) {
    expect(m.rows[r].drawing, `row ${r}`).toBe(false);
    expect(m.rows[r].lines, `row ${r}`).toBe(1);
    expect(m.rows[r].fontSize, `row ${r}`).toBeCloseTo(m.chh / m.textScale, 1);
  }
  // The reading size is measured on a reading row, not a drawing row.
  expect(m.textScale).toBeCloseTo(1, 2);
  // Comments are still cards.
  expect(m.cards).toBe(TOTAL - 51);

  await page.screenshot({ path: test.info().outputPath('drawing-block.png') });
});

test('the reading record and scrolling pass through a drawing block', async ({ page }) => {
  test.setTimeout(120000);
  await openArticle(page);
  // Put the frame's top row at the top of the view: the record names that row.
  const at = await page.evaluate((r) => {
    const v = window.__app.view;
    const d = v.mainDisplay;
    const el = document.querySelector('#mainContainer [type="bbsrow"][srow="' + r + '"]');
    d.scrollTop += el.getBoundingClientRect().top - d.getBoundingClientRect().top + 1;
    return v.currentLineIndex();
  }, FRAME_ROWS[0]);
  expect(Math.floor(at)).toBe(FRAME_ROWS[0]);
  await page.screenshot({ path: test.info().outputPath('drawing-block-scrolled.png') });

  // Paging down past the block reaches the comments and the end of the article.
  for (let i = 0; i < 10; ++i) await page.keyboard.press('PageDown');
  await expect
    .poll(() => page.evaluate(() => {
      const d = window.__app.view.mainDisplay;
      return d.scrollTop + d.clientHeight >= d.scrollHeight - 2;
    }))
    .toBe(true);
  const end = await page.evaluate(() => window.__app.view.currentLineIndex());
  expect(end).toBeGreaterThan(51);
});
