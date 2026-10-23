// @unit-env browser
import {
  collectArticleImages,
  loadArticleImage,
} from "../../src/js/article_images";

vi.mock("../../src/components/ImagePreviewer", () => ({
  requestPreview: vi.fn(),
  supportsMediaPreview: () => true,
  cachedPreviewDescriptor: () => undefined,
  needsReferer: (src) => /https:\/\/(?:[^/]+\.)?verb\.tw\//.test(src),
  MAX_RETRIES_PER_CANDIDATE: 2,
  RETRY_BASE_MS: 300,
}));
vi.mock("../../src/render/inline_preview_slot", () => ({
  inlinePreviewHref: () => undefined,
}));

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
let container;
let hrefs;
let resolvePreview;
let loadImage;
let canPreview;
let cachedPreview;

function image(id, loaded = true) {
  const node = document.createElement("img");
  node.className = "hyperLinkPreview";
  node.src = `${PIXEL}#${id}`;
  node.alt = id;
  node.referrerPolicy = "no-referrer";
  Object.defineProperties(node, {
    naturalWidth: { value: loaded ? 640 : 0 },
    naturalHeight: { value: loaded ? 480 : 0 },
    currentSrc: { value: node.src },
  });
  return node;
}

function slot(href, ...images) {
  const node = document.createElement("div");
  node.className = "inlinePreviewSlot";
  node.append(...images);
  hrefs.set(node, href);
  return node;
}

function collect(selected) {
  return collectArticleImages(container, selected, {
    resolvePreview,
    loadImage,
    canPreview,
    cachedPreview,
    slotHref: (node) => hrefs.get(node),
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  hrefs = new WeakMap();
  resolvePreview = vi.fn();
  loadImage = vi.fn();
  canPreview = vi.fn().mockReturnValue(true);
  cachedPreview = vi.fn();
});

afterEach(() => container.remove());

describe("article image collection", () => {
  it("skips ordinary article links without resolving them", () => {
    container.append(
      slot("https://news.example/story"),
      slot("https://www.ptt.cc/bbs/Example/"),
    );
    canPreview.mockReturnValue(false);
    expect(collect().items).toEqual([]);
    expect(resolvePreview).not.toHaveBeenCalled();
  });

  it("preserves actual loaded images even when their links are not recognized", () => {
    const actual = image("custom");
    const earlier = slot("custom");
    container.append(earlier, slot("custom", actual));
    canPreview.mockReturnValue(false);
    const gallery = collect(actual);
    expect(gallery.index).toBe(0);
    expect(gallery.items).toHaveLength(1);
    expect(gallery.items[0].anchor()).toBe(actual);
  });

  it("keeps a failed album image before its loaded sibling", async () => {
    const loaded = image("second");
    container.append(slot("album", loaded));
    cachedPreview.mockReturnValue({
      type: "album",
      images: [{ src: `${PIXEL}#first` }, { src: loaded.src }],
    });
    const gallery = collect(loaded);
    expect(gallery.items).toHaveLength(2);
    expect(gallery.index).toBe(1);
    expect(gallery.items[0].load).toBeTypeOf("function");
    expect(gallery.items[1].src).toBe(loaded.src);
    const replacement = image("second");
    container.replaceChildren(slot("album", replacement));
    expect(gallery.items[1].anchor()).toBe(replacement);
    await gallery.items[0].load();
    expect(loadImage).toHaveBeenCalledExactlyOnceWith(
      { src: `${PIXEL}#first` },
      undefined,
    );
    expect(resolvePreview).not.toHaveBeenCalled();
  });

  it("uses album candidate URLs when an image loaded through its fallback", () => {
    const fallback = image("fallback");
    container.append(slot("album", fallback));
    cachedPreview.mockReturnValue({
      type: "album",
      images: [
        { src: `${PIXEL}#first` },
        { src: `${PIXEL}#primary`, srcset: [`${PIXEL}#primary`, fallback.src] },
      ],
    });
    const gallery = collect(fallback);
    expect(gallery.index).toBe(1);
    expect(gallery.items[1].src).toBe(fallback.src);
    expect(gallery.items[1].anchor()).toBe(fallback);
  });

  it("retains duplicate candidate occurrences after a previous image fails", () => {
    const error = document.createElement("div");
    error.className = "previewError";
    const loaded = image("same");
    container.append(slot("album", error, loaded));
    cachedPreview.mockReturnValue({
      type: "album",
      images: [{ src: loaded.src }, { src: loaded.src }],
    });
    const gallery = collect(loaded);
    expect(gallery.index).toBe(1);
    expect(gallery.items[0].load).toBeTypeOf("function");
    const replacement = image("same");
    const newError = document.createElement("div");
    newError.className = "previewError";
    container.replaceChildren(slot("album", newError, replacement));
    expect(gallery.items[1].anchor()).toBe(replacement);
    expect(gallery.items[0].anchor()).toBe(
      replacement.closest(".inlinePreviewSlot"),
    );
  });

  it("keeps article order and duplicate occurrences without loading lazy slots", () => {
    const first = image("first");
    const second = image("second");
    container.append(slot("same", first), slot("lazy"), slot("same", second));
    const gallery = collect(second);
    expect(gallery.index).toBe(2);
    expect(gallery.items).toHaveLength(3);
    expect(gallery.items[0]).toMatchObject({
      src: first.src,
      width: 640,
      height: 480,
    });
    expect(gallery.items[1].type).toBe("html");
    expect(gallery.items[2].anchor()).toBe(second);
    expect(resolvePreview).not.toHaveBeenCalled();
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("finds the same link occurrence and album image after article rows rebuild", () => {
    const old = image("old");
    container.append(
      slot("same", image("first")),
      slot("same", image("other"), old),
    );
    const gallery = collect(old);
    const replacement = image("replacement");
    container.replaceChildren(
      slot("same", image("first-new")),
      slot("same", image("other-new"), replacement),
    );
    expect(gallery.items[gallery.index].anchor()).toBe(replacement);
    container.replaceChildren();
    expect(gallery.items[gallery.index].anchor()).toBeNull();
  });

  it("supports loaded standalone images without collecting nested images twice", () => {
    const standalone = image("standalone");
    container.append(standalone, slot("nested", image("inside")));
    const gallery = collect(standalone);
    expect(gallery.index).toBe(0);
    expect(gallery.items).toHaveLength(2);
    expect(gallery.items[0].anchor()).toBe(standalone);
  });

  it("resolves nested albums to images without starting their downloads", async () => {
    const anchor = slot("album");
    container.append(anchor);
    resolvePreview.mockResolvedValue({
      type: "album",
      images: [
        { type: "image", src: "one" },
        { type: "video", src: "video" },
        {
          type: "album",
          images: [{ src: "two" }, { type: "iframe", src: "embed" }],
        },
      ],
    });
    const entry = collect().items[0];
    expect(resolvePreview).not.toHaveBeenCalled();
    const entries = await entry.resolve();
    expect(resolvePreview).toHaveBeenCalledExactlyOnceWith("album");
    expect(entries).toHaveLength(2);
    expect(entries[0].anchor()).toBe(anchor);
    expect(loadImage).not.toHaveBeenCalled();
    loadImage.mockResolvedValue({ src: "two", width: 20, height: 30 });
    const controller = new AbortController();
    expect(await entries[1].load({ signal: controller.signal })).toEqual({
      src: "two",
      width: 20,
      height: 30,
    });
    expect(loadImage).toHaveBeenCalledWith(
      { src: "two" },
      { signal: controller.signal },
    );
  });

  it("keeps slow images within a partially loaded album in their original position", async () => {
    const first = image("first");
    const second = image("second", false);
    container.append(slot("album", first, second));
    resolvePreview.mockResolvedValue({
      type: "album",
      images: [{ src: "one" }, { src: "two" }],
    });
    const gallery = collect(first);
    expect(gallery.items).toHaveLength(2);
    expect(gallery.items[0].src).toBe(first.src);
    const resolved = await gallery.items[1].resolve();
    await resolved[0].load();
    expect(loadImage).toHaveBeenCalledExactlyOnceWith(
      { src: "two" },
      undefined,
    );
  });

  it("drops unsupported media and propagates resolver failures", async () => {
    container.append(slot("video"), slot("broken"));
    resolvePreview.mockImplementation((href) =>
      href === "video"
        ? Promise.resolve({ type: "video", src: "movie" })
        : Promise.reject(new Error("bad link")),
    );
    const gallery = collect();
    expect(await gallery.items[0].resolve()).toEqual([]);
    await expect(gallery.items[1].resolve()).rejects.toThrow("bad link");
  });

  it("cancels pending resolution promptly and ignores its eventual result", async () => {
    container.append(slot("pending"));
    let finish;
    resolvePreview.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const controller = new AbortController();
    const result = collect().items[0].resolve({ signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    finish({ src: "late" });
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("does not start a resolver when already cancelled", async () => {
    container.append(slot("pending"));
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect().items[0].resolve({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(resolvePreview).not.toHaveBeenCalled();
  });
});

function imageFactoryFor(outcomes) {
  const images = [];
  const factory = () => {
    const outcome = outcomes.shift();
    const node = {
      naturalWidth: 800,
      naturalHeight: 600,
      removeAttribute: vi.fn(),
      set src(value) {
        this.currentSrc = value;
        queueMicrotask(() =>
          outcome === "ok" ? this.onload?.() : this.onerror?.(),
        );
      },
    };
    images.push(node);
    return node;
  };
  return { factory, images };
}

describe("article image loading", () => {
  it("retries each candidate with shared backoff before falling back", async () => {
    const { factory, images } = imageFactoryFor([
      "error",
      "error",
      "error",
      "ok",
    ]);
    const delay = vi.fn().mockResolvedValue();
    const measured = await loadArticleImage(
      { src: "primary", srcset: ["first", "fallback"], alt: "Photo" },
      { imageFactory: factory, delay },
    );
    expect(images.map((node) => node.currentSrc)).toEqual([
      "first",
      "first",
      "first",
      "fallback",
    ]);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([300, 600]);
    expect(measured).toEqual({
      src: "fallback",
      width: 800,
      height: 600,
      alt: "Photo",
      referrerPolicy: "no-referrer",
    });
  });

  it("keeps the referer for hosts that require it", async () => {
    const { factory, images } = imageFactoryFor(["ok"]);
    const result = await loadArticleImage(
      { src: "https://verb.tw/photo.png" },
      { imageFactory: factory },
    );
    expect(result.referrerPolicy).toBe("");
    expect(images[0].referrerPolicy).toBe("");
  });

  it("reports failure after the final candidate exhausts its retry budget", async () => {
    const { factory, images } = imageFactoryFor(["error", "error", "error"]);
    await expect(
      loadArticleImage(
        { src: "broken" },
        { imageFactory: factory, delay: vi.fn().mockResolvedValue() },
      ),
    ).rejects.toThrow("The image could not be loaded.");
    expect(images).toHaveLength(3);
  });

  it("stops an active image request and clears handlers on cancellation", async () => {
    const node = { removeAttribute: vi.fn() };
    const controller = new AbortController();
    const result = loadArticleImage(
      { src: "slow" },
      { signal: controller.signal, imageFactory: () => node },
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(node.removeAttribute).toHaveBeenCalledWith("src");
    expect(node.onload).toBeNull();
    expect(node.onerror).toBeNull();
  });

  it("cancels retry backoff without starting another request", async () => {
    vi.useFakeTimers();
    try {
      const { factory, images } = imageFactoryFor(["error"]);
      const controller = new AbortController();
      const result = loadArticleImage(
        { src: "broken" },
        { signal: controller.signal, imageFactory: factory },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      await expect(result).rejects.toMatchObject({ name: "AbortError" });
      expect(vi.getTimerCount()).toBe(0);
      expect(images).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
