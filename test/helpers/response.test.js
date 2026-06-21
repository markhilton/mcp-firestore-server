import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResponse, buildErrorResponse } from "../../src/helpers/response.js";

test("buildResponse: wraps data as pretty-printed JSON text content", () => {
  const data = { count: 2, documents: [{ id: "a" }] };
  const res = buildResponse(data);

  assert.equal(res.content.length, 1);
  assert.equal(res.content[0].type, "text");
  assert.deepEqual(JSON.parse(res.content[0].text), data);
  assert.equal(res.isError, undefined);
});

test("buildErrorResponse: sets isError and includes message + stack", () => {
  const err = new Error("boom");
  const res = buildErrorResponse(err);

  assert.equal(res.isError, true);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.error, "boom");
  assert.equal(typeof parsed.stack, "string");
  assert.match(parsed.stack, /boom/);
});
