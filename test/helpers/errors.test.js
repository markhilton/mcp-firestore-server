import { test } from "node:test";
import assert from "node:assert/strict";
import { mapError, isAuthError } from "../../src/helpers/errors.js";
import { buildErrorResponse } from "../../src/helpers/response.js";
import { checkUnknownArgs } from "../../src/helpers/args.js";

const INDEX_MSG =
  "9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=abc";

test("mapError: missing index extracts the URL", () => {
  const m = mapError(new Error(INDEX_MSG));
  assert.equal(m.code, "FAILED_PRECONDITION_INDEX");
  assert.match(
    m.indexUrl,
    /^https:\/\/console\.firebase\.google\.com\/.*create_composite=abc$/,
  );
  assert.match(m.hint, /client-side/);
});

test("mapError: auth patterns map to AUTH_EXPIRED", () => {
  for (const msg of [
    "invalid_grant: Bad Request",
    "Getting metadata from plugin failed with error: reauth related error (invalid_rapt)",
    "Could not load the default credentials.",
    "16 UNAUTHENTICATED: request had invalid auth",
  ]) {
    const m = mapError(new Error(msg));
    assert.equal(m.code, "AUTH_EXPIRED", msg);
    assert.match(m.hint, /gcloud auth application-default login/);
    assert.ok(isAuthError(new Error(msg)));
  }
});

test("mapError: descending key scan and unrelated errors", () => {
  const m = mapError(new Error("Firestore does not support descending key scans"));
  assert.match(m.hint, /ascending document-ID/);
  assert.equal(mapError(new Error("boom")), null);
});

test("buildErrorResponse: merges mapped fields, keeps error, no stack", () => {
  delete process.env.MCP_FIRESTORE_DEBUG;
  delete process.env.DEBUG;
  const parsed = JSON.parse(buildErrorResponse(new Error(INDEX_MSG)).content[0].text);
  assert.equal(parsed.error, INDEX_MSG);
  assert.equal(parsed.code, "FAILED_PRECONDITION_INDEX");
  assert.equal(parsed.stack, undefined);
});

test("checkUnknownArgs: alias suggestion and valid list", () => {
  const schema = { properties: { collection: {}, docId: {}, target: {} } };
  const msg = checkUnknownArgs(
    "get_document",
    { documentId: "x", collection: "c" },
    schema,
  );
  assert.equal(
    msg,
    'Unknown argument "documentId" for get_document. Did you mean "docId"? Valid arguments: collection, docId, target.',
  );
  assert.match(
    checkUnknownArgs("get_document", { path: "c" }, schema),
    /Did you mean "collection"/,
  );
});

test("checkUnknownArgs: edit-distance fallback, none for valid or far keys", () => {
  const schema = { properties: { collection: {}, limit: {}, target: {} } };
  assert.match(checkUnknownArgs("t", { limt: 1 }, schema), /Did you mean "limit"/);
  assert.doesNotMatch(checkUnknownArgs("t", { zzzzzzzz: 1 }, schema), /Did you mean/);
  assert.equal(checkUnknownArgs("t", { limit: 1, target: "x" }, schema), null);
});
