// Search return history (search_return_history.js): the bounded route that
// article shortcut searches unwind one step at a time. Complete-app behavior is
// covered by tests/e2e/offline/mobile_article_nested_search.offline.spec.js;
// these cases pin the exact bound, eviction, and failure transitions.

import {
  MAX_SEARCH_ORIGINS,
  searchedFrom,
  backStep,
  returned,
  returnMissing,
  rebuilt,
  stoppedAtBoardList,
  reopenedAfterEmptySearch,
  observe
} from "../../src/js/search_return_history";

const origin = (name, kind = "author", board = "Test") => ({
  board,
  aid: `1gIeu-${name}`.slice(0, 8).padEnd(8, "x"),
  author: `${name}-author`,
  title: `[Talk] ${name}`,
  query: { kind, value: kind === "author" ? `${name}-author` : `[Talk] ${name}` },
  position: { lineIndex: 4 }
});

const article = (o) => ({ kind: "article", board: o.board, author: o.author, title: o.title });

// Follow every Back the route owns, reporting each visible destination.
function unwind(route) {
  const visits = [];
  for (let guard = 0; route && guard < 40; guard++) {
    const step = backStep(route);
    if (!step) break;
    if (step.kind === "restore") {
      visits.push(`article ${step.origin.title}`);
      route = returned(route);
    } else {
      visits.push(`results of ${step.origin.title}`);
      route = rebuilt(route);
    }
  }
  return { visits, route };
}

test("mixed author and thread searches unwind article, results, then source at each level", () => {
  const a = origin("A", "author");
  const b = origin("B", "thread");
  const c = origin("C", "author");
  let route = searchedFrom(null, a);
  route = observe(route, article(b));
  route = searchedFrom(route, b);
  route = observe(route, article(c));
  route = searchedFrom(route, c);
  route = observe(route, { kind: "article", board: "Test", author: "d", title: "D" });
  // Native Back from the result article lands on its results.
  route = observe(route, { kind: "results", board: "Test" });

  expect(unwind(route)).toEqual({
    visits: [
      "article [Talk] C",
      "results of [Talk] B",
      "article [Talk] B",
      "results of [Talk] A",
      "article [Talk] A"
    ],
    route: null
  });
});

test("retains only the eight most recent origins and evicts the oldest first", () => {
  expect(MAX_SEARCH_ORIGINS).toBe(8);
  let route = null;
  for (let index = 1; index <= 10; index++) route = searchedFrom(route, origin(`N${index}`));
  const restored = unwind(route).visits.filter((visit) => visit.startsWith("article"));
  expect(restored).toEqual([
    "article [Talk] N10",
    "article [Talk] N9",
    "article [Talk] N8",
    "article [Talk] N7",
    "article [Talk] N6",
    "article [Talk] N5",
    "article [Talk] N4",
    "article [Talk] N3"
  ]);
});

test("the route stores lightweight serializable origins, not screens or callbacks", () => {
  const route = searchedFrom(null, { ...origin("A"), position: { lineIndex: 7, listOwner: {} } });
  const restored = JSON.parse(JSON.stringify(route));
  expect(restored).toEqual(route);
  expect(backStep(restored).origin).toMatchObject({ aid: "1gIeu-Ax", query: { kind: "author", value: "A-author" }, position: { lineIndex: 7 } });
  expect(backStep(restored).origin.position).not.toHaveProperty("listOwner");
});

test("a search from another board starts a new route instead of extending the old one", () => {
  let route = searchedFrom(null, origin("A"));
  route = searchedFrom(route, origin("Z", "author", "Other"));
  expect(unwind(route).visits).toEqual(["article [Talk] Z"]);
});

test("a deleted source consumes only its own origin and keeps unwinding from the board list", () => {
  let route = searchedFrom(null, origin("A"));
  route = searchedFrom(route, origin("B", "thread"));
  expect(backStep(route)).toMatchObject({ kind: "restore", origin: { title: "[Talk] B" } });
  route = returnMissing(route);
  // The verified board-list fallback stands where B was: inside A's results.
  route = observe(route, { kind: "boardList", board: "Test" });
  expect(unwind(route).visits).toEqual(["results of [Talk] A", "article [Talk] A"]);
  expect(returnMissing(searchedFrom(null, origin("A")))).toBeNull();
});

test("a failed forward search adds no origin and keeps the existing route", () => {
  let route = searchedFrom(null, origin("A"));
  route = observe(route, article(origin("B")));
  route = stoppedAtBoardList(route);
  expect(unwind(route).visits).toEqual(["results of [Talk] A", "article [Talk] A"]);
  expect(stoppedAtBoardList(null)).toBeNull();
});

test("an empty search from a result article reopens it inside the same route", () => {
  const b = origin("B");
  let route = searchedFrom(null, origin("A"));
  route = observe(route, article(b));
  route = reopenedAfterEmptySearch(route, b);
  route = observe(route, article(b));
  expect(unwind(route).visits).toEqual(["results of [Talk] A", "article [Talk] A"]);
  expect(reopenedAfterEmptySearch(null, b)).toBeNull();
});

test("a failed rebuild keeps the origin whose results could not be shown", () => {
  let route = searchedFrom(null, origin("A"));
  route = searchedFrom(route, origin("B"));
  route = returned(route);
  expect(backStep(route)).toMatchObject({ kind: "rebuild", origin: { title: "[Talk] A" } });
  route = stoppedAtBoardList(route);
  expect(backStep(route)).toMatchObject({ kind: "rebuild", origin: { title: "[Talk] A" } });
});

describe("settled screens", () => {
  const a = origin("A");
  const b = origin("B");
  const atResults = () => searchedFrom(null, a);
  const reopened = () => returned(searchedFrom(searchedFrom(null, a), b));

  test("user board switches and the main menu clear the board-scoped route", () => {
    expect(observe(atResults(), { kind: "boardList", board: "Other" })).toBeNull();
    expect(observe(atResults(), { kind: "results", board: "Other" })).toBeNull();
    expect(observe(atResults(), { kind: "menu" })).toBeNull();
    expect(observe(reopened(), { kind: "boardList", board: "Test" })).toBeNull();
  });

  test("a matching board name alone never attaches a route", () => {
    expect(observe(null, { kind: "results", board: "Test" })).toBeNull();
    expect(observe(null, article(a))).toBeNull();
  });

  test("leaving a reopened source for another article ends its claim on Back", () => {
    expect(backStep(observe(reopened(), article(b)))).toMatchObject({ kind: "rebuild" });
    expect(observe(reopened(), article(origin("Other")))).toBeNull();
  });

  test("result articles keep native Back until their results settle again", () => {
    const inArticle = observe(atResults(), article(b));
    expect(backStep(inArticle)).toBeNull();
    expect(backStep(observe(inArticle, { kind: "results", board: "Test" }))).toMatchObject({ kind: "restore" });
  });

  test("the board-list fallback ends once the reader opens another article from it", () => {
    const fallback = stoppedAtBoardList(observe(atResults(), article(b)));
    expect(observe(fallback, { kind: "boardList", board: "Test" })).not.toBeNull();
    expect(observe(fallback, article(origin("Other")))).toBeNull();
  });
});
