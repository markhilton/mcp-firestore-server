import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/batch-get.js";
import { makeDb } from "../fakes/firestore.js";

test("batch_get: fetches multiple docs, marking missing ones", async () => {
  const db = makeDb({
    users: [
      { id: "a", name: "Ada" },
      { id: "b", name: "Bo" },
    ],
  });
  const res = await handler({ collection: "users", docIds: ["a", "ghost", "b"] }, db);

  assert.equal(res.collection, "users");
  assert.equal(res.requested, 3);
  assert.equal(res.count, 2); // only existing docs counted
  assert.deepEqual(
    res.documents.map(d => ({ id: d.id, exists: d.exists })),
    [
      { id: "a", exists: true },
      { id: "ghost", exists: false },
      { id: "b", exists: true },
    ],
  );
  assert.equal(res.documents[1].data, null);
});

test("batch_get: dropped docs plus oversize survivor reports omittedIds and omittedFields", async () => {
  const big = {};
  for (let i = 0; i < 30; i++) big[`f${String(i).padStart(2, "0")}`] = "x".repeat(3000);
  const db = makeDb({
    docs: [
      { id: "a", ...big },
      { id: "b", y: 1 },
    ],
  });
  const res = await handler(
    { collection: "docs", docIds: ["a", "b"], maxChars: 20000, raw: true },
    db,
  );
  assert.deepEqual(res.omittedIds, ["b"]);
  assert.equal(res.truncated, true);
  assert.ok(Array.isArray(res.omittedFields) && res.omittedFields.length > 0);
  const kept = Object.keys(res.documents[0].data);
  assert.equal(kept.length + res.omittedFields.length, 30);
  assert.ok(res.omittedFields.every(f => !kept.includes(f)));
  assert.ok(res.hint);
});

test("batch_get: fields mask is honoured with dotted paths", async () => {
  const db = makeDb({ docs: [{ id: "a", author: { name: "Ada", age: 3 }, z: 1 }] });
  const res = await handler(
    { collection: "docs", docIds: ["a"], fields: ["author.name"] },
    db,
  );
  assert.deepEqual(res.documents[0].data, { author: { name: "Ada" } });
});
