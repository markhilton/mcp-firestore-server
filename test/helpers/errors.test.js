import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapError,
  isAuthError,
  redactMessage,
  InputValidationError,
  debugEnabled,
} from "../../src/helpers/errors.js";
import { buildErrorResponse } from "../../src/helpers/response.js";
import { validateCollectionPath } from "../../src/helpers/validate.js";
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

test("isAuthError: real google-auth shapes classify", () => {
  const real =
    '16 UNAUTHENTICATED: Getting metadata from plugin failed with error: {"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)"}';
  assert.ok(isAuthError(new Error(real)));
  assert.ok(isAuthError(Object.assign(new Error("x"), { code: 16 })));
  assert.ok(isAuthError(Object.assign(new Error("x"), { code: "UNAUTHENTICATED" })));
  assert.ok(
    isAuthError(
      Object.assign(new Error("x"), { response: { data: { error: "invalid_grant" } } }),
    ),
  );
});

test("isAuthError: caller-echoed text is not auth", () => {
  assert.equal(
    isAuthError(new Error('Invalid collection path "reauth/x": empty segments.')),
    false,
  );
  assert.equal(isAuthError(new Error('Unknown argument "invalid_grant" for t.')), false);
  assert.equal(mapError(new Error('Invalid collection path "reauth"')), null);
});

test("mapError: missing credential file is AUTH_EXPIRED", () => {
  for (const msg of [
    "The file at /Users/me/key.json does not exist, or it is not a file.",
    "Unable to read the credential file specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable.",
  ]) {
    assert.equal(mapError(new Error(msg)).code, "AUTH_EXPIRED", msg);
  }
});

test("buildErrorResponse: redacts paths, accounts, tokens, keys unless debug", () => {
  delete process.env.MCP_FIRESTORE_DEBUG;
  const msg =
    "The file at /Users/me/secrets/key.json does not exist; C:\\Users\\me\\key.json; " +
    "svc@proj.iam.gserviceaccount.com; ya29.a0AbCdEf-123; Bearer abc.def.ghi; " +
    "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----"; // secret-scan:allow — fake key for redaction test
  const parsed = JSON.parse(buildErrorResponse(new Error(msg)).content[0].text);
  for (const leak of [
    "/Users/me",
    "C:\\Users",
    "iam.gserviceaccount",
    "ya29",
    "abc.def.ghi",
    "MIIEvQ",
  ]) {
    assert.ok(!parsed.error.includes(leak), leak);
  }
  assert.equal(parsed.code, "AUTH_EXPIRED");
  assert.match(parsed.hint, /gcloud auth application-default login/);
  process.env.MCP_FIRESTORE_DEBUG = "1";
  try {
    const dbg = JSON.parse(buildErrorResponse(new Error(msg)).content[0].text);
    assert.ok(dbg.error.includes("/Users/me/secrets/key.json"));
  } finally {
    delete process.env.MCP_FIRESTORE_DEBUG;
  }
});

test("checkUnknownArgs: truncates long keys, skips suggestions, caps count", () => {
  const schema = { properties: { collection: {}, docId: {} } };
  const long = "x".repeat(500);
  const msg = checkUnknownArgs("t", { [long]: 1 }, schema);
  assert.ok(!msg.includes("x".repeat(65)));
  assert.ok(!msg.includes("Did you mean"));
  const many = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`zzzzzzzz${i}`, 1]),
  );
  const m2 = checkUnknownArgs("t", many, schema);
  assert.equal((m2.match(/Unknown argument/g) ?? []).length, 5);
  assert.match(m2, /and 4 more/);
});

test("redactMessage: extra path forms", () => {
  for (const [input, leak] of [
    ["failed to read ~/.config/gcloud/adc.json", ".config"],
    ["see ./keys/sa.json now", "keys"],
    ["see ../keys/sa.json now", "keys"],
    ["path `/etc/secrets/key.json` bad", "secrets"],
    ["a,/etc/secrets/key.json", "secrets"],
    ["open \\\\fileserver\\share\\key.json failed", "fileserver"],
    ["cannot open /k.json", "k.json"],
  ]) {
    const out = redactMessage(input);
    assert.ok(out.includes("[redacted path]"), input);
    assert.ok(!out.includes(leak), `${input} -> ${out}`);
  }
});

test("redactMessage: bare slashes and version-like segments survive", () => {
  assert.equal(redactMessage("use a / b or /v1 or 1/2"), "use a / b or /v1 or 1/2");
  assert.equal(
    redactMessage("https://console.firebase.google.com/v1/r/project/p?x=1"),
    "https://console.firebase.google.com/v1/r/project/p?x=1",
  );
});

test("redactMessage: emails, refresh tokens, API keys", () => {
  const key = "AIza" + "A".repeat(35); // secret-scan:allow fake key
  const out = redactMessage(
    `user jane.doe@example.com token 1//0gAbC-def_123 key ${key} sa svc@p.iam.gserviceaccount.com`,
  );
  assert.equal(
    out,
    "user [redacted email] token [redacted token] key [redacted key] sa [redacted account]",
  );
});

test("redactMessage: paths:false keeps paths but still redacts secrets", () => {
  const out = redactMessage('Invalid path "/users/abc" 1//0gAbC-def_123 a@b.co', {
    paths: false,
  });
  assert.equal(out, 'Invalid path "/users/abc" [redacted token] [redacted email]');
});

test("buildErrorResponse: validation error keeps caller path; plain Error is redacted", () => {
  delete process.env.MCP_FIRESTORE_DEBUG;
  const text = 'Invalid collection path "/users/abc": no leading or trailing slashes.';
  let thrown;
  try {
    validateCollectionPath("/users/abc");
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof InputValidationError);
  const kept = JSON.parse(buildErrorResponse(thrown).content[0].text).error;
  assert.equal(kept, text);
  const plain = JSON.parse(buildErrorResponse(new Error(text)).content[0].text);
  assert.ok(!plain.error.includes("/users/abc"));
  assert.match(plain.error, /\[redacted path\]/);
});

test("buildErrorResponse: validation error still redacts pasted secrets", () => {
  delete process.env.MCP_FIRESTORE_DEBUG;
  const err = new InputValidationError(
    'Invalid path "/x/y" with ya29.abc123 and a@b.com',
  );
  const parsed = JSON.parse(buildErrorResponse(err).content[0].text);
  assert.equal(
    parsed.error,
    'Invalid path "/x/y" with [redacted token] and [redacted email]',
  );
});

test("buildErrorResponse: AUTH_EXPIRED uses a static message outside debug", () => {
  delete process.env.MCP_FIRESTORE_DEBUG;
  const err = new Error(
    "Getting metadata from plugin failed: jane@example.com /Users/me/adc.json",
  );
  const parsed = JSON.parse(buildErrorResponse(err).content[0].text);
  assert.equal(parsed.error, "Authentication failed: credentials expired or missing.");
  assert.equal(parsed.code, "AUTH_EXPIRED");
  process.env.MCP_FIRESTORE_DEBUG = "1";
  try {
    assert.match(
      JSON.parse(buildErrorResponse(err).content[0].text).error,
      /jane@example\.com/,
    );
  } finally {
    delete process.env.MCP_FIRESTORE_DEBUG;
  }
});

test("debugEnabled: only MCP_FIRESTORE_DEBUG", () => {
  const prev = process.env.DEBUG;
  delete process.env.MCP_FIRESTORE_DEBUG;
  process.env.DEBUG = "*";
  try {
    assert.equal(debugEnabled(), false);
    process.env.MCP_FIRESTORE_DEBUG = "1";
    assert.equal(debugEnabled(), true);
  } finally {
    delete process.env.MCP_FIRESTORE_DEBUG;
    if (prev === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = prev;
  }
});
