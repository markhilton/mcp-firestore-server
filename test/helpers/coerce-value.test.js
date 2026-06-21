import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceValue } from "../../src/helpers/coerce-value.js";

test("coerceValue: non-strings pass through unchanged", () => {
  assert.equal(coerceValue(42), 42);
  assert.equal(coerceValue(true), true);
  assert.equal(coerceValue(null), null);
  const obj = { a: 1 };
  assert.equal(coerceValue(obj), obj);
});

test("coerceValue: booleans", () => {
  assert.equal(coerceValue("true"), true);
  assert.equal(coerceValue("false"), false);
});

test("coerceValue: null literal", () => {
  assert.equal(coerceValue("null"), null);
});

test("coerceValue: numbers (int, float, negative)", () => {
  assert.equal(coerceValue("0"), 0);
  assert.equal(coerceValue("42"), 42);
  assert.equal(coerceValue("-7"), -7);
  assert.equal(coerceValue("3.14"), 3.14);
  assert.equal(coerceValue("-0.5"), -0.5);
});

test("coerceValue: numeric-looking but not full match stays a string", () => {
  assert.equal(coerceValue("42px"), "42px");
  assert.equal(coerceValue("1.2.3"), "1.2.3");
});

test("coerceValue: JSON arrays and objects", () => {
  assert.deepEqual(coerceValue("[1, 2, 3]"), [1, 2, 3]);
  assert.deepEqual(coerceValue('["a", "b"]'), ["a", "b"]);
  assert.deepEqual(coerceValue('{"k": "v"}'), { k: "v" });
});

test("coerceValue: invalid JSON falls back to the original string", () => {
  assert.equal(coerceValue("[not json"), "[not json");
  assert.equal(coerceValue("{broken"), "{broken");
});

test("coerceValue: plain strings are returned as-is", () => {
  assert.equal(coerceValue("hello"), "hello");
  assert.equal(coerceValue(""), "");
});
