// @unit-env browser
// Embed cover 的海報候選（#89）：YouTube 沒有 hq720 的舊影片不會回錯誤，而是以 404
// 送一張 120×90 的灰色佔位圖，瀏覽器照樣 onLoad。這種窄圖撐不滿卡片，要換下一個候選。

import { render, waitFor } from "@testing-library/react";
import ImagePreviewer from "../../src/components/ImagePreviewer";

const svg = (w, h) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`,
  )}`;
const PLACEHOLDER = svg(120, 90);
const POSTER = svg(480, 360);

const card = (poster) =>
  render(
    <ImagePreviewer.Inline
      value={{ type: "iframe", src: "https://example.com/embed/1", poster }}
    />,
  ).container;

describe("embed cover poster", () => {
  test("佔位圖被跳過，顯示下一個候選", async () => {
    const container = card([PLACEHOLDER, POSTER]);
    await waitFor(() => {
      const img = container.querySelector(".embedCover img");
      expect(img.getAttribute("src")).toBe(POSTER);
      expect(img.style.visibility).toBe("");
    });
  });

  test("沒有可用的候選 ⇒ 不留海報，只剩通用封面", async () => {
    const container = card([PLACEHOLDER]);
    await waitFor(() =>
      expect(container.querySelector(".embedCover img")).toBeNull(),
    );
    expect(container.querySelector(".embedCoverPlay")).not.toBeNull();
    expect(container.querySelector(".embedCard").textContent).toBe(
      "example.com",
    );
  });
});
