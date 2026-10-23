// @unit-env browser
// PhotoSwipe is appended under document.body, outside the article's .main image reset.
import mainCss from "../../src/css/main.css?raw";
import photoSwipeCss from "photoswipe/style.css?raw";
import imageViewerCss from "../../src/css/image_viewer.css?raw";

let style;
let host;

beforeAll(() => {
  style = document.createElement("style");
  style.textContent = `${mainCss}\n${photoSwipeCss}\n${imageViewerCss}`;
  document.head.appendChild(style);
});

afterAll(() => {
  style.remove();
});

afterEach(() => {
  host?.remove();
  host = null;
});

function mountImages() {
  host = document.createElement("div");
  host.innerHTML = `
    <div class="main"><img class="inlinePreview" alt="Article preview"></div>
    <div class="pswp imageViewer">
      <img class="pswp__img" alt="Full image">
      <img class="pswp__img pswp__img--placeholder" alt="Placeholder image">
    </div>`;
  document.body.appendChild(host);
  return {
    article: host.querySelector(".inlinePreview"),
    full: host.querySelector(".pswp__img:not(.pswp__img--placeholder)"),
    placeholder: host.querySelector(".pswp__img--placeholder"),
  };
}

describe("PhotoSwipe image styles", () => {
  test("removes the global image frame from full and placeholder images", () => {
    const { article, full, placeholder } = mountImages();

    for (const image of [full, placeholder]) {
      const style = getComputedStyle(image);
      expect(style.padding).toBe("0px");
      expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(style.borderWidth).toBe("0px");
      expect(image.getAttribute("style")).toBeNull();
    }

    // The article preview remains governed by the existing .main rule.
    expect(getComputedStyle(article).padding).toBe("0px");
    expect(article.getAttribute("style")).toBeNull();
  });
});
