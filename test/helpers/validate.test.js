import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCollectionPath,
  assertNonEmptyData,
  assertBatchSize,
  DEFAULT_MAX_BATCH,
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
