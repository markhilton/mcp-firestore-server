import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectData,
  compactData,
  resolveMaxChars,
  normalizeFields,
} from "../../src/helpers/output.js";
import { WHERE_OPERATORS } from "../../src/helpers/query.js";
import { handler as queryCollection } from "../../src/tools/query-collection.js";
import { handler as queryWithWhere } from "../../src/tools/query-with-where.js";
import { handler as getDocument } from "../../src/tools/get-document.js";
import { handler as batchGet } from "../../src/tools/batch-get.js";
import { makeDb } from "../fakes/firestore.js";

const vec = n => Array.from({ length: n }, (_, i) => i / 10);

test("projectData: nested dotted paths and missing paths", () => {
  const data = { a: { b: 1, c: 2 }, d: 3, e: 4 };
  assert.deepEqual(projectData(data, ["a.b", "d", "nope.x"]), { a: { b: 1 }, d: 3 });
  assert.equal(projectData(data, null), data);
});

test("normalizeFields: rejects bad input, empty means all", () => {
  assert.equal(normalizeFields([]), null);
  assert.throws(() => normalizeFields("a"), /fields/);
  assert.throws(() => normalizeFields([""]), /fields/);
});

test("compactData: collapses long numeric arrays and records paths", () => {
  const { data, compacted } = compactData("d1", { emb: vec(768), small: vec(10) });
  assert.match(data.emb, /^\[768 numbers omitted/);
  assert.equal(data.small.length, 10);
  assert.deepEqual(compacted, ["d1.emb"]);
});

test("compactData: truncates long strings, recurses nested, leaves class instances", () => {
  class Ts {}
  const ts = new Ts();
  const { data, compacted } = compactData("d1", {
    text: "x".repeat(4500),
    n: { deep: "y".repeat(4001) },
    ts,
  });
  assert.ok(data.text.endsWith("… [truncated 500 chars]"));
  assert.equal(data.text.length, 4000 + "… [truncated 500 chars]".length);
  assert.ok(data.n.deep.endsWith("[truncated 1 chars]"));
  assert.equal(data.ts, ts);
  assert.deepEqual(compacted, ["d1.text", "d1.n.deep"]);
});

test("compactData: raw bypasses", () => {
  const input = { emb: vec(100) };
  const { data, compacted } = compactData("d1", input, true);
  assert.equal(data, input);
  assert.deepEqual(compacted, []);
});

test("resolveMaxChars: default, env, per-call, validation", () => {
  assert.equal(resolveMaxChars(undefined, {}), 60000);
  assert.equal(
    resolveMaxChars(undefined, { MCP_FIRESTORE_MAX_RESPONSE_CHARS: "5000" }),
    5000,
  );
  assert.equal(resolveMaxChars(2000, { MCP_FIRESTORE_MAX_RESPONSE_CHARS: "5000" }), 2000);
  assert.throws(() => resolveMaxChars(10, {}), /maxChars/);
  assert.throws(() => resolveMaxChars(600000, {}), /maxChars/);
});

test("WHERE_OPERATORS includes not-in and query_with_where accepts it", async () => {
  assert.ok(WHERE_OPERATORS.includes("not-in"));
  const db = makeDb({
    t: [
      { id: "a", s: "x" },
      { id: "b", s: "y" },
    ],
  });
  const res = await queryWithWhere(
    { collection: "t", where: [["s", "not-in", '["x"]']] },
    db,
  );
  assert.deepEqual(
    res.documents.map(d => d.id),
    ["b"],
  );
});

test("query_collection: select() called with fields, not when absent or empty", async () => {
  const db = makeDb({ t: [{ id: "a", x: 1, y: 2 }] });
  const res = await queryCollection({ collection: "t", fields: ["x"] }, db);
  assert.deepEqual(db.selectCalls, [["x"]]);
  assert.deepEqual(res.documents[0].data, { x: 1 });

  const db2 = makeDb({ t: [{ id: "a", x: 1 }] });
  await queryCollection({ collection: "t" }, db2);
  await queryCollection({ collection: "t", fields: [] }, db2);
  assert.equal(db2.selectCalls.length, 0);
});

test("query_with_where: select() applied with fields", async () => {
  const db = makeDb({ t: [{ id: "a", x: 1, y: 2 }] });
  await queryWithWhere(
    { collection: "t", field: "x", operator: "==", value: "1", fields: ["y"] },
    db,
  );
  assert.deepEqual(db.selectCalls, [["y"]]);
});

test("query_collection: vector collapsed with compacted list; raw:true bypasses", async () => {
  const db = makeDb({ t: [{ id: "a", emb: vec(768), name: "n" }] });
  const res = await queryCollection({ collection: "t" }, db);
  assert.match(res.documents[0].data.emb, /768 numbers omitted/);
  assert.deepEqual(res.compacted, ["a.emb"]);
  assert.equal(res.count, 1);

  const raw = await queryCollection({ collection: "t", raw: true, maxChars: 500000 }, db);
  assert.equal(raw.documents[0].data.emb.length, 768);
  assert.equal("compacted" in raw, false);
});

test("query_collection: budget truncates trailing docs, keeps lastDocId of returned", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `d${i}`,
    rank: i,
    body: "z".repeat(500),
  }));
  const db = makeDb({ t: rows });
  const res = await queryCollection(
    { collection: "t", orderBy: "rank", limit: 10, maxChars: 1500 },
    db,
  );
  assert.equal(res.truncated, true);
  assert.equal(res.truncatedReason, "maxChars");
  assert.ok(res.count >= 1 && res.count < 10);
  assert.equal(res.count, res.documents.length);
  assert.equal(res.lastDocId, res.documents[res.documents.length - 1].id);
  assert.ok(JSON.stringify(res.documents, null, 2).length <= 1500);

  const next = await queryCollection(
    { collection: "t", orderBy: "rank", limit: 1, startAfter: res.lastDocId },
    db,
  );
  assert.equal(next.documents[0].id, `d${res.count}`);
});

test("query_collection: always keeps at least one doc", async () => {
  const db = makeDb({
    t: [
      { id: "a", n: 1, body: "q".repeat(3000) },
      { id: "b", n: 2, body: "q" },
    ],
  });
  const res = await queryCollection(
    { collection: "t", orderBy: "n", maxChars: 1000 },
    db,
  );
  assert.equal(res.count, 1);
  assert.ok(res.hint);
});

test("query_collection: env override sets budget", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: `d${i}`,
    body: "z".repeat(400),
  }));
  const db = makeDb({ t: rows });
  process.env.MCP_FIRESTORE_MAX_RESPONSE_CHARS = "1200";
  try {
    const res = await queryCollection({ collection: "t" }, db);
    assert.equal(res.truncated, true);
    assert.ok(res.count < 5);
  } finally {
    delete process.env.MCP_FIRESTORE_MAX_RESPONSE_CHARS;
  }
});

test("get_document: nested projection, compaction, and absent doc", async () => {
  const db = makeDb({ t: [{ id: "a", meta: { k: 1, j: 2 }, emb: vec(100), other: 1 }] });
  const res = await getDocument(
    { collection: "t", docId: "a", fields: ["meta.k", "emb"] },
    db,
  );
  assert.deepEqual(Object.keys(res.data), ["meta", "emb"]);
  assert.deepEqual(res.data.meta, { k: 1 });
  assert.deepEqual(res.compacted, ["a.emb"]);

  const missing = await getDocument({ collection: "t", docId: "zz" }, db);
  assert.equal(missing.exists, false);
});

test("get_document: over budget sets truncated, omittedFields and hint", async () => {
  const db = makeDb({
    t: [{ id: "a", small: 1, big: "x".repeat(3500), big2: "y".repeat(3500) }],
  });
  const res = await getDocument(
    { collection: "t", docId: "a", raw: true, maxChars: 1000 },
    db,
  );
  assert.equal(res.truncated, true);
  assert.ok(res.omittedFields.includes("big"));
  assert.match(res.hint, /fields/);
  assert.equal(res.data.small, 1);
});

test("batch_get: projection, compaction, and trailing-doc budget with omittedIds", async () => {
  const db = makeDb({
    t: [
      { id: "a", emb: vec(100), n: 1, body: "z".repeat(600) },
      { id: "b", n: 2, body: "z".repeat(600) },
      { id: "c", n: 3, body: "z".repeat(600) },
    ],
  });
  const proj = await batchGet({ collection: "t", docIds: ["a", "b"], fields: ["n"] }, db);
  assert.deepEqual(proj.documents[0].data, { n: 1 });

  const comp = await batchGet({ collection: "t", docIds: ["a"] }, db);
  assert.deepEqual(comp.compacted, ["a.emb"]);

  const res = await batchGet(
    { collection: "t", docIds: ["a", "b", "c"], maxChars: 1500 },
    db,
  );
  assert.equal(res.truncated, true);
  assert.ok(res.documents.length >= 1);
  assert.equal(res.requested, 3);
  assert.equal(res.documents.length + res.omittedIds.length, 3);
});
