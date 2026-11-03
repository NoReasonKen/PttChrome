// index.html 的 viewport／theme-color 靜態守護（docs/mobile.md「系統整合」）。
//   - viewport-fit=cover：手機 App Bar／底部工具列以 safe-area 讓位（App._readSafeInsets）。
//   - **不准**加 interactive-widget=resizes-content：軟鍵盤開關會變成 layout resize ⇒
//     重算字級、改列數、重送 NAWS（docs/mobile.md「軟鍵盤蓋住底列」）。
//   - **不准**鎖 user-scalable／maximum-scale：雙指縮放是瀏覽器原生行為（docs/mouse.md「手勢與瀏覽器返回」）。
//   - theme-color 與 manifest 的 theme_color 一致（安裝成 App 後的狀態列色）。
import indexHtml from "../../index.html?raw";
import manifestTemplate from "../../src/manifest.webmanifest?raw";
import fs from "node:fs";
import { renderChromeAssets, mobileChromeAssets } from "../../scripts/mobile-chrome-assets.mjs";

const viewport = (/<meta\s+name="viewport"\s+content="([^"]*)"/.exec(indexHtml) || [])[1] || "";
const palette = fs.readFileSync("src/css/mobile_chrome_palette.css", "utf8");
const assets = renderChromeAssets(palette, manifestTemplate);
const generatedHtml = mobileChromeAssets().transformIndexHtml(indexHtml);
const themeColor = (/<meta\s+name="theme-color"\s+content="([^"]*)"/.exec(generatedHtml) || [])[1];

test("viewport：cover、可縮放、沒有 interactive-widget", () => {
  expect(viewport).toContain("width=device-width");
  expect(viewport).toContain("viewport-fit=cover");
  expect(viewport).not.toMatch(/interactive-widget/);
  expect(viewport).not.toMatch(/user-scalable|maximum-scale/);
});

test("theme-color 與 manifest 一致", () => {
  expect(themeColor).toMatch(/^#[0-9a-f]{6}$/i);
  expect(JSON.parse(assets.manifest).theme_color.toLowerCase()).toBe(themeColor.toLowerCase());
});

test("changing the shared background updates both metadata outputs and preserves manifest fields", () => {
  const changed = renderChromeAssets(palette.replace("20 20 24;", "32 48 64;"), manifestTemplate);
  expect(changed.themeColor).toBe("#203040");
  const { theme_color, ...fields } = JSON.parse(changed.manifest);
  expect(theme_color).toBe(changed.themeColor);
  expect(fields).toEqual(JSON.parse(manifestTemplate));
});

test("the build emits the same manifest as the development renderer", () => {
  const emitFile = vi.fn();
  mobileChromeAssets().generateBundle.call({ emitFile });
  expect(emitFile).toHaveBeenCalledWith({ type: "asset", fileName: "manifest.webmanifest", source: assets.manifest });
});

test.each(["", "--mobile-chrome-background-rgb: 256 20 24;", "--mobile-chrome-background-rgb: -1 20 24;"])(
  "invalid background channels fail before publishing metadata: %s",
  (css) => expect(() => renderChromeAssets(css, manifestTemplate)).toThrow("Invalid mobile chrome background channels"),
);
