import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WHERE_OPERATORS,
  applyWhereClauses,
  applyOrderBy,
  applyPagination,
  executeQuery,
  mapDocSnapshot,
} from "../../src/helpers/query.js";
import { makeDb } from "../fakes/firestore.js";

test("WHERE_OPERATORS lists the supported Firestore operators", () => {
  assert.ok(WHERE_OPERATORS.includes("=="));
  assert.ok(WHERE_OPERATORS.includes("array-contains-any"));
  assert.equal(WHERE_OPERATORS.length, 9);
});

test("applyWhereClauses: coerces values and chains where() calls", () => {
  const db = makeDb({
    users: [
      { id: "a", age: 30, active: true },
      { id: "b", age: 25, active: false },
      { id: "c", age: 30, active: true },
    ],
  });
  const { query, clauses } = applyWhereClauses(db.collection("users"), [
    ["age", "==", "30"],
    ["active", "==", "true"],
  ]);

  // values are coerced from strings
  assert.deepEqual(clauses, [
    { field: "age", operator: "==", value: 30 },
    { field: "active", operator: "==", value: true },
  ]);

  return query.get().then(snap => {
    assert.equal(snap.size, 2);
    assert.deepEqual(snap.docs.map(d => d.id).sort(), ["a", "c"]);
  });
});

test("applyOrderBy: no-op when args.orderBy is absent", () => {
  const db = makeDb({ users: [{ id: "a" }] });
  const q = db.collection("users");
  assert.equal(applyOrderBy(q, {}), q); // same reference, untouched
});

test("applyOrderBy: applies direction", async () => {
  const db = makeDb({
    users: [
      { id: "a", age: 30 },
      { id: "b", age: 25 },
      { id: "c", age: 40 },
    ],
  });
  const q = applyOrderBy(db.collection("users"), { orderBy: "age", orderDirection: "desc" });
  const snap = await q.get();
  assert.deepEqual(snap.docs.map(d => d.id), ["c", "a", "b"]);
});

test("applyPagination: returns query unchanged when no startAfter", async () => {
  const db = makeDb({ users: [{ id: "a" }] });
  const q = db.collection("users");
  assert.equal(await applyPagination(q, db, "users", undefined), q);
});

test("applyPagination: silently skips a non-existent startAfter doc", async () => {
  const db = makeDb({ users: [{ id: "a", n: 1 }] });
  const q = await applyPagination(db.collection("users"), db, "users", "ghost");
  const snap = await q.get();
  assert.equal(snap.size, 1); // cursor ignored, all docs returned
});

test("applyPagination: starts after an existing doc", async () => {
  const db = makeDb({
    users: [
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "c", n: 3 },
    ],
  });
  const ordered = applyOrderBy(db.collection("users"), { orderBy: "n" });
  const q = await applyPagination(ordered, db, "users", "a");
  const snap = await q.get();
  assert.deepEqual(snap.docs.map(d => d.id), ["b", "c"]);
});

test("executeQuery: applies default limit of 10 and computes lastDocId", async () => {
  const seed = Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, n: i }));
  const db = makeDb({ items: seed });
  const ordered = applyOrderBy(db.collection("items"), { orderBy: "n" });

  const { docs, lastDocId } = await executeQuery(ordered, undefined);
  assert.equal(docs.length, 10);
  assert.equal(lastDocId, "d9");
  assert.deepEqual(docs[0], { id: "d0", data: { n: 0 } });
});

test("executeQuery: honors an explicit limit and parses string limits", async () => {
  const db = makeDb({ items: [{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "c", n: 3 }] });
  const { docs } = await executeQuery(applyOrderBy(db.collection("items"), { orderBy: "n" }), "2");
  assert.equal(docs.length, 2);
});

test("executeQuery: empty result yields null lastDocId", async () => {
  const db = makeDb({ items: [] });
  const { docs, lastDocId } = await executeQuery(db.collection("items"), 10);
  assert.equal(docs.length, 0);
  assert.equal(lastDocId, null);
});

test("mapDocSnapshot: existing document", () => {
  assert.deepEqual(mapDocSnapshot({ id: "a", exists: true, data: () => ({ x: 1 }) }), {
    id: "a",
    exists: true,
    data: { x: 1 },
  });
});

test("mapDocSnapshot: missing document yields null data", () => {
  assert.deepEqual(mapDocSnapshot({ id: "z", exists: false, data: () => ({ x: 1 }) }), {
    id: "z",
    exists: false,
    data: null,
  });
});
