import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTION_PROPERTY,
  PAGINATION_PROPERTIES,
  WHERE_CLAUSES_PROPERTY,
} from "../../src/helpers/schema.js";
import { WHERE_OPERATORS } from "../../src/helpers/query.js";

test("COLLECTION_PROPERTY is a described string", () => {
  assert.equal(COLLECTION_PROPERTY.type, "string");
  assert.equal(typeof COLLECTION_PROPERTY.description, "string");
});

test("PAGINATION_PROPERTIES exposes limit/orderBy/orderDirection/startAfter", () => {
  assert.deepEqual(Object.keys(PAGINATION_PROPERTIES).sort(), [
    "limit",
    "orderBy",
    "orderDirection",
    "startAfter",
  ]);
  assert.equal(PAGINATION_PROPERTIES.limit.default, 10);
  assert.deepEqual(PAGINATION_PROPERTIES.orderDirection.enum, ["asc", "desc"]);
});

test("WHERE_CLAUSES_PROPERTY constrains the operator slot to WHERE_OPERATORS", () => {
  assert.equal(WHERE_CLAUSES_PROPERTY.type, "array");
  const tuple = WHERE_CLAUSES_PROPERTY.items;
  assert.equal(tuple.minItems, 3);
  assert.equal(tuple.maxItems, 3);
  // Draft 2020-12 tuple validation: positional schemas live in `prefixItems`,
  // not the legacy array-form `items` (which would 400 the whole tool list).
  assert.equal(tuple.items, undefined, "must not use legacy array-form `items`");
  assert.deepEqual(tuple.prefixItems[1].enum, WHERE_OPERATORS);
});
