// @unit-env browser
// The embed card's title and channel row (#152). The inline preview slot
// records the card's first loaded height as its placeholder floor: a card
// mounted again (scrolled back, the page rebuilt, an article opened again)
// that renders without the row it already showed lowers that floor inside the
// slot's ResizeObserver callback, so the article jumps up and then down by
// the row's height, and the shrink raises a ResizeObserver loop.

import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import ImagePreviewer from "../../src/components/ImagePreviewer";

const OEMBED = "https://example.com/oembed?id=card-details";

const card = () =>
  render(
    <ImagePreviewer.Inline
      value={{ type: "iframe", src: "https://example.com/embed/2", oembed: OEMBED }}
    />,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embed card details", () => {
  test("a card mounted again shows the details it already fetched in its first render", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ title: "A video", author_name: "A channel" }),
    }));
    vi.stubGlobal("fetch", fetch);
    const first = card();
    await waitFor(() =>
      expect(first.container.querySelector(".embedCardTitle")?.textContent).toBe("A video"),
    );
    first.unmount();

    const again = card();
    expect(again.container.querySelector(".embedCardTitle")?.textContent).toBe("A video");
    expect(again.container.querySelector(".embedCardAuthor")?.textContent).toBe("A channel");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
