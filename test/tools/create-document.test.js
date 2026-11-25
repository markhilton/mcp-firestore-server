import { test } from "node:test";
import assert from "node:assert/strict";
import { handler, definition } from "../../src/tools/create-document.js";
import { makeDb } from "../fakes/firestore.js";
import { mapError } from "../../src/helpers/errors.js";
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
  assert.equal(db.writes[0].op, "create");
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

test("create_document: existing docId fails with ALREADY_EXISTS and is not replaced", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada" }] });
  await assert.rejects(
    () => handler({ collection: "users", docId: "a", data: { name: "New" } }, db),
    err => {
      assert.equal(mapError(err).code, "ALREADY_EXISTS");
      assert.match(mapError(err).hint, /update_document.*overwrite: true/);
      return true;
    },
  );
  assert.deepEqual(db.data.users.a, { name: "Ada" });
});

test("create_document: overwrite:true replaces an existing doc and reports it", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada", old: 1 }] });
  const res = await handler(
    { collection: "users", docId: "a", data: { name: "New" }, overwrite: true },
    db,
  );
  assert.deepEqual(res, {
    collection: "users",
    id: "a",
    operation: "created",
    overwrite: true,
  });
  assert.deepEqual(db.data.users.a, { name: "New" });
  assert.equal(db.writes[0].op, "set");
});

test("create_document: overwrite must be exactly true; inherited or truthy strings ignored", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada" }] });
  await assert.rejects(() =>
    handler({ collection: "users", docId: "a", data: { x: 1 }, overwrite: "true" }, db),
  );
  Object.prototype.overwrite = true;
  try {
    await assert.rejects(() =>
      handler({ collection: "users", docId: "a", data: { x: 1 } }, db),
    );
  } finally {
    delete Object.prototype.overwrite;
  }
  assert.deepEqual(db.data.users.a, { name: "Ada" });
});

test("create_document: overwrite stays behind the production confirm gate", async () => {
  const db = makeDb();
  await assert.rejects(
    () =>
      handler(
        { collection: "users", docId: "a", data: { x: 1 }, overwrite: true },
        db,
        TARGETS.PRODUCTION,
      ),
    /Refusing production write/,
  );
  assert.equal(db.writes.length, 0);
});

test("create_document: schema documents overwrite as a boolean defaulting to false", () => {
  assert.equal(definition.inputSchema.properties.overwrite.type, "boolean");
  assert.equal(definition.inputSchema.properties.overwrite.default, false);
  assert.ok(definition.inputSchema.properties.overwrite.description);
});

test("create_document: validates a provided docId but still auto-generates when absent", async () => {
  const db = makeDb();
  await assert.rejects(
    () => handler({ collection: "users", docId: "a/b", data: { x: 1 } }, db),
    /must not contain "\/"/,
  );
  await assert.rejects(
    () => handler({ collection: "users", docId: "__x__", data: { x: 1 } }, db),
    /reserved/,
  );
  const res = await handler({ collection: "users", docId: "", data: { x: 1 } }, db);
  assert.ok(res.id);
});

test("create_document: overwrite:true without docId is rejected", async () => {
  const db = makeDb();
  await assert.rejects(
    () => handler({ collection: "users", overwrite: true, data: { a: 1 } }, db),
    /overwrite:true requires docId/,
  );
  assert.equal(db.writes.length, 0, "nothing is written");
});

test("create_document: overwrite false or absent without docId still adds", async () => {
  const db = makeDb();
  const a = await handler({ collection: "users", overwrite: false, data: { a: 1 } }, db);
  const b = await handler({ collection: "users", data: { b: 2 } }, db);
  assert.equal(a.operation, "created");
  assert.equal(b.operation, "created");
  assert.equal(db.writes.length, 2);
});
