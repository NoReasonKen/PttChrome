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
  observe,
  SEARCH_RETURN_MAX_AGE_MS,
  recoveryTarget,
  recoveryRecord,
  readRecoveryRecord,
  recovered
} from "../../src/js/search_return_history";
import { SNAPSHOT_MAX_AGE_MS } from "../../src/js/reconnect_resume";

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

describe("recovery after disconnection, reload or reopen", () => {
  const a = origin("A");
  const b = origin("B", "thread");
  const now = Date.UTC(2026, 9, 25, 12);
  const listPlan = { kind: "list", board: "Test", num: null };
  const articlePlan = (o) => ({ kind: "article", board: o.board, aid: o.aid });
  // Persist through JSON exactly as localStorage would.
  const stored = (route, plan, article, at = now) =>
    JSON.parse(JSON.stringify(recoveryRecord(route, recoveryTarget(plan, article), at)));

  test("records stay valid for exactly the twelve hours open-resume uses", () => {
    expect(SEARCH_RETURN_MAX_AGE_MS).toBe(SNAPSHOT_MAX_AGE_MS);
    const record = stored(searchedFrom(null, a), listPlan, null);
    expect(readRecoveryRecord(record, now + SEARCH_RETURN_MAX_AGE_MS)).not.toBeNull();
    expect(readRecoveryRecord(record, now + SEARCH_RETURN_MAX_AGE_MS + 1)).toBeNull();
    expect(readRecoveryRecord(record, now - 1)).toBeNull();
  });

  test("damaged or oversized stored records are rejected as a whole", () => {
    const good = stored(searchedFrom(searchedFrom(null, a), b), listPlan, null);
    const damaged = (change) => {
      const record = JSON.parse(JSON.stringify(good));
      change(record);
      return readRecoveryRecord(record, now);
    };
    expect(damaged(() => {})).not.toBeNull();
    expect(damaged((r) => { r.v = 2; })).toBeNull();
    expect(damaged((r) => { r.route.phase = "unknown"; })).toBeNull();
    expect(damaged((r) => { r.route.origins = []; })).toBeNull();
    expect(damaged((r) => { r.route.origins = Array(9).fill(r.route.origins[0]); })).toBeNull();
    expect(damaged((r) => { r.route.origins[0].aid = "#1gIeu-3A\r"; })).toBeNull();
    expect(damaged((r) => { r.route.origins[1].board = "Other"; })).toBeNull();
    expect(damaged((r) => { r.route.origins[0].query.kind = "push"; })).toBeNull();
    expect(damaged((r) => { r.route.origins[0].query.value = "x".repeat(500); })).toBeNull();
    expect(damaged((r) => { r.route.origins[0].position = "line 4"; })).toBeNull();
    expect(damaged((r) => { r.target = { kind: "list", board: "Other" }; })).toBeNull();
    expect(damaged((r) => { r.target = { kind: "article", board: "Test", aid: "1gIeu-3A" }; })).toBeNull();
    expect(damaged((r) => { r.route.phase = "reopened"; })).toBeNull();
    expect(readRecoveryRecord(null, now)).toBeNull();
    expect(readRecoveryRecord("{}", now)).toBeNull();
  });

  test("board names compare case-insensitively when a stored record is read back", () => {
    // PTT board names are case-insensitive; one route may meet several spellings.
    const route = searchedFrom(searchedFrom(null, a), origin("B", "thread", "TEST"));
    const record = stored(route, { kind: "list", board: "test", num: null }, null);
    expect(record).not.toBeNull();
    expect(readRecoveryRecord(record, now)).not.toBeNull();
  });

  describe("validating the landed screen", () => {
    const boardList = { kind: "boardList", board: "Test" };
    // The reader was in result article B of A's search when interrupted.
    const inResult = () => observe(searchedFrom(null, a), article(b));
    const recover = (route, plan, article, landed) => {
      const record = readRecoveryRecord(stored(route, plan, article), now);
      return recovered(record.route, record.target, plan, landed);
    };

    test("a result article reopened by its verified AID stands on rebuilt results", () => {
      const route = recover(inResult(), articlePlan(b), article(b), article(b));
      expect(unwind(route).visits).toEqual(["results of [Talk] A", "article [Talk] A"]);
    });

    test("a reopened source keeps unwinding through its parent's results", () => {
      const reopened = returned(searchedFrom(searchedFrom(null, a), b));
      const route = recover(reopened, articlePlan(b), article(b), article(b));
      expect(unwind(route).visits).toEqual(["results of [Talk] A", "article [Talk] A"]);
    });

    test("results recovered as their full board list rebuild them before the source", () => {
      const route = recover(searchedFrom(null, a), listPlan, null, boardList);
      expect(unwind(route).visits).toEqual(["results of [Talk] A", "article [Talk] A"]);
      const urlLess = recover(inResult(), listPlan, null, boardList);
      expect(unwind(urlLess).visits).toEqual(["results of [Talk] A", "article [Talk] A"]);
    });

    test("anything other than the planned screen leaves the route inactive", () => {
      const other = { ...article(origin("Other")) };
      expect(recover(inResult(), articlePlan(b), article(b), other)).toBeNull();
      expect(recover(inResult(), articlePlan(b), article(b), { ...article(b), board: "Elsewhere" })).toBeNull();
      expect(recover(inResult(), articlePlan(b), article(b), boardList)).toBeNull();
      expect(recover(searchedFrom(null, a), listPlan, null, { kind: "results", board: "Test" })).toBeNull();
      expect(recover(searchedFrom(null, a), listPlan, null, { kind: "boardList", board: "Other" })).toBeNull();
      expect(recover(searchedFrom(null, a), listPlan, null, { kind: "menu" })).toBeNull();
      expect(recover(searchedFrom(null, a), listPlan, null, article(a))).toBeNull();
    });

    test("a route only follows the resume plan it was stored with", () => {
      const record = readRecoveryRecord(stored(inResult(), articlePlan(b), article(b)), now);
      expect(recovered(record.route, record.target, articlePlan(a), article(b))).toBeNull();
      expect(recovered(record.route, record.target, { kind: "list", board: "Test" }, boardList)).toBeNull();
      expect(recovered(record.route, record.target, null, article(b))).toBeNull();
    });

    test("a reopened source cannot be attached to a different article identity", () => {
      const reopened = returned(searchedFrom(searchedFrom(null, a), b));
      const record = readRecoveryRecord(stored(reopened, articlePlan(b), article(b)), now);
      const renamed = { ...record.route, at: { author: "x", title: "y" } };
      expect(recovered(renamed, record.target, articlePlan(b), article(b))).toBeNull();
    });

    test("nothing is stored for an empty route or a plan on another board", () => {
      expect(recoveryRecord(null, recoveryTarget(listPlan, null), now)).toBeNull();
      expect(recoveryRecord(searchedFrom(null, a), recoveryTarget({ kind: "list", board: "Other" }, null), now)).toBeNull();
      expect(recoveryTarget({ kind: "article", board: "Test", aid: b.aid }, null)).toBeNull();
      expect(recoveryTarget(null, article(b))).toBeNull();
    });
  });
});
