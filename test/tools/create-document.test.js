import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/create-document.js";
import { makeDb } from "../fakes/firestore.js";

test("create_document: writes with an explicit docId", async () => {
  const db = makeDb();
  const res = await handler({ collection: "users", docId: "a", data: { name: "Ada" } }, db);

  assert.deepEqual(res, { collection: "users", id: "a", operation: "created" });
  assert.deepEqual(db.data.users.a, { name: "Ada" });
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].op, "set");
});

test("create_document: auto-generates an id when none is provided", async () => {
  const db = makeDb();
  const res = await handler({ collection: "users", data: { name: "Grace" } }, db);

  assert.equal(res.operation, "created");
  assert.ok(res.id, "an id should be generated");
  assert.deepEqual(db.data.users[res.id], { name: "Grace" });
});
