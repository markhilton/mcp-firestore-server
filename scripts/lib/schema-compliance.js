/**
 * Dependency-free JSON Schema *Draft 2020-12* compliance scanner for MCP tool
 * `inputSchema` objects.
 *
 * Why this exists: Anthropic (and the MCP spec) validate every tool's
 * `inputSchema` strictly against JSON Schema Draft 2020-12. A *single*
 * non-compliant tool makes the API reject the ENTIRE `tools` array with:
 *
 *     400 tools.N.custom.input_schema: JSON schema is invalid.
 *
 * That looks like an unrecoverable client crash, because every subsequent
 * request re-sends the same poisoned schema. The classic offender is legacy
 * draft-04/draft-07 tuple validation — `items: [schemaA, schemaB]` — which in
 * 2020-12 must be written as `prefixItems: [...]` (in 2020-12 `items` MUST be a
 * single schema, never an array).
 *
 * This module walks a schema and reports the high-signal anti-patterns with a
 * precise location and a concrete fix. It is intentionally zero-dependency so
 * it can run anywhere (CI, prepublish gate, a review agent's `node -e`). The
 * authoritative pass/fail still comes from compiling against the real 2020-12
 * meta-schema with Ajv (see check-tool-schemas.mjs) — this scanner exists to
 * turn Ajv's terse output into actionable guidance and to catch semantic
 * "valid-but-wrong" keywords (e.g. OpenAPI `nullable`) that Ajv tolerates as
 * unknown keywords but that silently break tool behaviour.
 */

const VALID_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

/** Severity levels. `error` => breaks the API (meta-schema violation). */
export const SEVERITY = { ERROR: "error", WARN: "warn" };

/**
 * Recursively scan a JSON Schema fragment for Draft 2020-12 violations.
 *
 * @param {unknown} schema  The schema (object) to scan.
 * @param {string} [path="#"]  JSON-pointer-ish path for diagnostics.
 * @returns {Array<{path:string, severity:string, keyword:string, message:string, fix:string}>}
 */
export function findSchemaViolations(schema, path = "#") {
  const out = [];
  walk(schema, path, out);
  return out;
}

function walk(node, path, out) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}/${i}`, out));
    return;
  }
  if (node === null || typeof node !== "object") return;

  // --- HARD ERRORS (meta-schema violations → cause the 400) ---

  // 1. Legacy tuple validation: `items` as an array of schemas.
  if (Array.isArray(node.items)) {
    out.push({
      path: `${path}/items`,
      severity: SEVERITY.ERROR,
      keyword: "items",
      message:
        "`items` is an array (legacy draft-04/07 tuple validation). In Draft 2020-12 `items` MUST be a single schema.",
      fix: "Rename the array-form `items: [...]` to `prefixItems: [...]` (keep minItems/maxItems to fix the length).",
    });
  }

  // 2. Boolean exclusiveMinimum / exclusiveMaximum (draft-04 form).
  for (const kw of ["exclusiveMinimum", "exclusiveMaximum"]) {
    if (typeof node[kw] === "boolean") {
      out.push({
        path: `${path}/${kw}`,
        severity: SEVERITY.ERROR,
        keyword: kw,
        message: `\`${kw}\` is a boolean (draft-04 form). In Draft 2020-12 it MUST be a number.`,
        fix: `Set \`${kw}\` to the numeric bound and remove the paired \`${kw === "exclusiveMinimum" ? "minimum" : "maximum"}\`.`,
      });
    }
  }

  // 3. Invalid `type` value(s).
  if ("type" in node) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    for (const t of types) {
      if (!VALID_TYPES.has(t)) {
        out.push({
          path: `${path}/type`,
          severity: SEVERITY.ERROR,
          keyword: "type",
          message: `Invalid type "${t}". Allowed: ${[...VALID_TYPES].join(", ")}.`,
          fix:
            t === "any"
              ? "Drop `type` entirely to allow any type, or use an explicit union array."
              : "Use one of the seven JSON Schema primitive types (or an array of them).",
        });
      }
    }
  }

  // --- SEMANTIC WARNINGS (Ajv tolerates as unknown keywords, but they are
  //     OpenAPI/draft-isms that silently misbehave) ---

  if ("nullable" in node) {
    out.push({
      path: `${path}/nullable`,
      severity: SEVERITY.WARN,
      keyword: "nullable",
      message:
        "`nullable` is an OpenAPI keyword, not JSON Schema. It is ignored by 2020-12 validators.",
      fix: 'Express nullability via the type union, e.g. `"type": ["string", "null"]`.',
    });
  }
  if ("definitions" in node) {
    out.push({
      path: `${path}/definitions`,
      severity: SEVERITY.WARN,
      keyword: "definitions",
      message: "`definitions` is the draft-07 keyword. Draft 2020-12 uses `$defs`.",
      fix: "Rename `definitions` to `$defs` (and update `$ref` targets to `#/$defs/...`).",
    });
  }
  if ("dependencies" in node) {
    out.push({
      path: `${path}/dependencies`,
      severity: SEVERITY.WARN,
      keyword: "dependencies",
      message: "`dependencies` was split in 2020-12.",
      fix: "Use `dependentRequired` (property-name lists) and/or `dependentSchemas` (subschemas).",
    });
  }
  if ("id" in node && !("$id" in node)) {
    out.push({
      path: `${path}/id`,
      severity: SEVERITY.WARN,
      keyword: "id",
      message: "`id` is the draft-04 identifier keyword.",
      fix: "Rename to `$id`.",
    });
  }

  // --- Recurse into every nested subschema location ---
  for (const key of [
    "items",
    "additionalProperties",
    "contains",
    "propertyNames",
    "not",
    "if",
    "then",
    "else",
  ]) {
    if (key in node) walk(node[key], `${path}/${key}`, out);
  }
  for (const key of ["prefixItems", "allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(node[key])) walk(node[key], `${path}/${key}`, out);
  }
  for (const key of [
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
    "dependentSchemas",
  ]) {
    if (node[key] && typeof node[key] === "object") {
      for (const [name, sub] of Object.entries(node[key])) {
        walk(sub, `${path}/${key}/${name}`, out);
      }
    }
  }
}

/**
 * Convenience: validate a single tool definition's inputSchema.
 * Returns { name, hasErrors, violations }.
 */
export function checkToolDefinition(def) {
  const violations = findSchemaViolations(def.inputSchema, `#(${def.name})`);
  return {
    name: def.name,
    hasErrors: violations.some(v => v.severity === SEVERITY.ERROR),
    violations,
  };
}
