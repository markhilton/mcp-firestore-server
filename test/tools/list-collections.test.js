import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/list-collections.js";
import { makeDb } from "../fakes/firestore.js";

test("list_collections: lists top-level collections by default", async () => {
  const db = makeDb({
    users: [{ id: "a" }],
    posts: [{ id: "p1" }],
    "users/a/comments": [{ id: "c1" }],
  });
  const res = await handler({}, db);

  assert.deepEqual(res.collections.sort(), ["posts", "users"]);
  assert.equal(res.documentPath, undefined);
});

test("list_collections: lists subcollections for a documentPath", async () => {
  const db = makeDb({
    users: [{ id: "a" }],
    "users/a/comments": [{ id: "c1" }],
    "users/a/likes": [{ id: "l1" }],
  });
  const res = await handler({ documentPath: "users/a" }, db);

  assert.equal(res.documentPath, "users/a");
  assert.deepEqual(res.collections.sort(), ["comments", "likes"]);
});
