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

test("buildErrorResponse: sets isError and omits stack by default", () => {
  const prevDebug = process.env.MCP_FIRESTORE_DEBUG;
  const prevDebugAlt = process.env.DEBUG;
  delete process.env.MCP_FIRESTORE_DEBUG;
  delete process.env.DEBUG;
  try {
    const res = buildErrorResponse(new Error("boom"));

    assert.equal(res.isError, true);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.error, "boom");
    assert.equal(parsed.stack, undefined);
  } finally {
    if (prevDebug !== undefined) process.env.MCP_FIRESTORE_DEBUG = prevDebug;
    if (prevDebugAlt !== undefined) process.env.DEBUG = prevDebugAlt;
  }
});

test("buildErrorResponse: includes stack when MCP_FIRESTORE_DEBUG is set", () => {
  const prev = process.env.MCP_FIRESTORE_DEBUG;
  process.env.MCP_FIRESTORE_DEBUG = "1";
  try {
    const parsed = JSON.parse(buildErrorResponse(new Error("boom")).content[0].text);
    assert.equal(typeof parsed.stack, "string");
    assert.match(parsed.stack, /boom/);
  } finally {
    if (prev === undefined) delete process.env.MCP_FIRESTORE_DEBUG;
    else process.env.MCP_FIRESTORE_DEBUG = prev;
  }
});
