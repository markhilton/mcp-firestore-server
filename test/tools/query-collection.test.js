import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/query-collection.js";
import { makeDb } from "../fakes/firestore.js";

test("query_collection: returns ordered, limited documents with lastDocId", async () => {
  const db = makeDb({
    posts: [
      { id: "p1", rank: 1 },
      { id: "p2", rank: 2 },
      { id: "p3", rank: 3 },
    ],
  });
  const res = await handler({ collection: "posts", orderBy: "rank", limit: 2 }, db);

  assert.equal(res.collection, "posts");
  assert.equal(res.count, 2);
  assert.deepEqual(
    res.documents.map(d => d.id),
    ["p1", "p2"],
  );
  assert.equal(res.lastDocId, "p2");
});

test("query_collection: paginates via startAfter", async () => {
  const db = makeDb({
    posts: [
      { id: "p1", rank: 1 },
      { id: "p2", rank: 2 },
      { id: "p3", rank: 3 },
    ],
  });
  const res = await handler(
    { collection: "posts", orderBy: "rank", startAfter: "p2" },
    db,
  );
  assert.deepEqual(
    res.documents.map(d => d.id),
    ["p3"],
  );
});

test("query_collection: empty collection omits lastDocId", async () => {
  const db = makeDb({ posts: [] });
  const res = await handler({ collection: "posts" }, db);
  assert.equal(res.count, 0);
  assert.equal(res.lastDocId, undefined);
});
