import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/query-with-where.js";
import { makeDb } from "../fakes/firestore.js";

function seedDb() {
  return makeDb({
    users: [
      { id: "a", role: "admin", age: 30 },
      { id: "b", role: "user", age: 25 },
      { id: "c", role: "admin", age: 40 },
    ],
  });
}

test("query_with_where: multi-clause where format", async () => {
  const db = seedDb();
  const res = await handler({ collection: "users", where: [["role", "==", "admin"]] }, db);

  assert.equal(res.collection, "users");
  assert.equal(res.count, 2);
  assert.equal(res.query, 'role == "admin"');
  assert.deepEqual(res.documents.map(d => d.id).sort(), ["a", "c"]);
  assert.ok(res.lastDocId);
});

test("query_with_where: joins multiple clauses with AND", async () => {
  const db = seedDb();
  const res = await handler(
    { collection: "users", where: [["role", "==", "admin"], ["age", ">", "35"]] },
    db,
  );
  assert.equal(res.count, 1);
  assert.equal(res.query, 'role == "admin" AND age > 35');
  assert.equal(res.documents[0].id, "c");
});

test("query_with_where: legacy field/operator/value format with coercion", async () => {
  const db = seedDb();
  const res = await handler(
    { collection: "users", field: "age", operator: "==", value: "25" },
    db,
  );
  assert.equal(res.count, 1);
  assert.equal(res.query, "age == 25");
  assert.equal(res.documents[0].id, "b");
});

test("query_with_where: throws when neither where nor legacy params are given", async () => {
  const db = seedDb();
  await assert.rejects(
    () => handler({ collection: "users" }, db),
    /Provide either 'where' array or 'field'\/'operator'\/'value'/,
  );
});

test("query_with_where: empty result omits lastDocId", async () => {
  const db = seedDb();
  const res = await handler({ collection: "users", where: [["role", "==", "ghost"]] }, db);
  assert.equal(res.count, 0);
  assert.equal(res.lastDocId, undefined);
});
