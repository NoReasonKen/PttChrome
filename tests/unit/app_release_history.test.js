import {
  releaseHistory,
  summaryForLocale,
} from "../../src/js/release_history.js";

test("release history omits prepared but unpublished notes", () => {
  expect(
    releaseHistory([
      {
        version: "0.2.0",
        publishedAt: "2026-10-29T13:50:08Z",
        summary: { en: ["Published"] },
      },
      {
        version: "0.3.0",
        publishedAt: null,
        summary: { en: ["Not released"] },
      },
    ]).map((record) => record.version),
  ).toEqual(["0.2.0"]);
});

test.each(["zh", "zh-TW", "zh-CN", "zh-HK", "zh-Hant-TW"])(
  "Chinese primary locale %s selects Traditional Chinese summary",
  (language) => {
    expect(
      summaryForLocale(
        { summary: { zhTW: ["繁體中文"], en: ["English"] } },
        language,
      ),
    ).toEqual(["繁體中文"]);
  },
);

test.each(["", "en-US", "ja-JP"])(
  "other or unavailable primary locale %s selects English",
  (language) => {
    expect(
      summaryForLocale(
        { summary: { zhTW: ["繁體中文"], en: ["English"] } },
        language,
      ),
    ).toEqual(["English"]);
  },
);
