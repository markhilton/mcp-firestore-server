import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/delete-document.js";
import { makeDb } from "../fakes/firestore.js";

test("delete_document: removes the document and reports the operation", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada" }, { id: "b", name: "Bo" }] });
  const res = await handler({ collection: "users", docId: "a" }, db);

  assert.deepEqual(res, { collection: "users", id: "a", operation: "deleted" });
  assert.equal(db.data.users.a, undefined);
  assert.ok(db.data.users.b, "other docs are untouched");
  assert.equal(db.writes.at(-1).op, "delete");
});
