import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { getToolDefinitions } from "../../src/tools/index.js";
import {
  findSchemaViolations,
  checkToolDefinition,
  SEVERITY,
} from "../../scripts/lib/schema-compliance.js";

const defs = getToolDefinitions(["emulator", "production"], "emulator");

test("every tool inputSchema compiles under JSON Schema Draft 2020-12 (Ajv)", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const def of defs) {
    assert.doesNotThrow(
      () => ajv.compile(def.inputSchema),
      `${def.name} inputSchema must be valid Draft 2020-12 (would 400 with tools.N.custom.input_schema otherwise)`,
    );
  }
});

test("no tool inputSchema has a hard compliance violation", () => {
  for (const def of defs) {
    const { hasErrors, violations } = checkToolDefinition(def);
    const errors = violations.filter(v => v.severity === SEVERITY.ERROR);
    assert.equal(
      hasErrors,
      false,
      `${def.name} has schema violations:\n${errors.map(e => `  ${e.path} (${e.keyword}): ${e.message}`).join("\n")}`,
    );
  }
});

test("every root inputSchema is an object type (Anthropic requirement)", () => {
  for (const def of defs) {
    assert.equal(
      def.inputSchema.type,
      "object",
      `${def.name} root type must be "object"`,
    );
  }
});

// Guard the scanner itself so it cannot silently stop catching the original bug.
test("scanner flags the legacy array-form `items` (the prefixItems regression)", () => {
  const legacy = {
    type: "object",
    properties: {
      where: {
        type: "array",
        items: { type: "array", items: [{ type: "string" }, { type: "string" }] },
      },
    },
  };
  const violations = findSchemaViolations(legacy);
  const itemsErr = violations.find(
    v => v.keyword === "items" && v.severity === SEVERITY.ERROR,
  );
  assert.ok(itemsErr, "scanner must flag array-form `items` as an error");
  assert.match(itemsErr.fix, /prefixItems/);
});

test("scanner flags boolean exclusiveMinimum and OpenAPI nullable", () => {
  const v = findSchemaViolations({
    type: "object",
    properties: {
      n: { type: "number", exclusiveMinimum: true, minimum: 0 },
      s: { type: "string", nullable: true },
    },
  });
  assert.ok(
    v.find(x => x.keyword === "exclusiveMinimum" && x.severity === SEVERITY.ERROR),
  );
  assert.ok(v.find(x => x.keyword === "nullable" && x.severity === SEVERITY.WARN));
});
