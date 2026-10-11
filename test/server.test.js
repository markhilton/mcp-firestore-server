import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall } from "../src/server.js";
import { getToolDefinitions } from "../src/tools/index.js";

const toolDefinitions = getToolDefinitions(["emulator", "production"], "emulator");
const parse = res => JSON.parse(res.content[0].text);

let prev;
beforeEach(() => {
  prev = process.env.MCP_FIRESTORE_READONLY;
  delete process.env.MCP_FIRESTORE_READONLY;
});
afterEach(() => {
  if (prev === undefined) delete process.env.MCP_FIRESTORE_READONLY;
  else process.env.MCP_FIRESTORE_READONLY = prev;
});

function makeDeps(handler, extra = {}) {
  const calls = { reset: [], handler: 0 };
  return {
    calls,
    toolDefinitions,
    getHandler:
      () =>
      async (...a) => {
        calls.handler++;
        return handler(calls.handler, ...a);
      },
    getDb: t => ({ db: {}, target: t || "emulator" }),
    resetTarget: async t => calls.reset.push(t),
    ...extra,
  };
}

test("handleToolCall: auth error resets that target and retries once", async () => {
  const deps = makeDeps(n => {
    if (n === 1) throw new Error("invalid_grant");
    return { ok: true };
  });
  const res = await handleToolCall(
    "get_document",
    { collection: "c", docId: "d", target: "production" },
    deps,
  );
  assert.equal(res.isError, undefined);
  assert.deepEqual(deps.calls.reset, ["production"]);
  assert.equal(deps.calls.handler, 2);
  assert.equal(parse(res).target, "production");
});

test("handleToolCall: no second retry; returns AUTH_EXPIRED", async () => {
  const deps = makeDeps(() => {
    throw new Error("invalid_grant");
  });
  const res = await handleToolCall("get_document", { collection: "c", docId: "d" }, deps);
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "AUTH_EXPIRED");
  assert.equal(deps.calls.handler, 2);
  assert.deepEqual(deps.calls.reset, ["emulator"]);
});

test("handleToolCall: non-auth error is not retried", async () => {
  const deps = makeDeps(() => {
    throw new Error("nope");
  });
  const res = await handleToolCall("get_document", { collection: "c", docId: "d" }, deps);
  assert.equal(parse(res).error, "nope");
  assert.equal(deps.calls.handler, 1);
  assert.equal(deps.calls.reset.length, 0);
});

test("handleToolCall: unknown argument is rejected before the handler", async () => {
  const deps = makeDeps(() => ({}));
  const res = await handleToolCall(
    "get_document",
    { collection: "c", documentId: "d" },
    deps,
  );
  assert.equal(res.isError, true);
  assert.match(
    parse(res).error,
    /Unknown argument "documentId" for get_document\. Did you mean "docId"\?/,
  );
  assert.equal(deps.calls.handler, 0);
});

test("readonly=true hides and rejects write tools", async () => {
  process.env.MCP_FIRESTORE_READONLY = "true";
  const names = getToolDefinitions(["emulator"], "emulator").map(d => d.name);
  assert.ok(!names.includes("create_document") && !names.includes("delete_document"));
  assert.ok(names.includes("get_document"));
  const deps = makeDeps(() => ({}));
  const res = await handleToolCall(
    "delete_document",
    { collection: "c", docId: "d" },
    deps,
  );
  assert.match(parse(res).error, /read-only mode/);
  assert.equal(deps.calls.handler, 0);
});

test("readonly=production rejects production writes only", async () => {
  process.env.MCP_FIRESTORE_READONLY = "production";
  const names = getToolDefinitions(["emulator"], "emulator").map(d => d.name);
  assert.ok(names.includes("update_document"));
  const deps = makeDeps(() => ({ ok: 1 }));
  const bad = await handleToolCall(
    "update_document",
    { collection: "c", docId: "d", data: {}, target: "production" },
    deps,
  );
  assert.match(parse(bad).error, /production/);
  assert.equal(deps.calls.handler, 0);
  const good = await handleToolCall(
    "update_document",
    { collection: "c", docId: "d", data: {}, target: "emulator" },
    deps,
  );
  assert.equal(good.isError, undefined);
});
