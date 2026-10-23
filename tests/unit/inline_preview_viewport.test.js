// @unit-env browser
import { page } from "vitest/browser";
import css from "../../src/css/main.css?raw";

let style;
let host;

beforeAll(() => {
  style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
});

afterAll(() => style.remove());

afterEach(async () => {
  host?.remove();
  host = null;
  document.body.classList.remove("mobile-layout");
  await page.viewport(1024, 768);
});

async function mountImage({ width = 800, height = 2400, mobile = true } = {}) {
  document.body.classList.toggle("mobile-layout", mobile);
  host = document.createElement("div");
  host.className = mobile ? "main mobileReflow" : "main";
  host.style.cssText = "position:relative;width:100%;font-size:16px;";
  const image = document.createElement("img");
  image.className = "easyReadingImg";
  image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`)}`;
  host.appendChild(image);
  document.body.appendChild(host);
  await image.decode();
  return image;
}

test.each([600, 900])("mobile previews fit half of a %ipx viewport", async (height) => {
  await page.viewport(390, height);
  const image = await mountImage();
  const rect = image.getBoundingClientRect();
  expect(rect.height).toBeCloseTo(height / 2, 0);
  expect(rect.width / rect.height).toBeCloseTo(1 / 3, 2);
});

test("mobile preview size follows viewport height changes without changing its font", async () => {
  await page.viewport(390, 900);
  const image = await mountImage();
  expect(image.getBoundingClientRect().height).toBeCloseTo(450, 0);
  await page.viewport(390, 600);
  expect(image.getBoundingClientRect().height).toBeCloseTo(300, 0);
});

test("lazy preview placeholders share the current mobile image height cap", async () => {
  await page.viewport(390, 900);
  const image = await mountImage();
  const ghost = document.createElement("div");
  ghost.className = "easyReadingImg inlinePreviewGhost";
  ghost.style.setProperty("--ghost-w", "800px");
  ghost.style.aspectRatio = "800 / 2400";
  host.appendChild(ghost);
  expect(ghost.getBoundingClientRect().height).toBeCloseTo(image.getBoundingClientRect().height, 0);
  await page.viewport(390, 600);
  expect(ghost.getBoundingClientRect().height).toBeCloseTo(image.getBoundingClientRect().height, 0);
});

test("wide mobile previews remain within the article width", async () => {
  await page.viewport(390, 800);
  const image = await mountImage({ width: 2400, height: 800 });
  const rect = image.getBoundingClientRect();
  expect(rect.width).toBeLessThanOrEqual(host.getBoundingClientRect().width);
  expect(rect.width / rect.height).toBeCloseTo(3, 2);
});

test("small mobile images retain their natural dimensions", async () => {
  await page.viewport(390, 800);
  const image = await mountImage({ width: 80, height: 120 });
  expect(image.getBoundingClientRect().width).toBe(80);
  expect(image.getBoundingClientRect().height).toBe(120);
});

test("desktop previews retain the font-relative height cap", async () => {
  const image = await mountImage({ mobile: false });
  expect(image.getBoundingClientRect().height).toBe(23.75 * 16);
});
