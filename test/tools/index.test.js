import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getToolDefinitions,
  getHandler,
  getReadOnlyMode,
  getReadOnlyWarning,
} from "../../src/tools/index.js";

const EXPECTED_TOOLS = [
  "query_collection",
  "get_document",
  "query_with_where",
  "list_collections",
  "create_document",
  "update_document",
  "delete_document",
  "count_documents",
  "batch_get",
];

test("getToolDefinitions: returns all registered tools", () => {
  const defs = getToolDefinitions(["emulator", "production"], "emulator");
  assert.deepEqual(defs.map(d => d.name).sort(), [...EXPECTED_TOOLS].sort());
});

test("getToolDefinitions: injects a target enum into every tool schema", () => {
  const targets = ["emulator", "production"];
  const defs = getToolDefinitions(targets, "production");
  for (const def of defs) {
    const target = def.inputSchema.properties.target;
    assert.ok(target, `${def.name} should have a target property`);
    assert.deepEqual(target.enum, targets);
    assert.match(target.description, /production/);
  }
});

test("getToolDefinitions: does not mutate the original definitions", () => {
  getToolDefinitions(["emulator"], "emulator");
  // A second call with different targets must not carry over state.
  const defs = getToolDefinitions(["production"], "production");
  assert.deepEqual(defs[0].inputSchema.properties.target.enum, ["production"]);
});

test("getHandler: resolves a known tool to a function", () => {
  assert.equal(typeof getHandler("get_document"), "function");
});

test("getHandler: returns null for an unknown tool", () => {
  assert.equal(getHandler("does_not_exist"), null);
});

test("getToolDefinitions: every tool carries MCP annotations", () => {
  const defs = Object.fromEntries(
    getToolDefinitions(["emulator"], "emulator").map(d => [d.name, d.annotations]),
  );
  for (const name of EXPECTED_TOOLS) assert.ok(defs[name]?.title, name);
  for (const name of [
    "query_collection",
    "get_document",
    "query_with_where",
    "list_collections",
    "count_documents",
    "batch_get",
  ]) {
    assert.equal(defs[name].readOnlyHint, true, name);
  }
  assert.equal(defs.create_document.readOnlyHint, false);
  assert.equal(defs.create_document.destructiveHint, true);
  assert.equal(defs.update_document.destructiveHint, true);
  assert.equal(defs.update_document.idempotentHint, false);
  assert.equal(defs.delete_document.destructiveHint, true);
  assert.equal(defs.delete_document.idempotentHint, true);
});

function withReadOnly(value, fn) {
  const prev = process.env.MCP_FIRESTORE_READONLY;
  if (value === undefined) delete process.env.MCP_FIRESTORE_READONLY;
  else process.env.MCP_FIRESTORE_READONLY = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MCP_FIRESTORE_READONLY;
    else process.env.MCP_FIRESTORE_READONLY = prev;
  }
}

test("getReadOnlyMode: off values leave writes enabled", () => {
  for (const v of [
    undefined,
    "",
    "  ",
    "0",
    "false",
    "FALSE",
    "off",
    "Off",
    "no",
    " no ",
  ]) {
    withReadOnly(v, () => {
      assert.equal(getReadOnlyMode(), null, String(v));
      assert.equal(getReadOnlyWarning(), null, String(v));
    });
  }
});

test("getReadOnlyMode: recognised values", () => {
  for (const v of ["1", "true", "TRUE", "all", " All "]) {
    withReadOnly(v, () => {
      assert.equal(getReadOnlyMode(), "all", v);
      assert.equal(getReadOnlyWarning(), null, v);
    });
  }
  withReadOnly(" Production ", () => {
    assert.equal(getReadOnlyMode(), "production");
    assert.equal(getReadOnlyWarning(), null);
  });
});

test("getReadOnlyMode: unknown values fail closed to all and warn", () => {
  for (const v of ["yes", "on", "prod", "readonly", "2", "enabled", "y"]) {
    withReadOnly(v, () => {
      assert.equal(getReadOnlyMode(), "all", v);
      const warning = getReadOnlyWarning();
      assert.match(warning, /unrecognised MCP_FIRESTORE_READONLY/);
      assert.ok(warning.includes(v));
      assert.ok(!warning.includes("\n"));
    });
  }
});

test("getReadOnlyMode: unknown value hides write tools", () => {
  withReadOnly("yes", () => {
    const names = getToolDefinitions(["emulator"], "emulator").map(d => d.name);
    assert.ok(!names.includes("create_document"));
  });
});

test("getHandler: prototype-chain names are not tools", () => {
  for (const n of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.equal(getHandler(n), null, n);
  }
  assert.equal(typeof getHandler("get_document"), "function");
});

test("getToolDefinitions: target description names the project when given", () => {
  const withProject = getToolDefinitions(["emulator"], "emulator", "my-project");
  assert.equal(
    withProject[0].inputSchema.properties.target.description,
    'Firestore target endpoint (default: "emulator"). Project ID (data): "my-project".',
  );
  const withSource = getToolDefinitions(
    ["emulator"],
    "emulator",
    "my-project",
    ".firebaserc",
  );
  assert.equal(
    withSource[0].inputSchema.properties.target.description,
    'Firestore target endpoint (default: "emulator"). Project ID (data, from .firebaserc): "my-project".',
  );
  const without = getToolDefinitions(["emulator"], "emulator");
  assert.equal(
    without[0].inputSchema.properties.target.description,
    'Firestore target endpoint (default: "emulator").',
  );
});
