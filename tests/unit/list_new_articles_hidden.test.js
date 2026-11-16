import { describe, expect, test } from "vitest";
import { ListSession } from "../../src/js/list_session";
import { pageArticleNums } from "../../src/js/comment_parse";

// #238: Back onto PTT's list after reading an article. The new-articles notice
// compares PTT's landing page with the newest article the kept layer shows;
// a row the list hides is not a new article to the reader.
const ROWS = 24;
const visible = (num) => `  ${num} + 3 9/23 someone      □ an article`;
const deleted = (num) => `  ${num}     9/23 -            □ (本文已被刪除) [someone]`;

function landing(rows) {
  const rowTexts = Array.from({ length: ROWS }, () => "");
  rows.forEach((text, i) => (rowTexts[3 + i] = text));
  return { kind: "clean-list", boardName: "Steam", rows: ROWS, rowTexts, nums: pageArticleNums(rowTexts, 3) };
}

function lands(facts, newest, view = {}) {
  const session = {
    state: "suspended",
    _view: view,
    _keptLayer: () => ({ listPage: { newestNum: () => newest } }),
    _layerResultsLeft: () => false
  };
  return ListSession.prototype._landsNewerArticles.call(session, facts);
}

describe("new-articles notice and rows the list hides", () => {
  test("the fixture rows carry their numbers", () => {
    expect(landing([visible(62348), deleted(62349)]).nums.slice(3, 5)).toEqual([62348, 62349]);
  });

  test("a newer deleted row alone raises no notice", () => {
    expect(lands(landing([visible(62348), deleted(62349)]), 62348)).toBe(false);
  });

  test("a newer row of a blacklisted author raises no notice", () => {
    const view = { blacklist: new Set(["someone"]) };
    expect(lands(landing([visible(62348), visible(62349)]), 62348, view)).toBe(false);
  });

  test("a newer visible row still raises it, with a deleted row beside it", () => {
    expect(lands(landing([visible(62348), deleted(62349), visible(62350)]), 62348)).toBe(true);
  });
});
