import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../src/tools/batch-get.js";
import { makeDb } from "../fakes/firestore.js";

test("batch_get: fetches multiple docs, marking missing ones", async () => {
  const db = makeDb({ users: [{ id: "a", name: "Ada" }, { id: "b", name: "Bo" }] });
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
