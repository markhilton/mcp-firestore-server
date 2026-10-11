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
  const dbs = {}; // stable db per target, as the real getDb returns
  return {
    calls,
    toolDefinitions,
    getHandler:
      () =>
      async (...a) => {
        calls.handler++;
        return handler(calls.handler, ...a);
      },
    getDb: t => ({ db: (dbs[t || "emulator"] ||= {}), target: t || "emulator" }),
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

test("handleToolCall: concurrent auth failures reset the target once; both retry", async () => {
  const db = {};
  let resets = 0;
  const seen = new Map();
  const deps = makeDeps(
    (n, args) => {
      const c = (seen.get(args.docId) || 0) + 1;
      seen.set(args.docId, c);
      if (c === 1) throw new Error("invalid_grant");
      return { ok: args.docId };
    },
    {
      getDb: t => ({ db, target: t || "emulator" }),
      resetTarget: async () => {
        resets++;
        await new Promise(r => setTimeout(r, 20));
      },
    },
  );
  const [r1, r2] = await Promise.all([
    handleToolCall("get_document", { collection: "c", docId: "1" }, deps),
    handleToolCall("get_document", { collection: "c", docId: "2" }, deps),
  ]);
  assert.equal(resets, 1);
  assert.equal(r1.isError, undefined);
  assert.equal(r2.isError, undefined);
  assert.equal(deps.calls.handler, 4);
});

test("handleToolCall: skips reset when the target db was already replaced", async () => {
  let current = { gen: 1 };
  let resets = 0;
  const deps = makeDeps(
    n => {
      if (n === 1) {
        current = { gen: 2 }; // another call re-created the app meanwhile
        throw new Error("invalid_grant");
      }
      return { ok: true };
    },
    {
      getDb: t => ({ db: current, target: t || "emulator" }),
      resetTarget: async () => resets++,
    },
  );
  const res = await handleToolCall("get_document", { collection: "c", docId: "d" }, deps);
  assert.equal(res.isError, undefined);
  assert.equal(resets, 0);
  assert.equal(deps.calls.handler, 2);
});

test("readonly=production rejects a write with no target when default is production", async () => {
  process.env.MCP_FIRESTORE_READONLY = "production";
  const deps = makeDeps(() => ({ ok: 1 }), {
    getDb: t => ({ db: {}, target: t || "production" }),
  });
  const bad = await handleToolCall(
    "update_document",
    { collection: "c", docId: "d", data: {} },
    deps,
  );
  assert.match(parse(bad).error, /production/);
  assert.equal(deps.calls.handler, 0);
});

test("readonly=production allows a write with no target when default is emulator", async () => {
  process.env.MCP_FIRESTORE_READONLY = "production";
  const deps = makeDeps(() => ({ ok: 1 }));
  const good = await handleToolCall(
    "update_document",
    { collection: "c", docId: "d", data: {} },
    deps,
  );
  assert.equal(good.isError, undefined);
  assert.equal(deps.calls.handler, 1);
});

test("handleToolCall: stderr logs only the redacted message unless MCP_FIRESTORE_DEBUG", async () => {
  const original = console.error;
  const prevDebug = process.env.MCP_FIRESTORE_DEBUG;
  const logged = [];
  console.error = (...a) => logged.push(a);
  try {
    delete process.env.MCP_FIRESTORE_DEBUG;
    const deps = makeDeps(() => {
      throw new Error("boom at /Users/me/secret/key.json");
    });
    await handleToolCall("list_collections", {}, deps);
    assert.deepEqual(logged, [["Tool execution error:", "boom at [redacted path]"]]);

    logged.length = 0;
    process.env.MCP_FIRESTORE_DEBUG = "1";
    await handleToolCall("list_collections", {}, deps);
    assert.ok(logged[0][1] instanceof Error);
  } finally {
    console.error = original;
    if (prevDebug === undefined) delete process.env.MCP_FIRESTORE_DEBUG;
    else process.env.MCP_FIRESTORE_DEBUG = prevDebug;
  }
});
