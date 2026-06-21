import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/count-documents.js";
import { makeDb } from "../fakes/firestore.js";

function seedDb() {
  return makeDb({
    users: [
      { id: "a", role: "admin" },
      { id: "b", role: "user" },
      { id: "c", role: "admin" },
    ],
  });
}

test("count_documents: counts the whole collection without where", async () => {
  const res = await handler({ collection: "users" }, seedDb());
  assert.equal(res.collection, "users");
  assert.equal(res.count, 3);
  assert.equal(res.where, undefined);
});

test("count_documents: counts with a where filter and echoes the clause", async () => {
  const where = [["role", "==", "admin"]];
  const res = await handler({ collection: "users", where }, seedDb());
  assert.equal(res.count, 2);
  assert.deepEqual(res.where, where);
});
