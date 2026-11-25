import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/get-document.js";
import { makeDb } from "../fakes/firestore.js";

test("get_document: returns an existing document", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada" }] });
  const res = await handler({ collection: "users", docId: "a" }, db);
  assert.deepEqual(res, { id: "a", exists: true, data: { name: "Ada" } });
});

test("get_document: missing document yields exists:false and null data", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada" }] });
  const res = await handler({ collection: "users", docId: "ghost" }, db);
  assert.deepEqual(res, { id: "ghost", exists: false, data: null });
});

test("get_document: supports subcollection paths", async () => {
  const db = makeDb({ "users/a/posts": [{ id: "p1", title: "Hi" }] });
  const res = await handler({ collection: "users/a/posts", docId: "p1" }, db);
  assert.equal(res.exists, true);
  assert.deepEqual(res.data, { title: "Hi" });
});

test("get_document: rejects an invalid docId before touching Firestore", async () => {
  const db = makeDb();
  await assert.rejects(
    () => handler({ collection: "users", docId: "a/b" }, db),
    /must not contain "\/"/,
  );
  await assert.rejects(
    () => handler({ collection: "users", docId: ".." }, db),
    /reserved/,
  );
  assert.equal(db.writes.length, 0);
});
