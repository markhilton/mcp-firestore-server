import { test } from "node:test";
import assert from "node:assert/strict";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  DECODE_MODES,
  decodeDocumentData,
  decodeQueryValue,
} from "../../src/helpers/typed-values.js";

const { CREATE, MERGE, UPDATE } = DECODE_MODES;

function assertTimestamp(value, seconds, nanoseconds) {
  assert.ok(
    value instanceof Timestamp,
    `expected Timestamp, got ${JSON.stringify(value)}`,
  );
  assert.equal(value.seconds, seconds);
  assert.equal(value.nanoseconds, nanoseconds);
}

test("typed-values: {_seconds,_nanoseconds} decodes to a Timestamp", () => {
  const out = decodeDocumentData(
    { resolvedAt: { _seconds: 1791681467, _nanoseconds: 5 } },
    CREATE,
  );
  assertTimestamp(out.resolvedAt, 1791681467, 5);
});

test("typed-values: read shape round-trips (Timestamp JSON -> Timestamp)", () => {
  const original = new Timestamp(1791681467, 123456789);
  const wire = JSON.parse(JSON.stringify({ t: original }));
  const out = decodeDocumentData(wire, CREATE);
  assert.ok(out.t.isEqual(original));
});

test("typed-values: $timestamp ISO-8601 decodes with offset and nanos", () => {
  const out = decodeDocumentData(
    {
      a: { $timestamp: "2026-10-11T01:17:00Z" },
      b: { $timestamp: "2026-10-10T21:17:00-04:00" },
      c: { $timestamp: "2026-10-11T01:17:00.123456789Z" },
      d: { $timestamp: "2026-10-11" },
    },
    CREATE,
  );
  const s = Date.UTC(2026, 9, 11, 1, 17) / 1000;
  assertTimestamp(out.a, s, 0);
  assertTimestamp(out.b, s, 0);
  assertTimestamp(out.c, s, 123456789);
  assertTimestamp(out.d, Date.UTC(2026, 9, 11) / 1000, 0);
});

test("typed-values: bare ISO strings are left as strings", () => {
  const out = decodeDocumentData({ when: "2026-10-11T01:17:00Z" }, CREATE);
  assert.equal(out.when, "2026-10-11T01:17:00Z");
});

test("typed-values: recurses into nested maps and arrays", () => {
  const out = decodeDocumentData(
    {
      meta: { audit: { at: { $timestamp: "2026-10-11T01:17:00Z" } } },
      history: [{ _seconds: 1, _nanoseconds: 0 }, { at: { $timestamp: "2026-01-01" } }],
      plain: { keep: "me", n: 1 },
    },
    CREATE,
  );
  assert.ok(out.meta.audit.at instanceof Timestamp);
  assertTimestamp(out.history[0], 1, 0);
  assert.ok(out.history[1].at instanceof Timestamp);
  assert.deepEqual(out.plain, { keep: "me", n: 1 });
});

test("typed-values: sentinels decode to FieldValues", () => {
  const out = decodeDocumentData(
    {
      updatedAt: { $serverTimestamp: true },
      views: { $increment: 2 },
      stale: { $delete: true },
      nested: { gone: { $delete: true } },
    },
    MERGE,
  );
  assert.ok(out.updatedAt.isEqual(FieldValue.serverTimestamp()));
  assert.ok(out.views.isEqual(FieldValue.increment(2)));
  assert.ok(out.stale.isEqual(FieldValue.delete()));
  assert.ok(out.nested.gone.isEqual(FieldValue.delete()));
});

test("typed-values: $delete is rejected when creating", () => {
  assert.throws(
    () => decodeDocumentData({ x: { $delete: true } }, CREATE),
    /\$delete is only valid/,
  );
});

test("typed-values: $delete in a nested map needs merge (update mode rejects)", () => {
  const top = decodeDocumentData({ x: { $delete: true } }, UPDATE);
  assert.ok(top.x.isEqual(FieldValue.delete()));
  assert.throws(
    () => decodeDocumentData({ m: { x: { $delete: true } } }, UPDATE),
    /requires merge:true/,
  );
});

test("typed-values: sentinels inside arrays are rejected", () => {
  for (const sentinel of [
    { $delete: true },
    { $serverTimestamp: true },
    { $increment: 1 },
  ]) {
    assert.throws(
      () => decodeDocumentData({ arr: [sentinel] }, MERGE),
      /inside an array/,
    );
  }
});

test("typed-values: invalid inputs throw clear errors with the field path", () => {
  const cases = [
    [{ a: { $timestamp: "not a date" } }, /a".*ISO-8601/],
    [{ a: { $timestamp: "2026-10-11T01:17:00" } }, /explicit timezone/],
    [{ a: { $timestamp: "2026-13-45T00:00:00Z" } }, /not a valid date/],
    [{ a: { $timestamp: 1791681467 } }, /must be an ISO-8601 string/],
    [{ a: { _seconds: "1", _nanoseconds: 0 } }, /_seconds must be an integer/],
    [{ a: { _seconds: 1, _nanoseconds: 1e9 } }, /_nanoseconds must be/],
    [{ a: { $serverTimestamp: false } }, /\$serverTimestamp must be true/],
    [{ a: { $delete: "yes" } }, /\$delete must be true/],
    [{ a: { $increment: "1" } }, /\$increment must be a finite number/],
    [{ a: { b: { $timestamp: "2026-01-01", extra: 1 } } }, /a\.b".*must be the only key/],
  ];
  for (const [input, re] of cases) {
    assert.throws(() => decodeDocumentData(input, MERGE), re, JSON.stringify(input));
  }
});

test("typed-values: objects with extra keys beside _seconds are left alone", () => {
  const v = { _seconds: 1, _nanoseconds: 0, label: "x" };
  assert.deepEqual(decodeDocumentData({ v }, CREATE).v, v);
});

test("typed-values: does not mutate the input", () => {
  const input = { a: { $timestamp: "2026-01-01" } };
  decodeDocumentData(input, CREATE);
  assert.deepEqual(input, { a: { $timestamp: "2026-01-01" } });
});

test("decodeQueryValue: decodes timestamps (incl. arrays) and rejects sentinels", () => {
  assertTimestamp(decodeQueryValue({ _seconds: 10, _nanoseconds: 0 }), 10, 0);
  const list = decodeQueryValue([{ $timestamp: "2026-01-01" }, "x"]);
  assert.ok(list[0] instanceof Timestamp);
  assert.equal(list[1], "x");
  assert.equal(decodeQueryValue(30), 30);
  assert.throws(
    () => decodeQueryValue({ $serverTimestamp: true }, "f"),
    /cannot be used in a query/,
  );
  assert.throws(
    () => decodeQueryValue({ $delete: true }, "f"),
    /cannot be used in a query/,
  );
});
