// @unit-env browser
// real-input: tests/e2e/offline/image_viewer.offline.spec.js
import { mountScreen, unmountAll } from "./helpers/mount_screen";
import { row, seg } from "./helpers/screen_fixtures";

afterEach(() => unmountAll());

function setup() {
  const screen = mountScreen({
    lines: [row(seg("Article"))],
    enableLinkInlinePreview: false,
    enableLinkHoverPreview: false,
  });
  const img = document.createElement("img");
  img.className = "easyReadingImg hyperLinkPreview";
  img.src = "https://example.test/image.jpg";
  img.alt = "Article image";
  img.referrerPolicy = "no-referrer";
  Object.defineProperties(img, {
    naturalWidth: { configurable: true, value: 1600 },
    naturalHeight: { configurable: true, value: 1200 },
    currentSrc: {
      configurable: true,
      value: "https://example.test/fallback.webp",
    },
  });
  screen.container.appendChild(img);
  const previews = [];
  screen.root.addEventListener("previewimage", (event) =>
    previews.push(event.detail),
  );
  return { screen, img, previews };
}

test("activating an inline image requests a viewer with the loaded source", () => {
  const { screen, img, previews } = setup();
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  const outerClick = vi.fn();
  screen.root.addEventListener("click", outerClick);
  img.dispatchEvent(click);
  expect(previews).toEqual([
    {
      src: "https://example.test/fallback.webp",
      width: 1600,
      height: 1200,
      alt: "Article image",
      referrerPolicy: "no-referrer",
      trigger: img,
    },
  ]);
  expect(click.defaultPrevented).toBe(true);
  expect(outerClick).not.toHaveBeenCalled();
  expect(screen.container.className).not.toMatch(/imagesEnlarged|imagesZoomed/);
});

test.each(["Enter", " "])("the %s key opens the same image viewer", (key) => {
  const { img, previews } = setup();
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  img.dispatchEvent(event);
  expect(previews).toHaveLength(1);
  expect(event.defaultPrevented).toBe(true);
});

test("unloaded images and non-image targets do not open a viewer", () => {
  const { screen, img, previews } = setup();
  Object.defineProperty(img, "naturalWidth", { value: 0 });
  img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  screen.container.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(previews).toHaveLength(0);
});

test("hover images and modified keyboard shortcuts keep their existing behavior", () => {
  const { img, previews } = setup();
  img.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
    }),
  );
  img.classList.remove("hyperLinkPreview");
  img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(previews).toHaveLength(0);
});

test("the current image URL falls back to src when currentSrc is unavailable", () => {
  const { img, previews } = setup();
  Object.defineProperty(img, "currentSrc", { value: "" });
  img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(previews[0].src).toBe(img.src);
});
