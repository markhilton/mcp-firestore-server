import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCollectionPath,
  validateDocId,
  validateDocumentPath,
  assertNonEmptyData,
  assertBatchSize,
  DEFAULT_MAX_BATCH,
  resolveLimit,
} from "../../src/helpers/validate.js";

test("validateCollectionPath: accepts simple and nested collection paths", () => {
  assert.doesNotThrow(() => validateCollectionPath("users"));
  assert.doesNotThrow(() => validateCollectionPath("users/uid/posts"));
});

test("validateCollectionPath: rejects blank, sliced, or document paths", () => {
  assert.throws(() => validateCollectionPath(""), /non-empty/);
  assert.throws(() => validateCollectionPath("   "), /non-empty/);
  assert.throws(() => validateCollectionPath(42), /non-empty/);
  assert.throws(() => validateCollectionPath("/users"), /slash/);
  assert.throws(() => validateCollectionPath("users/"), /slash/);
  assert.throws(() => validateCollectionPath("users//posts"), /empty segments/);
  // even segment count => points at a document, not a collection
  assert.throws(() => validateCollectionPath("users/uid"), /odd number of segments/);
});

test("assertNonEmptyData: requires a non-empty plain object", () => {
  assert.doesNotThrow(() => assertNonEmptyData({ a: 1 }));
  assert.throws(() => assertNonEmptyData(null), /JSON object/);
  assert.throws(() => assertNonEmptyData(undefined), /JSON object/);
  assert.throws(() => assertNonEmptyData([1, 2]), /JSON object/);
  assert.throws(() => assertNonEmptyData("x"), /JSON object/);
  assert.throws(() => assertNonEmptyData({}), /at least one field/);
});

test("assertBatchSize: requires a non-empty array within the limit", () => {
  assert.doesNotThrow(() => assertBatchSize(["a", "b"]));
  assert.throws(() => assertBatchSize([]), /non-empty array/);
  assert.throws(() => assertBatchSize("a"), /non-empty array/);
  const tooMany = Array.from({ length: DEFAULT_MAX_BATCH + 1 }, (_, i) => `id-${i}`);
  assert.throws(() => assertBatchSize(tooMany), /maximum is/);
});

test("resolveLimit: default, valid values and rejections", () => {
  assert.equal(resolveLimit(undefined), 10);
  assert.equal(resolveLimit(null), 10);
  assert.equal(resolveLimit(1), 1);
  assert.equal(resolveLimit("25"), 25);
  assert.equal(resolveLimit(1000), 1000);
  for (const bad of [0, -1, 1001, 1.5, "abc", NaN, 1e9, {}]) {
    assert.throws(() => resolveLimit(bad), /between 1 and 1000/, String(bad));
  }
});

test("validateDocId: accepts ordinary ids", () => {
  for (const id of ["a", "user-1", "a.b", "..x", "__x", "x__", "ünï", "a b"]) {
    assert.doesNotThrow(() => validateDocId(id), id);
  }
});

test("validateDocId: rejects non-strings and empty", () => {
  for (const id of ["", undefined, null, 5, {}, []]) {
    assert.throws(() => validateDocId(id), /non-empty string/, String(id));
  }
});

test("validateDocId: slash error tells the caller to use collection", () => {
  assert.throws(
    () => validateDocId("u1/posts/p1"),
    /Put the parent path in `collection`.*users\/u1\/posts.*p1/,
  );
});

test("validateDocId: rejects . .. and __name__", () => {
  assert.throws(() => validateDocId("."), /reserved/);
  assert.throws(() => validateDocId(".."), /reserved/);
  assert.throws(() => validateDocId("__id__"), /reserved/);
});

test("validateDocId: caps at 1500 bytes (bytes, not characters) and uses the label", () => {
  assert.doesNotThrow(() => validateDocId("a".repeat(1500)));
  assert.throws(() => validateDocId("a".repeat(1501)), /1500 bytes/);
  assert.throws(() => validateDocId("é".repeat(751)), /1500 bytes/);
  assert.throws(() => validateDocId("", "docIds[3]"), /docIds\[3\]/);
});

test("validateDocumentPath: accepts even-segment paths", () => {
  assert.doesNotThrow(() => validateDocumentPath("users/u1"));
  assert.doesNotThrow(() => validateDocumentPath("users/u1/posts/p1"));
});

test("validateDocumentPath: rejects odd, blank, sliced, empty-segment and reserved paths", () => {
  assert.throws(() => validateDocumentPath("users"), /even number/);
  assert.throws(() => validateDocumentPath("users/u1/posts"), /even number/);
  assert.throws(() => validateDocumentPath(""), /non-empty/);
  assert.throws(() => validateDocumentPath(7), /non-empty/);
  assert.throws(() => validateDocumentPath("/users/u1"), /slash/);
  assert.throws(() => validateDocumentPath("users//u1"), /empty segments/);
  assert.throws(() => validateDocumentPath("users/.."), /reserved/);
  assert.throws(() => validateDocumentPath("users/__a__"), /reserved/);
  assert.throws(() => validateDocumentPath(`users/${"a".repeat(1501)}`), /1500 bytes/);
});
