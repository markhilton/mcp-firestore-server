import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/create-document.js";
import { makeDb } from "../fakes/firestore.js";
import { TARGETS } from "../../src/constants.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

test("create_document: writes with an explicit docId", async () => {
  const db = makeDb();
  const res = await handler(
    { collection: "users", docId: "a", data: { name: "Ada" } },
    db,
  );

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

test("create_document: refuses production write without confirm", async () => {
  const db = makeDb();
  await assert.rejects(
    () => handler({ collection: "users", data: { name: "Ada" } }, db, TARGETS.PRODUCTION),
    /production/i,
  );
  assert.equal(db.writes.length, 0, "nothing is written");
});

test("create_document: rejects empty data", async () => {
  const db = makeDb();
  await assert.rejects(
    () => handler({ collection: "users", data: {} }, db, TARGETS.EMULATOR),
    /at least one field/,
  );
});

test("create_document: decodes Timestamps and sentinels before writing", async () => {
  const db = makeDb();
  await handler(
    {
      collection: "image_advisories",
      docId: "x",
      data: {
        resolvedAt: { _seconds: 1791681467, _nanoseconds: 0 },
        createdAt: { $serverTimestamp: true },
      },
    },
    db,
  );
  const written = db.writes[0].data;
  assert.ok(written.resolvedAt instanceof Timestamp);
  assert.equal(written.resolvedAt.seconds, 1791681467);
  assert.ok(written.createdAt.isEqual(FieldValue.serverTimestamp()));
});

test("create_document: rejects $delete and writes nothing", async () => {
  const db = makeDb();
  await assert.rejects(
    () => handler({ collection: "users", data: { a: 1, b: { $delete: true } } }, db),
    /\$delete is only valid/,
  );
  assert.equal(db.writes.length, 0);
});
