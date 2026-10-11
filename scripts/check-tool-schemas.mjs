#!/usr/bin/env node
/**
 * Tool-schema compliance gate.
 *
 * Validates every MCP tool's `inputSchema` against JSON Schema Draft 2020-12
 * (the dialect Anthropic / the MCP spec enforce) and exits non-zero on any
 * violation. Wired into `npm test`, CI, and `prepublishOnly` so a schema that
 * would trigger `400 tools.N.custom.input_schema: JSON schema is invalid` can
 * never be published.
 *
 * Two layers run together:
 *   1. Ajv 2020 meta-schema compile — authoritative pass/fail.
 *   2. findSchemaViolations() — friendly, located diagnostics + semantic
 *      ("valid-but-wrong", e.g. OpenAPI `nullable`) warnings Ajv tolerates.
 *
 * Usage: node scripts/check-tool-schemas.mjs
 */
import Ajv2020 from "ajv/dist/2020.js";
import { getToolDefinitions } from "../src/tools/index.js";
import { findSchemaViolations, SEVERITY } from "./lib/schema-compliance.js";

// Exercise the schemas exactly as the server emits them, across every
// combination of targets, default target and read-only mode.
const BOTH = ["emulator", "production"];
const VARIANTS = [
  { label: "both, default emulator", targets: BOTH, def: "emulator" },
  { label: "both, default production", targets: BOTH, def: "production" },
  { label: "emulator only", targets: ["emulator"], def: "emulator" },
  { label: "production only", targets: ["production"], def: "production" },
  { label: "readonly=1", targets: BOTH, def: "emulator", readonly: "1" },
  {
    label: "readonly=production",
    targets: BOTH,
    def: "emulator",
    readonly: "production",
  },
];

function variantDefs(v) {
  const prev = process.env.MCP_FIRESTORE_READONLY;
  if (v.readonly) process.env.MCP_FIRESTORE_READONLY = v.readonly;
  else delete process.env.MCP_FIRESTORE_READONLY;
  try {
    return getToolDefinitions(v.targets, v.def);
  } finally {
    if (prev === undefined) delete process.env.MCP_FIRESTORE_READONLY;
    else process.env.MCP_FIRESTORE_READONLY = prev;
  }
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

let errorCount = 0;
let warnCount = 0;
const rows = [];

for (const variant of VARIANTS) {
  for (const def of variantDefs(variant)) {
    const schema = def.inputSchema;
    const findings = findSchemaViolations(schema, `#(${def.name})`);
    const errors = findings.filter(f => f.severity === SEVERITY.ERROR);
    const warns = findings.filter(f => f.severity === SEVERITY.WARN);

    // Authoritative Ajv compile (catches anything the scanner doesn't enumerate).
    let ajvError = null;
    try {
      ajv.compile(schema);
    } catch (e) {
      ajvError = e.message;
    }

    // A top-level tool schema must be an object (Anthropic requirement).
    if (schema?.type !== "object") {
      errors.push({
        severity: SEVERITY.ERROR,
        keyword: "type",
        path: `#(${def.name})`,
        message: `Root inputSchema.type must be "object" (got ${JSON.stringify(schema?.type)}).`,
        fix: 'Set the top-level schema `type` to "object".',
      });
    }

    const failed = errors.length > 0 || ajvError !== null;
    if (failed) errorCount++;
    warnCount += warns.length;
    rows.push({
      name: `${def.name} [${variant.label}]`,
      failed,
      errors,
      warns,
      ajvError,
    });
  }
}

// --- Report ---
console.log("\nMCP tool inputSchema compliance (JSON Schema Draft 2020-12)\n");
for (const variant of VARIANTS) {
  const suffix = `[${variant.label}]`;
  const vrows = rows.filter(r => r.name.endsWith(suffix));
  const bad = vrows.filter(r => r.failed).length;
  const warn = vrows.filter(r => !r.failed && r.warns.length).length;
  const mark = bad ? "✖" : warn ? "▲" : "✔";
  console.log(
    `  ${mark} ${variant.label.padEnd(26)} ${vrows.length} tools, ${bad} failing, ${warn} warning`,
  );
  for (const r of vrows.filter(r => r.failed || r.warns.length)) {
    console.log(`      ${r.failed ? "FAIL" : "WARN"} ${r.name}`);
    if (r.ajvError) console.log(`        ↳ ajv: ${r.ajvError.split("\n")[0]}`);
    for (const v of [...r.errors, ...r.warns]) {
      console.log(`        ↳ [${v.severity}] ${v.path} (${v.keyword}): ${v.message}`);
      console.log(`            fix: ${v.fix}`);
    }
  }
}

console.log(
  `\n${rows.length} tool schemas checked across ${VARIANTS.length} variants — ${errorCount} failing, ${warnCount} warning(s).`,
);

if (errorCount > 0) {
  console.error(
    "\n✖ Schema compliance FAILED. These schemas would be rejected by Anthropic/MCP\n" +
      "  with `400 tools.N.custom.input_schema: JSON schema is invalid`.\n" +
      "  See .claude/skills/mcp-schema-compliance/SKILL.md for the fix recipes.\n",
  );
  process.exit(1);
}
console.log("\n✔ All tool schemas are Draft 2020-12 compliant.\n");
