// @unit-env browser
// Embed cover（#89）：iframe 內嵌在讀者點下去之前只顯示 PttChrome 自己的封面，
// 跨來源 iframe 才不會吞掉文章的左右滑。封面要用的資料由各來源的 resolver 宣告在
// descriptor 上（poster / label），渲染端完全通用。iframe 只在點擊後才建立，
// 所以 src 本身就要帶「載入即播放」的參數。

import { resolveSrcToImageUrl } from "../../src/components/ImagePreviewer";

const resolve = (src) => resolveSrcToImageUrl({ src });

describe("embed cover descriptor", () => {
  test("YouTube watch 連結：海報圖、保留 start 並自動播放、來源名", async () => {
    expect(
      await resolve("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30"),
    ).toEqual({
      type: "iframe",
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ?start=30&autoplay=1",
      poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      label: "YouTube",
    });
  });

  test("youtu.be 短網址沒有 t 也照樣自動播放", async () => {
    expect(await resolve("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      type: "iframe",
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1",
      poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      label: "YouTube",
    });
  });

  // Twitch clip 的 embed 預設就會自動播放；沒有免 API 的海報網址，走無圖的通用封面。
  test("Twitch clip：只有來源名、沒有海報", async () => {
    const d = await resolve("https://clips.twitch.tv/Abc-123");
    expect(d).toEqual({
      type: "iframe",
      src: expect.stringMatching(
        /^https:\/\/clips\.twitch\.tv\/embed\?clip=Abc-123&parent=/,
      ),
      label: "Twitch",
    });
    expect(d).not.toHaveProperty("poster");
  });
});
