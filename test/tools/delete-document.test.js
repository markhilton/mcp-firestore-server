import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/delete-document.js";
import { makeDb } from "../fakes/firestore.js";
import { TARGETS } from "../../src/constants.js";

test("delete_document: removes the document and reports the operation", async () => {
  const db = makeDb({
    users: [
      { id: "a", name: "Ada" },
      { id: "b", name: "Bo" },
    ],
  });
  const res = await handler({ collection: "users", docId: "a" }, db, TARGETS.EMULATOR);

  assert.deepEqual(res, { collection: "users", id: "a", operation: "deleted" });
  assert.equal(db.data.users.a, undefined);
  assert.ok(db.data.users.b, "other docs are untouched");
  assert.equal(db.writes.at(-1).op, "delete");
});

test("delete_document: refuses production delete without confirm", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada" }] });
  await assert.rejects(
    () => handler({ collection: "users", docId: "a" }, db, TARGETS.PRODUCTION),
    /production/i,
  );
  assert.ok(db.data.users.a, "the document is left intact");
});

test("delete_document: allows production delete with confirm:true", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada" }] });
  const res = await handler(
    { collection: "users", docId: "a", confirm: true },
    db,
    TARGETS.PRODUCTION,
  );
  assert.equal(res.operation, "deleted");
  assert.equal(db.data.users.a, undefined);
});
