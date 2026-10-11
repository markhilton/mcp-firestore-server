import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/update-document.js";
import { makeDb } from "../fakes/firestore.js";
import { TARGETS } from "../../src/constants.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

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

test("update_document: merge decodes $timestamp and nested $delete", async () => {
  const db = makeDb({
    image_advisories: [{ id: "x", status: "open", meta: { tmp: 1 } }],
  });
  await handler(
    {
      collection: "image_advisories",
      docId: "x",
      data: {
        resolvedAt: { $timestamp: "2026-10-11T01:17:00Z" },
        meta: { tmp: { $delete: true } },
        reviewCount: { $increment: 1 },
      },
    },
    db,
  );
  const { data, options } = db.writes.at(-1);
  assert.equal(options.merge, true);
  assert.ok(data.resolvedAt instanceof Timestamp);
  assert.ok(data.meta.tmp.isEqual(FieldValue.delete()));
  assert.ok(data.reviewCount.isEqual(FieldValue.increment(1)));
});

test("update_document: merge:false allows top-level $delete only", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada", nick: "A", m: { k: 1 } }] });
  await handler(
    { collection: "users", docId: "a", data: { nick: { $delete: true } }, merge: false },
    db,
  );
  assert.ok(db.writes.at(-1).data.nick.isEqual(FieldValue.delete()));

  await assert.rejects(
    () =>
      handler(
        {
          collection: "users",
          docId: "a",
          data: { m: { k: { $delete: true } } },
          merge: false,
        },
        db,
      ),
    /requires merge:true/,
  );
});
