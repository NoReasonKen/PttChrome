import fs from "node:fs";
import path from "node:path";

const css = fs
  .readFileSync(path.join(__dirname, "../../src/css/main.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

test("inline previews use the taller default cap without article-wide zoom rules", () => {
  const image = css.match(/(?:^|\n)\.easyReadingImg\s*\{([^}]+)\}/)[1];
  expect(image).toMatch(/max-height:\s*23\.75em/);
  expect(image).toMatch(/max-width:\s*39em/);
  expect(css).not.toMatch(/imagesEnlarged|imagesZoomed|previewZoomBar/);
});

test("placeholder grid tracks stay constrained to the available width", () => {
  const slot = css.match(/(?:^|\n)\.inlinePreviewSlot\s*\{([^}]+)\}/)[1];
  expect(slot).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
