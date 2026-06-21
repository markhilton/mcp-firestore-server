import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/update-document.js";
import { makeDb } from "../fakes/firestore.js";
import { TARGETS } from "../../src/constants.js";

test("update_document: merges by default", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada", age: 30 }] });
  const res = await handler({ collection: "users", docId: "a", data: { age: 31 } }, db);

  assert.deepEqual(res, {
    collection: "users",
    id: "a",
    operation: "updated",
    merge: true,
  });
  assert.deepEqual(db.data.users.a, { name: "Ada", age: 31 });
  assert.equal(db.writes.at(-1).options.merge, true);
});

test("update_document: merge:false uses update() and reports merge false", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada", age: 30 }] });
  const res = await handler(
    { collection: "users", docId: "a", data: { age: 32 }, merge: false },
    db,
  );

  assert.equal(res.merge, false);
  assert.equal(db.writes.at(-1).op, "update");
  assert.deepEqual(db.data.users.a, { name: "Ada", age: 32 });
});

test("update_document: refuses production write without confirm", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada", age: 30 }] });
  await assert.rejects(
    () =>
      handler(
        { collection: "users", docId: "a", data: { age: 31 } },
        db,
        TARGETS.PRODUCTION,
      ),
    /production/i,
  );
  assert.deepEqual(db.data.users.a, { name: "Ada", age: 30 }, "doc is unchanged");
});
