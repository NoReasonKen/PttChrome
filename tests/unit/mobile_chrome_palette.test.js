import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(file), "utf8");
const palettePath = "src/css/mobile_chrome_palette.css";
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const listedColors = new Set([
  "141418", "1d1d22", "eeeeee", "dddddd", "a8c7fa", "ffb4ab", "8a2626", "b3261e",
]);

function repeatedColors(text) {
  const colors = [];
  for (const match of stripComments(text).matchAll(/#([\da-f]{3,8})\b|rgba?\(([^)]+)\)/gi)) {
    let hex;
    if (match[1]) {
      hex = match[1].toLowerCase();
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
      hex = hex.slice(0, 6);
    } else {
      const channels = match[2].trim().split(/[\s,/]+/).slice(0, 3);
      if (channels.length !== 3 || channels.some((c) => !/^\d+(?:\.\d+)?%?$/.test(c))) continue;
      hex = channels.map((c) => Math.round(parseFloat(c) * (c.endsWith("%") ? 2.55 : 1)).toString(16).padStart(2, "0")).join("");
    }
    if (listedColors.has(hex)) colors.push(match[0]);
  }
  return colors;
}

test("mobile chrome has a shared palette loaded before the component styles", () => {
  expect(fs.existsSync(palettePath)).toBe(true);
  const entry = read("src/entry.js");
  const paletteImport = entry.indexOf("./css/mobile_chrome_palette.css");
  expect(paletteImport).toBeGreaterThanOrEqual(0);
  expect(paletteImport).toBeLessThan(entry.indexOf("./css/mantine.css"));
  expect(paletteImport).toBeLessThan(entry.indexOf("./js/main"));
});

test("palette tokens are defined once without imposing a global color scheme", () => {
  const palette = stripComments(read(palettePath));
  const names = [...palette.matchAll(/(--mobile-chrome-[\w-]+)\s*:/g)].map((match) => match[1]);
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names).size).toBe(names.length);
  expect(palette).not.toMatch(/(?:^|[;{])\s*color-scheme\s*:/);
});

test("listed chrome colors are not hard-coded outside the shared palette", () => {
  const violations = [];
  for (const file of fs.readdirSync("src", { recursive: true })) {
    const name = `src/${file}`;
    if (!/\.(css|jsx?)$/.test(file) || name === palettePath || name === "src/css/color.css") continue;
    const colors = repeatedColors(read(name));
    if (colors.length) violations.push({ file: name, colors });
  }
  expect(violations).toEqual([]);
});

test.each(["#EEE", "#eeeeee", "#eeeeee80", "rgb(238, 238, 238)", "rgb(238 238 238 / 50%)", "rgba(20,20,24,.96)"])(
  "the hard-code guard recognizes equivalent notation: %s",
  (value) => expect(repeatedColors(`color: ${value};`)).toHaveLength(1),
);

test("the hard-code guard permits references, comments and unrelated PTT colors", () => {
  expect(repeatedColors("color: var(--mobile-chrome-text); /* #eee */ background: #800000;")).toEqual([]);
});
