import { test } from "node:test";
import assert from "node:assert/strict";
import { getToolDefinitions, getHandler } from "../../src/tools/index.js";

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
