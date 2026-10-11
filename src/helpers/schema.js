import { WHERE_OPERATORS } from "./query.js";

/**
 * Shared schema fragments for tool definitions.
 * Prevents duplication of common property definitions across tool files.
 */

export const COLLECTION_PROPERTY = {
  type: "string",
  description: "Collection path (e.g. 'users' or 'users/uid/posts' for subcollections)",
};

export const CONFIRM_PROPERTY = {
  type: "boolean",
  default: false,
  description:
    "Required `true` to write to the production target. Ignored for the emulator target.",
};

/**
 * Caller-facing summary of the typed-value encodings decoded by
 * src/helpers/typed-values.js. Appended to write-tool `data` descriptions.
 */
export const TYPED_VALUES_DESCRIPTION =
  'Typed values (any depth, incl. arrays): Timestamp as {"_seconds": n, "_nanoseconds": n} (same shape reads return) or {"$timestamp": "2026-10-11T01:17:00Z"} (ISO-8601 with timezone). Sentinels (not inside arrays): {"$serverTimestamp": true}, {"$increment": n}. Bare ISO strings stay strings.';

export const PAGINATION_PROPERTIES = {
  limit: { type: "number", default: 10, description: "Maximum documents to return" },
  orderBy: {
    type: "string",
    description:
      "Field to order by. Firestore does not support ordering by __name__ descending; order by a real field instead.",
  },
  orderDirection: {
    type: "string",
    enum: ["asc", "desc"],
    default: "asc",
    description: "Order direction",
  },
  startAfter: {
    type: "string",
    description:
      "Document ID to start after (for pagination). Use lastDocId from previous response.",
  },
};

export const WHERE_CLAUSES_PROPERTY = {
  type: "array",
  description:
    'Array of where clauses: [[field, operator, value], ...]. Values are auto-coerced to numbers, booleans, arrays, etc. To filter on a Timestamp pass a JSON-encoded value such as {"$timestamp": "2026-10-11T01:17:00Z"} or {"_seconds": 1791681420, "_nanoseconds": 0}. To force a string that looks like a number/boolean/null, pass {"$string": "33101"}.',
  items: {
    type: "array",
    // Draft 2020-12 tuple validation uses `prefixItems` (the legacy array-form
    // `items: [...]` is invalid under 2020-12 and makes Anthropic reject the
    // whole tool list with `tools.N.custom.input_schema: JSON schema is invalid`).
    prefixItems: [
      { type: "string", description: "Field name" },
      { type: "string", enum: WHERE_OPERATORS, description: "Comparison operator" },
      {
        type: "string",
        description:
          'Value to compare (auto-coerced; JSON-encoded Timestamp forms and {"$string": "..."} supported)',
      },
    ],
    minItems: 3,
    maxItems: 3,
  },
};

/**
 * Output-shaping properties shared by read tools: field projection,
 * value-compaction opt-out and the response size budget.
 */
export const OUTPUT_PROPERTIES = {
  fields: {
    type: "array",
    items: { type: "string" },
    description:
      "Field paths to return (dotted for nested, e.g. 'author.name'). Omit for all fields. Use this to skip large fields such as embeddings.",
  },
  raw: {
    type: "boolean",
    default: false,
    description:
      "Return values uncompacted. By default numeric arrays longer than 64 items and strings over 4000 chars are collapsed/truncated (listed in `compacted`).",
  },
  maxChars: {
    type: "integer",
    minimum: 1000,
    maximum: 500000,
    description:
      "Max serialized characters of documents returned (default 60000, env MCP_FIRESTORE_MAX_RESPONSE_CHARS). Over budget => `truncated: true`.",
  },
};
